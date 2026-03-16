# ТЗ: profile-level `timeline reset` без переподключения устройств

Дата: 16 марта 2026 года.

## Кратко

Цель: добавить в `sensync2` опциональный profile-level reset таймлайна, который:

- не сбрасывает глобальный `SessionClock`;
- не рвёт transport connections;
- очищает timeline-local состояние плагинов;
- не допускает исполнения событий старого timeline после safe-point;
- позволяет начать новый тест с нуля без переподключения устройств.

Ключевое решение:

- reset делается не как обычный runtime-event, а как special host/worker protocol;
- reset двухфазный: `prepare -> commit`, чтобы timeout можно было безопасно abort'ить;
- глобальный `session time` остаётся монотонным, а «ноль нового теста» появляется через новый `timelineId` и `timelineStartSessionMs`;
- для high-rate источников первый батч нового timeline режется helper'ом clipping, а не теряется целиком.

## Почему текущий черновик плана был недостаточен

Реальные архитектурные ограничения сейчас такие:

- main runtime уже держит очереди и `inFlightSeq` в `/Users/tascan/Documents/sirius/sensync2/apps/runtime/src/plugin-host.ts`;
- worker держит свою очередь `state.queue` и локальные timer callbacks в `/Users/tascan/Documents/sirius/sensync2/packages/plugin-sdk/src/worker.ts`;
- UI ingress идёт через `/Users/tascan/Documents/sirius/sensync2/apps/runtime/src/runtime-host.ts` и сейчас сразу превращается в обычный `publish()`;
- worker protocol в `/Users/tascan/Documents/sirius/sensync2/packages/core/src/worker-protocol.ts` не умеет special reset messages;
- клиент сейчас знает только один абсолютный `session time` и очищает буферы только на `ui.init`;
- `HDF5` формат сейчас знает один recording-start offset и не умеет timeline segments.

Из этого следуют жёсткие требования:

- нужен safe-point в main runtime и в worker;
- reset нельзя описывать как обычный event bus flow;
- UI должен получить отдельную timeline-relative модель отображения;
- для recorder в `v1` нужна явная policy, а не «потом разберёмся».

## Нецели `v1`

В `v1` сознательно не делаем:

- reset глобального `SessionClock`;
- hidden runtime re-subscribe;
- произвольный shared buffering framework для всех transport'ов;
- timeline segments внутри одного HDF5-файла;
- rollback уже закоммиченного reset после перехода на новый `timelineId`;
- поддержку частичного reset без смены `timelineId`.

## Архитектурные решения `v1`

### 1. Два ingress path, но один coordinator

Reset может инициироваться двумя путями:

1. external UI;
2. plugin worker.

Но оба пути приходят в один `RuntimeHost` coordinator и не становятся обычными runtime-событиями общей шины.

Это значит:

- можно иметь public UI-command `timeline.reset.request@1`, но `RuntimeHost` обязан перехватывать его до `publish()`;
- plugin-side request идёт отдельным worker->main protocol сообщением, а не через `ctx.emit(...)`.

### 2. Reset двухфазный: `prepare -> commit`

Одна фаза `start -> ready -> completed` слишком слаба, потому что при timeout/failure некуда безопасно откатываться.

Поэтому `v1` делает так:

1. `request`
2. `prepare`
3. либо `abort`, если не все готовы
4. либо `commit`, если все готовы
5. `completed`

Важное правило:

- на `prepare` plugin ещё не уничтожает committed state безвозвратно;
- на `commit` plugin уже переключается на новый timeline и чистит timeline-local state окончательно.

### 3. `timelineId` в envelope обязателен

В `/Users/tascan/Documents/sirius/sensync2/packages/core/src/events.ts` у `RuntimeEventBase` нужно добавить:

- `timelineId: string`

Это не payload-поле и не plugin-specific metadata.

Назначение:

- runtime знает, к какому timeline принадлежит каждое событие;
- worker->main emit path может нести timeline принадлежность отдельно от payload;
- UI/recorder могут различать системный `session time` и текущий timeline epoch.

### 4. Worker->main emit path тоже должен нести timeline identity

Сейчас worker отправляет наверх только `RuntimeEventInput`, а envelope приклеивается в main runtime.

Для `v1` этого недостаточно.

Нужно расширить `/Users/tascan/Documents/sirius/sensync2/packages/core/src/worker-protocol.ts` так, чтобы `plugin.emit` нёс:

- `event: RuntimeEventInput`
- `timelineId: string`

Runtime должен дропать `plugin.emit`, если `message.timelineId !== currentTimelineId`.

Иначе late emit старой async-работы после reset формально попадёт в новый timeline.

### 5. UI должен стать timeline-relative, а не только buffer-clearing

Если оставить только очистку буферов, но не ввести `timelineStartSessionMs`, графики просто начнутся с нового большого absolute session-time.

Поэтому `v1` добавляет в UI clock/state:

- `timelineId`
- `timelineStartSessionMs`

И renderer должен показывать X как:

- `displayMs = absoluteSessionMs - timelineStartSessionMs`

Это касается:

- live графиков;
- overlays;
- любых derived labels, живущих в client-runtime.

### 6. Recorder policy в `v1`: reset запрещён при активной записи

Пока `HDF5` формат не умеет timeline segments в одном файле, `v1` фиксирует простую policy:

- если любой recorder не в `idle | failed`, timeline reset отклоняется;
- runtime materialize'ит понятный `ui.warning`/`ui.error`;
- никаких implicit new-file/append-segment режимов в этой задаче нет.

Это жёстче, чем хотелось бы, но архитектурно честно.

## Базовый протокол `v1`

### Новые сущности

- `timelineId: string`
- `resetId: string`

`timelineId` живёт вместе с каждым runtime-событием.

`resetId` живёт только внутри reset protocol.

### Runtime state machine

Новая coarse state machine coordinator'а:

- `RUNNING`
- `RESET_PREPARING`
- `RESET_COMMITTING`
- `DEGRADED_FATAL`

Во время reset concurrent second reset не допускается.

### Новый worker protocol

`Main -> Worker`:

- `plugin.timeline-reset.prepare`
  - `resetId`
  - `currentTimelineId`
  - `nextTimelineId`
  - `requestedAtSessionMs`
- `plugin.timeline-reset.abort`
  - `resetId`
  - `currentTimelineId`
- `plugin.timeline-reset.commit`
  - `resetId`
  - `nextTimelineId`
  - `timelineStartSessionMs`

`Worker -> Main`:

- `plugin.timeline-reset.request`
  - `requestedByPluginId`
  - `reason?`
- `plugin.timeline-reset.ready`
  - `resetId`
  - `pluginId`
- `plugin.timeline-reset.failed`
  - `resetId`
  - `pluginId`
  - `message`
- `plugin.timeline-reset.committed`
  - `resetId`
  - `pluginId`
- `plugin.emit`
  - теперь обязан нести `timelineId`

## Safe-point и drain semantics

Это главная часть `v1`.

### Фаза `request`

Coordinator принимает reset request только если:

- текущий runtime state = `RUNNING`;
- requester входит в profile-config allowlist;
- recorder policy разрешает reset;
- нет уже активного reset.

После этого runtime ещё не меняет timeline.

### Фаза `prepare`

Coordinator делает строго в таком порядке:

1. переводит runtime в `RESET_PREPARING`;
2. перестаёт принимать и маршрутизировать обычные UI-команды;
3. перестаёт fan-out'ить обычные runtime events в `publish()`;
4. у каждого `PluginHost`:
   - помечает host как `quiescing`;
   - не принимает новые enqueue обычных событий;
   - дожидается `ack` для текущего `inFlightSeq`, если он есть;
   - очищает `controlQueue/dataQueue` от ещё не доставленных обычных событий;
5. после этого рассылает всем participant plugins `plugin.timeline-reset.prepare`.

Критичный инвариант:

- `prepare` отправляется только после того, как main runtime перестал доставлять обычные события и дренировал текущий `inFlight` на host-уровне.

### Поведение worker на `prepare`

Worker обязан:

- перестать брать новые обычные `plugin.deliver` в доменную обработку;
- дожать уже выполняющийся `onEvent`, если он был один в `state.processing`;
- остановить worker timers;
- перейти в локальный режим `reset-preparing`;
- не emit'ить обычные runtime events;
- не уничтожать необратимо committed state;
- отправить `plugin.timeline-reset.ready`.

Во время `prepare` plugin может:

- сохранить summary о pending raw data;
- вычислить cutoff для clipping;
- заморозить transport callbacks в локальный buffer/drop режим.

Но plugin не должен ещё окончательно переключать timeline и чистить persistent snapshots.

### Timeout/failure policy на `prepare`

Profile config обязан задавать:

- `prepareTimeoutMs`

Если кто-то не прислал `ready` вовремя или прислал `failed`:

- runtime рассылает уже готовым участникам `plugin.timeline-reset.abort`;
- остаётся на старом `timelineId`;
- возвращается в `RUNNING`;
- materialize'ит `ui.warning` или `ui.error`;
- ничего не чистит в client-runtime.

Именно поэтому `prepare` и `commit` разделены.

## Commit semantics

Если все participants прислали `ready`, coordinator делает так:

1. создаёт `nextTimelineId`;
2. фиксирует `timelineStartSessionMs = sessionClock.nowSessionMs()`;
3. переключает `currentTimelineId = nextTimelineId` в main runtime;
4. рассылает `plugin.timeline-reset.commit` всем participants;
5. ждёт `plugin.timeline-reset.committed` от всех participants;
6. после этого переводит runtime обратно в `RUNNING`.

### Что делает plugin на `commit`

Plugin обязан:

- окончательно очистить timeline-local state;
- переключить локальный current timeline на `nextTimelineId`;
- разрешить emit обычных событий только уже для нового timeline;
- при необходимости заново materialize'ить persistent state snapshots;
- отправить `plugin.timeline-reset.committed`.

Примеры persistent state snapshots после `commit`:

- `adapter.state.changed = connected`
- актуальные scan candidates, если адаптер умеет их хранить
- status facts, которые должны жить поверх reset

### Failure policy на `commit`

После переключения на новый `timelineId` rollback уже не поддерживается.

Поэтому если plugin падает на `commit`:

- plugin переводится в `failed`;
- дальше runtime применяет reset failure policy для этого participant;
- пользователю приходит явная ошибка.

Это неприятно, но логически честно: commit уже начался.

Политика `v1`:

- по умолчанию reset использует уже существующий `manifest.required`:
  - `required: true` -> `DEGRADED_FATAL`;
  - `required: false` -> обычный fail path с user-visible ошибкой;
- profile-level config может это переопределить через `onCommitFailure`.

Дополнительная жёсткая policy `v1`:

- profile config обязан задавать `commitTimeoutMs`;
- если `plugin.timeline-reset.committed` не пришёл за `commitTimeoutMs`, participant считается `failed`;
- дальше runtime применяет ту же reset failure policy, что и при явной ошибке на `commit`.

## Что делать между `prepare` и `commit`

В этот промежуток runtime находится в stop-the-world состоянии, но без disconnect transport'ов.

Разрешено:

- protocol-level reset messages;
- internal quiesce logic;
- telemetry о самом reset.

Запрещено:

- обычный `publish()` в bus;
- fan-out новых data/control events;
- обработка обычных UI-команд;
- публикация обычных `plugin.emit` в шину.

Если transport callbacks продолжают приходить локально в адаптер:

- либо `drop-while-preparing`,
- либо локально буферизуем pending raw batch summary для последующего clipping.

## `plugin-kit` helper'ы

### 1. `createTimelineResetParticipant(...)`

Небольшой helper для worker-плагинов.

Обязанности:

- регистрировать resettable ресурсы:
  - `SignalWindowStore`
  - `FactStore`
  - `StateCell`
  - локальные timers/flush loops
  - plugin-specific accumulators
- различать фазы:
  - `running`
  - `preparing`
  - `committing`
- давать guarded emit path, который привязывает emit к конкретному `timelineId`.

Минимальный API `v1`:

- `onPrepare(...)`
- `onAbort(...)`
- `onCommit(...)`
- `currentTimelineId()`
- `bindEmit(ctx)` или эквивалентный guarded emitter

Важно:

- helper не заменяет `plugin-sdk`;
- helper не прячет `manifest`;
- helper не делает новый runtime.

### 2. `clipSignalBatchToTimelineStart(...)`

Обязательный helper для high-rate источников.

Сигнатура уровня `v1`:

```ts
clipSignalBatchToTimelineStart(payload, cutoffSessionMs)
```

Результат:

- `drop`
- или `keep(payload)`

Правила clipping:

#### `uniform-signal-batch`

- считаем индекс suffix по `t0Ms + dtMs * i`;
- если весь батч до cutoff — дропаем;
- если остаётся suffix — сохраняем `uniform` frameKind;
- новый `t0Ms` сдвигается на начало suffix;
- `sampleRateHz` можно сохранять.

#### `irregular-signal-batch`

- оставляем только `timestampsMs >= cutoffSessionMs`;
- если ничего не осталось — drop;
- `sampleRateHz` сохраняется только если он всё ещё semantically корректен; по умолчанию helper его не добавляет сам.

#### `label-batch`

- то же правило, что для irregular;
- `dtMs` и `sampleRateHz` не используются и не добавляются.

## Политики по источникам данных

### `v1` дефолт

- low-rate источники: `drop-while-preparing`
- high-rate источники: `buffer-and-clip-first-batch-after-commit`

### Практическое ожидание по текущим адаптерам

- `Moxy`: обычно достаточно drop
- `Zephyr RR`: чаще всего тоже достаточно drop или минимального irregular clipping
- `Trigno` и будущие fixed-rate генераторы: нужен clipping

## UI / client-runtime semantics

### Что должно появиться в UI модели

Нужно добавить в `/Users/tascan/Documents/sirius/sensync2/packages/core/src/ui.ts`:

- `timelineId`
- `timelineStartSessionMs`

в составе UI clock/state snapshot.

### Как UI узнаёт о reset

`v1` вводит отдельное control message, например:

- `ui.timeline.reset`
  - `timelineId`
  - `timelineStartSessionMs`
  - `clearBuffers: true`

Почему не `ui.init`:

- reset не равен reconnect клиента;
- schema/stream registry переиспользуются;
- надо сбросить только timeline-related runtime state renderer'а.

### Что делать с `attachUiClient()` во время reset

Во время `RESET_PREPARING` и `RESET_COMMITTING` runtime не должен отправлять новому клиенту промежуточный `ui.init`.

Правило `v1`:

- новый UI-клиент ставится в pending attach;
- если reset abort'ится, клиент получает консистентный snapshot старого timeline;
- если reset commit/completed успешен, клиент получает первый `ui.init` или эквивалентный post-reset snapshot уже для нового timeline;
- никакого промежуточного состояния между `prepare` и `completed` UI видеть не должен.

Причина:

- иначе клиент может materialize'ить half-reset состояние, где transport-connected flags уже частично восстановлены, а timeline-local buffers ещё очищаются;
- это ломает основную цель reset: новый тест должен начинаться из консистентного снимка.

### Что делает `client-runtime`

На `ui.timeline.reset` клиент обязан:

- очистить ring buffers;
- сбросить `latestSessionMs` на `timelineStartSessionMs`;
- сохранить новый `timelineId`;
- сохранить новый `timelineStartSessionMs`;
- не терять schema и stream registry;
- не ломать transport connection.

### Что делает renderer

Renderer обязан считать X-координату относительно текущего timeline:

- `relativeX = absoluteSessionMs - timelineStartSessionMs`

Без этого reset не даст визуального «старта с нуля».

## Recorder policy `v1`

Пока формат `/Users/tascan/Documents/sirius/sensync2/packages/plugins-hdf5/HDF5_FORMAT.md` не умеет segments/epochs внутри одного файла, фиксируем policy:

- timeline reset запрещён, если любой recorder находится в `recording` или `paused`;
- runtime отклоняет запрос reset до входа в `prepare`;
- пользователю materialize'ится понятный warning/error.

Будущие варианты (`v2+`):

- новый файл на reset;
- timeline segments внутри файла;
- explicit recorder epoch metadata.

Но не в этой задаче.

## Profile config

Reset должен быть явным profile-level opt-in.

Минимальный config `v1`:

```ts
interface TimelineResetProfileConfig {
  enabled: true;
  requesters: Array<'external-ui' | string>; // string = concrete plugin id
  participants: Array<
    | string
    | {
        pluginId: string;
        onCommitFailure?: 'inherit-required' | 'degraded_fatal' | 'fail_participant';
      }
  >;
  prepareTimeoutMs?: number; // default 2000
  commitTimeoutMs?: number; // default 2000
  recorderPolicy?: 'reject-if-recording';
}
```

Правила:

- `requesters` и `participants` задаются concrete plugin ids, а не package names;
- если participant задан строкой, это сокращение для `{ pluginId, onCommitFailure: 'inherit-required' }`;
- `inherit-required` означает: взять базовую политику из `manifest.required`;
- runtime валидирует, что все ids реально присутствуют в profile;
- duplicate ids запрещены.

## Этапы реализации

### Этап 1. Контракты и ingress

Сделать:

- `timelineId` в `RuntimeEventBase`;
- special shared/public request для UI либо equivalent host ingress contract;
- worker-protocol messages для reset request/prepare/abort/commit/ready/failed/committed;
- profile config для requesters/participants.

Критерии успеха:

- reset request больше не проходит через обычный `publish()`;
- `RuntimeHost` умеет различать allowed/forbidden requester;
- type-level контракты и docs синхронизированы.

### Этап 2. Safe-point coordinator в runtime

Сделать:

- `RESET_PREPARING` / `RESET_COMMITTING` в `RuntimeHost`;
- quiesce для `PluginHost`;
- drain `inFlightSeq` и очистку host queues;
- блокировку обычных UI-команд и обычного bus fan-out во время reset.

Критерии успеха:

- после входа в `prepare` host больше не доставляет старые queued events;
- timeout на `prepare` безопасно abort'ится без смены `timelineId`;
- timeout на `commit` переводит зависший participant в `failed` по зафиксированной policy;
- `verify` зелёный.

### Этап 3. Worker-side reset protocol

Сделать:

- фазы `preparing/committing` в worker;
- stop/resume timer lifecycle;
- `plugin.emit` с `timelineId`;
- guarded emit/drop semantics для старого timeline.

Критерии успеха:

- worker не эмитит обычные события во время `prepare`;
- runtime дропает stale emit с устаревшим `timelineId`;
- есть unit-тесты на late emit.

### Этап 4. UI timeline-relative model

Сделать:

- `ui.timeline.reset`;
- `timelineStartSessionMs` в UI clock/state;
- buffer clear и offset logic в `client-runtime`;
- renderer display относительно timeline start.

Критерии успеха:

- после reset графики реально стартуют с `0 ms` по X;
- schema и stream registry не теряются;
- старые точки не остаются в буфере.
- `attachUiClient()` во время reset не получает промежуточный `ui.init`, а ждёт `abort` или `completed`.

### Этап 5. `plugin-kit` helper'ы

Сделать:

- `createTimelineResetParticipant(...)`
- `clipSignalBatchToTimelineStart(...)`

Критерии успеха:

- helper покрыт unit-тестами;
- clipping корректен для uniform/irregular/label;
- есть тест на `prepare -> abort` и `prepare -> commit` lifecycle.

### Этап 6. Пилотная интеграция

Сначала подключить reset не ко всем plugin'ам сразу, а к минимальному пилотному профилю/набору:

- `ui-gateway`
- `fake-signal-adapter` / `shape-generator-adapter`
- 1-2 processor'а
- без активного recorder during reset

Критерии успеха:

- новый тест стартует без reconnect transport'ов;
- старые data events после safe-point не исполняются;
- UI начинает новый timeline с нуля;
- fake/profile smoke проходит.

## План проверки

- Unit:
  - worker-protocol reset messages
  - `PluginHost` quiesce/drain
  - `RuntimeHost` state machine
  - `clipSignalBatchToTimelineStart(...)`
  - `client-runtime` timeline reset
- Integration:
  - reset abort по timeout
  - reset commit success
  - reset commit timeout -> participant failed path
  - stale emit drop по старому `timelineId`
  - high-rate uniform clipping на границе
  - attach UI client во время reset -> только консистентный snapshot после `abort`/`completed`
- Gates:
  - `npm run build`
  - `npm run test`
  - `npm run verify`

## Итоговая позиция

В `v1` timeline reset — это не «сброс времени» и не «ещё одно событие в шине».

Это отдельный coordinated barrier protocol с такими инвариантами:

- глобальный `SessionClock` не меняется;
- `timelineId` меняется только после успешного `prepare` всех участников;
- старые queued events не проходят safe-point;
- UI показывает время относительно `timelineStartSessionMs`, а не абсолютного session-start;
- recorder не участвует в reset при активной записи.

Только в таком виде механизм остаётся инженерно честным и реализуемым поверх текущего runtime.
