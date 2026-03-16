# План: recorder-driven timeline reset для `veloerg`

## Кратко

Цель этого трека: перевести `timeline reset` из ручной UI-операции в управляемый recorder-flow, где reset инициирует `hdf5-recorder`, а профиль только разрешает ему это делать.

Основной сценарий:
- при `recording.start` recorder при необходимости запускает `timeline reset`;
- запись начинается только после успешного `commit` нового timeline;
- при `recording.stop` recorder сначала всегда останавливает запись, затем один раз пытается выполнить `timeline reset`;
- если post-stop reset не удался, запись всё равно считается остановленной.

Этот план не заменяет общий [timeline-reset.md](timeline-reset.md), а конкретизирует его для production-flow записи и live-profile `veloerg`.

## Принятые решения

- reset инициирует не UI, а plugin `hdf5-recorder`;
- право на reset выдаётся профилем через `timelineReset.requesters`;
- в конфиг `hdf5-recorder` добавляются флаги:
  - `resetTimelineOnStart?: boolean`
  - `resetTimelineOnStop?: boolean`
- для `veloerg` включаем оба флага;
- если reset при `recording.start` не удался, запись не начинается;
- если reset при `recording.stop` не удался, запись всё равно завершается, а наружу уходит warning;
- `pause/resume` не трогают timeline;
- `recording.start` во время pending reset остаётся в recorder state `starting`, отдельный public state не добавляем;
- преждевременный `recording.start` отклоняется через `command.rejected`, а не через прямой `ui.error`;
- `hdf5-recorder` materialize'ит manifest из config в `onInit()`, включая reset-policy, readiness-check subscriptions и `required` override;
- `required` override задаётся в plugin config и попадает в config-dependent manifest, а не в отдельный profile-level runtime override;
- для старта теста нужны условия:
  - `ant-plus` connected
  - `zephyr-bioharness` connected
  - `trigno` connected
  - `trigno` started
  - recorder `local` находится в `idle | failed`
  - reset не выполняется
- `Trigno` при reset не рвёт transport; сохраняем raw socket stream и режем первый parsed batch нового timeline;
- recorder пишет все streams профиля, включая derived;
- `outputDir` для `veloerg` задаётся как repo-relative путь `recordings/veloerg`, а не абсолютный путь.
- failed post-stop reset не оставляет recorder в "грязном" промежуточном флаге: следующий `recording.start` при `resetTimelineOnStart === true` снова инициирует новый reset с нуля;
- reset блокируется, если активен любой writer, а не только целевой `local`.

## Что нужно зафиксировать в authoring docs

Перед включением reset в live-profile нужно жёстко зафиксировать модель reset-классов для plugin authoring.

Документы:
- `packages/plugin-sdk/README.md` — основной authoring-contract;
- `packages/plugin-kit/README.md` — какие helper'ы используются для реализации;
- `packages/core/CONTRACTS.md` — системные инварианты barrier protocol.

Классы plugin'ов:

1. `active reset participant`
- плагин держит timeline-local state: окна, accumulator'ы, таймеры, estimator state, derived snapshots;
- обязан реализовать `onTimelineResetPrepare/Abort/Commit`;
- обязан явно разделять persistent state и timeline-local state.

2. `passive reset-aware plugin`
- не держит timeline-local буферы, но после barrier получает новый `timelineId` и обязан корректно жить без специальных hook'ов;
- такой plugin должен быть осознанно отмечен в profile documentation, а не считаться "просто забытым".

3. `reset-disabled for profile`
- plugin не должен участвовать в reset-enabled profile до появления явной reset-strategy;
- это допустимо только до тех пор, пока профиль с reset его не использует.

Для каждого класса в `plugin-sdk/README.md` нужно описать:
- что делать на `prepare`;
- что делать на `abort`;
- что делать на `commit`;
- что такое persistent state;
- что такое timeline-local state;
- когда нужен `clipSignalBatchToTimelineStart(...)`.

## Этапы

### Этап 1. Документировать reset-authoring contract

Обновить:
- `packages/plugin-sdk/README.md`
- `packages/plugin-kit/README.md`
- при необходимости `packages/core/CONTRACTS.md`

Что фиксируем:
- три reset-класса plugin'ов;
- обязанности plugin'а в `prepare/abort/commit`;
- правило для high-rate batched источников: не рвать transport без причины, а клиповать первый post-reset batch;
- различие между persistent connection state и timeline-local buffers/state.

Критерии успеха:
- по README понятно, обязан ли новый plugin иметь reset hooks;
- поведение `Trigno`-подобных high-rate adapters описано без двусмысленности.

### Этап 2. Расширить `hdf5-recorder` конфигом reset-policy

В `packages/plugins-hdf5/src/hdf5-recorder-plugin.ts` добавить:
- `resetTimelineOnStart?: boolean`
- `resetTimelineOnStop?: boolean`
- `required?: boolean`
- `startConditions?: RecordingStartConditionsConfig`

Поведение:
- если `resetTimelineOnStart !== true`, `recording.start` идёт по текущему пути;
- если `resetTimelineOnStop !== true`, `recording.stop` не трогает reset.
- manifest recorder'а materialize'ится в `onInit()` из config:
  - `required` берётся из `config.required ?? false`;
  - subscriptions на readiness-check facts добавляются до `plugin.ready`.

В этот же этап входит разделение условий старта записи на два слоя:

1. встроенные инварианты recorder'а:
- writer должен быть в `idle | failed`;
- recorder не должен уже находиться в pending start/reset flow;
- runtime не должен быть в `timeline reset`.

2. profile-driven readiness conditions:
- задаются в конфиге профиля;
- описывают внешнюю готовность стенда к старту записи.

Критерии успеха:
- recorder умеет работать и в старом режиме, и в recorder-driven reset mode;
- `starting` остаётся единственным public pending-state для deferred-start;
- без включённых флагов поведение существующих профилей не меняется.

### Этап 3. Реализовать deferred-start через recorder-requested reset

Recorder должен получить pending-flow:
- на `recording.start` не открывать файл сразу;
- сохранить pending payload;
- вызвать `ctx.requestTimelineReset(...)`;
- дождаться `onTimelineResetCommit(...)`;
- только после commit открыть файл и перейти в `recording`.

Failure policy:
- если reset failed/aborted, запись не начинается;
- наружу уходит `command.rejected`, который materialize'ится в user-visible ошибку:
  - `Запись не началась: не удалось сбросить timeline`

Нельзя:
- начинать запись в старом timeline "в ожидании reset";
- требовать второй UI-клик после успешного reset.

Критерии успеха:
- `recording.start` запускает ровно один reset и один старт записи;
- при failed reset recorder остаётся в корректном idle/failed состоянии без открытого файла.

### Этап 4. Реализовать best-effort reset после stop

На `recording.stop`:
- сначала штатно завершить запись и закрыть файл;
- затем один раз попытаться выполнить `timeline reset`, если `resetTimelineOnStop === true`.

Failure policy:
- stop считается успешным даже при failed reset;
- наружу уходит warning:
  - `Запись остановлена, но не удалось сбросить timeline, рекомендуется перезапустить приложение`

Если сам `recording.stop` не удался:
- post-stop reset не выполняется.

Критерии успеха:
- stop не блокируется и не откатывается из-за failed reset;
- recorder не остаётся в подвешенном состоянии после stop + reset failure.

### Этап 5. Подключить recorder и reset-policy в `veloerg`

Обновить `apps/runtime/src/profiles/veloerg.ts`:
- добавить `hdf5-recorder`;
- задать repo-relative `outputDir: 'recordings/veloerg'` через boundary resolve;
- включить `timelineReset`;
- дать requester только `hdf5-recorder`.

В профиле зафиксировать:
- `resetTimelineOnStart: true`
- `resetTimelineOnStop: true`
- `required: true` у recorder, `zephyr-bioharness-3-adapter` и `hr-from-rr-processor` через их config-dependent manifest

Критерии успеха:
- `veloerg` поднимает recorder;
- reset не инициируется напрямую из UI;
- запись пишет все streams профиля в `recordings/veloerg`.

### Этап 6. Добавить runtime preflight для старта записи

Проверка условий старта записи должна жить не в UI-клиенте, а в runtime/recorder path.

Причина:
- `ui.error` — output-сообщение системы, а не корректная input-команда UI;
- источник истины по readiness должен оставаться в runtime, а не в schema.

Нужно:
- на `recording.start` делать preflight-check;
- если условия не выполнены, отклонять start только через `command.rejected`.

Модель `v1`:
- встроенные recorder-инварианты не задаются профилем;
- профиль передаёт только внешние readiness conditions;
- в `v1` поддерживаем только `fact-field`, потому что для `veloerg` этого достаточно и не нужно тащить лишний signal-driven framework в первый PR.

Предлагаемый shape:

```ts
interface RecordingStartConditionsConfig {
  checks: RecordingStartCheck[];
}

type RecordingStartCheck = {
  kind: 'fact-field';
  event: { type: string; v: number };
  where?: Record<string, string | number | boolean>;
  field: string;
  eq?: Primitive;
  oneOf?: Primitive[];
  message: string;
};
```

Для `veloerg` дефолт `v1` должен опираться только на `fact-field`, без signal checks:

```ts
startConditions: {
  checks: [
    {
      kind: 'fact-field',
      event: { type: 'adapter.state.changed', v: 1 },
      where: { adapterId: 'ant-plus' },
      field: 'state',
      eq: 'connected',
      message: 'Moxy/ANT+ должен быть подключён',
    },
    {
      kind: 'fact-field',
      event: { type: 'adapter.state.changed', v: 1 },
      where: { adapterId: 'zephyr-bioharness' },
      field: 'state',
      eq: 'connected',
      message: 'Zephyr должен быть подключён',
    },
    {
      kind: 'fact-field',
      event: { type: 'adapter.state.changed', v: 1 },
      where: { adapterId: 'trigno' },
      field: 'state',
      eq: 'connected',
      message: 'Trigno должен быть подключён и запущен',
    },
  ],
}
```

`Trigno started` в `v1` формализуется не отдельным новым фактом, а существующей state machine:
- после обычного connect `trigno` находится в `paused`;
- после успешного live start `trigno` переходит в `connected`;
- значит readiness для записи = `adapter.state.changed(adapterId='trigno').state === 'connected'`.

UI при этом может оставаться кликабельным; важна user-visible диагностика на нажатие, а не "молчаливый disabled навсегда".

Критерии успеха:
- на преждевременный старт записи пользователь получает понятное сообщение;
- UI не подменяет runtime своими "ошибками";
- profile-driven checks не прошиваются device-specific `if`-ами внутрь recorder;
- recorder подписывается только на те fact events, которые реально перечислены в `startConditions`.

### Этап 7. Подключить все плагины `veloerg` к reset-стратегии

Под "подключить все плагины" в этом треке понимается не формальное наличие hook'ов у каждого файла, а явная стратегия для каждого plugin'а в `veloerg`.

#### `hr-from-rr-processor`

Нужно:
- добавить reset hooks;
- на commit очищать estimator/median/EMA state;
- не переносить RR history из старого timeline.

Критерии успеха:
- первый `HR` после reset считается только по RR нового timeline.

#### `ant-plus-adapter`

Нужно:
- сохранить transport connection;
- очистить timeline-local buffers/derived state;
- переизлучить persistent adapter state после commit.

Критерии успеха:
- после reset адаптер остаётся connected;
- старые данные не протекают в новый timeline.

#### `zephyr-bioharness-3-adapter`

Нужно:
- сохранить BLE connection;
- очистить локальные packet-derived accumulator'ы;
- переизлучить persistent adapter state после commit.

Критерии успеха:
- после reset `zephyr` остаётся connected;
- RR/HR-история не тянется через новый timeline.

#### `trigno-adapter`

Нужно:
- не рвать transport sockets;
- сохранить raw socket stream;
- не терять frame sync;
- резать первый parsed batch относительно `timelineStartSessionMs`.

Критерии успеха:
- после reset `trigno` остаётся connected/started;
- первый parsed batch нового timeline не содержит старые sample prefix.

#### `ui-gateway`

Нужно:
- оставить текущий reset path;
- гарантировать пересборку derived flags и новый `ui.timeline.reset`;
- корректно поддержать live `veloerg` flags.

Критерии успеха:
- UI после reset видит новый timeline без старых буферов и без потерянного persistent state.

### Этап 8. Тесты и smoke

Минимальный набор:

1. Recorder tests
- start + reset success;
- start + reset abort/failure;
- stop + reset success;
- stop + reset failure warning;
- отсутствие start записи до commit reset.

2. Runtime/profile tests
- `veloerg` разрешает requester только `hdf5-recorder`;
- `external-ui` не может инициировать reset в live-profile;
- preflight старта записи выдаёт user-visible rejection.

3. Processor tests
- `hr-from-rr` очищает state на reset.

4. Adapter tests
- `ant-plus`, `zephyr`, `trigno` сохраняют connection state;
- старые данные не попадают в новый timeline;
- `trigno` корректно клипует первый parsed batch.

5. Smoke
- сохранить существующий `verify`;
- добавить отдельный profile-level smoke для `veloerg` только при наличии mock/fake transport path;
- real-hardware smoke не считать обязательным gate.

## План проверки

- `npm run test`
- `npm run build`
- `npm run verify`
- доп. точечные тесты:
  - recorder-driven reset flow
  - `veloerg` profile config
  - `trigno` reset batch clipping

## Открытые вопросы

1. Где именно проверять `trigno started`:
- по existing flag/state event,
- или нужен новый явный runtime fact для readiness.

2. Каким текстом оформлять единый preflight error для `recording.start`:
- одна общая ошибка со списком условий,
- или чуть более информативная с перечислением конкретно не выполненных условий.

Дефолт `v1`:
- общий заголовок:
  - `Нельзя начать запись: не выполнены условия запуска теста`
- плюс список только тех `message`, которые относятся к реально проваленным checks.
