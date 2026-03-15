# ТЗ: `adapter-kit` для декларативных runtime-адаптеров

Дата: 15 марта 2026 года.

## Цель

Добавить в `sensync2` отдельную библиотеку `packages/adapter-kit`, которая позволит писать adapter-plugin'ы без копирования одних и тех же инфраструктурных решений:

- жизненный цикл `scan / connect / disconnect / failed / paused / connected`;
- materialization событий состояния адаптера;
- нормализация `formData` и connect request;
- описание и маппинг выходных потоков данных;
- политики `autoconnect`, `auto-resume`, `reconnect`, persistent config.

Речь не про общий runtime-manager устройств и не про перенос transport-логики в shared ядро. `adapter-kit` должен быть библиотекой для adapter-plugin'ов, а не новым скрытым уровнем оркестрации.

## Почему это нужно

В `sensync2` уже видно повторяющийся паттерн:

- адаптер принимает shared command events (`adapter.scan.request`, `adapter.connect.request`, `adapter.disconnect.request`);
- адаптер валидирует `formData` и конфиг;
- адаптер публикует `adapter.state.changed`, scan state и candidates;
- адаптер маппит внутренние транспортные данные в `signal.batch` потоки;
- адаптер держит reconnect/watchdog/paused semantics.

Если это продолжать писать вручную в каждом пакете, получится несколько несовместимых реализаций одного и того же adapter-lifecycle.

## Что показывает текущий код `Trigno`

### Старый `sensync`

В старом `sensync` у `Trigno` уже есть явный слой маппинга данных:

- `TrignoDataPortDefinition`
- `TrignoChannelDefinition`
- `TrignoFrameDefinition`

Ссылки:

- [../sensync/adapters/trigno.py](../../sensync/adapters/trigno.py)
- [../sensync/drivers/trigno.py](../../sensync/drivers/trigno.py)

По сути там уже реализована схема:

- внутренний источник данных определяется через `port + channel + frame`;
- затем этот источник маппится во внешнее имя канала;
- при этом задаются дополнительные свойства:
  - `fs`;
  - `scaler`;
  - `offset`;
  - `frame_width`;
  - диапазон индексов внутри data-port.

Это важный факт: идея отдельного mapping-слоя не искусственная, она уже существует в рабочей форме.

### Текущий `sensync2`

В `sensync2` пакет `plugins-trigno` уже есть, но mapping там пока не вынесен в общий reusable слой.

Ссылки:

- [../packages/plugins-trigno/src/trigno-adapter.ts](../packages/plugins-trigno/src/trigno-adapter.ts)
- [../packages/plugins-trigno/CONTRACTS.md](../packages/plugins-trigno/CONTRACTS.md)
- [../packages/plugins-trigno/README.md](../packages/plugins-trigno/README.md)

Что видно сейчас:

- lifecycle уже сложнее простого connect/disconnect;
- есть отдельный этап `connect -> paused -> stream.start`;
- есть watchdog и auto-reconnect;
- сами выходные stream id сейчас захардкожены:
  - `trigno.avanti`
  - `trigno.avanti.gyro.x`
  - `trigno.avanti.gyro.y`
  - `trigno.avanti.gyro.z`

Вывод:

- mapping действительно нужен;
- но его нельзя сводить только к строковому alias;
- adapter-kit должен уметь описывать не только имя потока, но и источник данных, units, sample format, timeline policy и преобразования значения.

## Что именно должно появиться

Новый пакет:

- `packages/adapter-kit`

Роль пакета:

- helper-слой для adapter-plugin'ов поверх `plugin-sdk`;
- декларативный lifecycle adapter'а;
- общая модель output stream mapping;
- общие политики autoconnect/reconnect/persistent connect profile;
- общие события и помощники по состояниям.

## Архитектурная позиция

Фиксируем жёстко:

- `adapter-kit` — библиотека, а не новый runtime-plugin;
- `adapter-kit` — набор composable helper-модулей, а не обязательный монолитный wrapper для каждого адаптера;
- device transport остаётся в конкретном пакете адаптера (`plugins-trigno`, `plugins-ble`, `plugins-ant-plus` и т.д.);
- `adapter-kit` не знает о TCP/BLE/ANT+ деталях устройства;
- UI schema и `modalForm` живут в `ui-gateway`, не в `adapter-kit`;
- boundary-валидация внешних данных остаётся рядом с адаптером, а не переезжает в библиотеку.

Если попытаться вынести transport и UI вместе, получится не helper-kit, а громадный framework, который будет мешать реальным адаптерам.

Практический принцип использования:

- адаптер может подключить только `signal emit helper`;
- или только `output mapping registry`;
- или только `scan/connect flow helper`;
- или только `autoconnect/reconnect policy`;
- или собрать несколько helper'ов вместе.

Но библиотека не должна заставлять адаптер проходить через один большой обязательный `defineAdapterPlugin(...)`, если ему нужен только маленький subset reuse.

## Базовая модель output mapping

### Задача mapping-слоя

Каждый адаптер получает внутренние данные в своей форме:

- frame/slot/channel у Trigno;
- candidate/device state у BLE;
- packet profile у ANT+;
- synthetic generator state у fake-адаптеров.

Внешнему runtime нужен другой контракт:

- `signal.batch` с конкретными `streamId` / `channelId`;
- понятные `units`;
- фиксированный `sampleFormat`;
- понятная timeline policy.

Между этими слоями нужен нормальный declarative mapping.

### Минимальная форма mapping в `v1`

Примерно так:

```ts
outputs: {
  emg: {
    streamId: 'trigno.avanti',
    channelId: 'trigno.avanti',
    sampleFormat: 'f32',
    units: 'V',
    source: {
      kind: 'frame',
      port: 'EMG',
      channel: 1,
      frame: 0,
    },
    transform: {
      scale: 1,
      offset: 0,
    },
    timeline: {
      kind: 'uniform-from-rate',
      rateHz: 1925.9259,
      anchor: 'session-start-on-stream-start',
    },
  },
}
```

Фиксируем:

- mapping описывает не только внешнее имя, но и источник данных;
- mapping должен уметь задавать `scale` / `offset`;
- mapping должен уметь задавать `units`;
- mapping должен уметь задавать timeline strategy.

### Почему это нужно отдельно от транспорта

Потому что transport читает байты и пакеты, а mapping решает другое:

- какой кусок transport-state становится внешним потоком;
- как он называется во внешней системе;
- как он шкалируется;
- как ему назначается временная сетка.

Это разные ответственности.

## Что стоит вынести в `adapter-kit`

### 1. Lifecycle helpers

Практически все адаптеры повторяют одну и ту же state machine, даже если детали отличаются.

Минимальный общий слой:

- helper для перевода adapter в состояния:
  - `disconnected`
  - `connecting`
  - `connected`
  - `paused`
  - `disconnecting`
  - `failed`
- helper для materialization `adapter.state.changed`;
- helper для стандартных guard'ов:
  - нельзя `connect`, если уже `connecting/connected/paused`;
  - нельзя `disconnect`, если уже `disconnected`;
  - нельзя `start`, если transport не готов.

При этом нельзя пытаться сделать одну универсальную state machine для всех адаптеров. Например:

- у `Trigno` есть отдельный `paused` между `connect` и `stream.start`;
- у fake-адаптера такого этапа нет;
- у BLE/ANT+ есть `scan` перед `connect`.

Значит, библиотека должна давать building blocks, а не навязывать всем одну цепочку.

### 2. Scan/connect flow helpers

Повторяющиеся элементы уже есть в `ANT+` и `BLE`:

- `adapter.scan.request`;
- `adapter.scan.state.changed`;
- `adapter.scan.candidates`;
- `connectFormData` для кандидата;
- `adapter.connect.request`.

Ссылки:

- [../packages/plugins-ant-plus/src/ant-plus-adapter.ts](../packages/plugins-ant-plus/src/ant-plus-adapter.ts)
- [../packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts](../packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts)

В `adapter-kit` имеет смысл вынести:

- helper для scan-state events;
- helper для candidates events;
- нормализацию requestId/scanId;
- стандартные проверки устаревшего `scanId` и выбранного `candidateId`.

Но не надо выносить в библиотеку:

- сам BLE scan;
- сам ANT+ discovery;
- специфику валидации кандидатов устройства.

### 3. Output emit helpers

Почти каждому адаптеру нужен удобный способ эмитить `signal.batch`.

В `v1` библиотека должна дать:

- factory для `uniform signal batch`;
- helper для single-sample signal;
- helper для `label-batch`, если адаптер эмитит состояния как поток;
- timeline helpers:
  - `session-anchored uniform`
  - `explicit timestamps`
  - `restart timeline on stream start`

Это полезно уже сейчас, потому что:

- fake-адаптеры руками строят одинаковые `signal.batch`;
- ANT+ строит однотипные single-sample packets;
- Trigno руками собирает batched uniform streams.

### 4. Output mapping registry внутри адаптера

Адаптеру нужен не просто emit helper, а локальный словарь описанных outputs.

Минимально:

- регистрация всех output descriptor при `onInit`;
- lookup по alias или source key;
- единая точка, где описаны:
  - внешние имена;
  - units;
  - sample format;
  - timeline;
  - преобразование значений.

Именно это позволит перестать разносить знания о каналах по нескольким файлам.

### 5. Политики `autoconnect`

Идея полезная, но тут нужна дисциплина.

В старом `sensync` был примитивный флаг `autoconnect`, и протокол просто делал `adapter.connect()` на старте.

Ссылки:

- [../../sensync/core/adapter.py](../../sensync/core/adapter.py)
- [../../sensync/core/test_protocol.py](../../sensync/core/test_protocol.py)

Для `sensync2` лучше зафиксировать не булев флаг, а политику:

- `manual`
- `auto-on-init`
- `auto-from-persisted-profile`

Смысл:

- `auto-on-init`
  - для synthetic adapters и локальных генераторов, которым не нужен внешний ввод;
- `auto-from-persisted-profile`
  - для реальных устройств, где есть сохранённый профиль подключения;
- `manual`
  - дефолт для небезопасных или неоднозначных адаптеров.

### 6. Persistent connect profile

Для адаптеров, которые требуют параметров подключения, нужно предусмотреть persistent profile.

Пример:

- Trigno host / sensor slot;
- ANT+ deviceId/profile;
- BLE device identity и mode;
- будущие TCP-адаптеры с host/port.

`adapter-kit` должен дать только каркас:

- тип `PersistedConnectProfile`;
- helper для выбора текущего профиля;
- lifecycle policy `auto-from-persisted-profile`.

Но storage профиля и UI редактирования не должны жить в библиотеке. Это уже отдельный слой.

### 7. Reconnect/watchdog helpers

Тут надо быть осторожным, но слой напрашивается.

Уже сейчас у `Trigno` есть watchdog и reconnect semantics.

В `adapter-kit` можно вынести:

- базовый `watchdog timer`;
- helper для хранения `lastDataSeenSessionMs`;
- helper для backoff-политики reconnect;
- guard'ы, которые запрещают reconnect в некоторых состояниях, например в `paused`.

Но конкретная логика того, что считать “тишиной”, должна оставаться в адаптере.

## Что не надо выносить в `adapter-kit`

Это критично.

### 1. Device transport

Не выносить в общий kit:

- TCP session Trigno;
- BLE central;
- ANT+ stick transport;
- vendor-specific packet parser.

### 2. UI schema

Не выносить в `adapter-kit`:

- `modalForm`;
- кнопки;
- варианты control-state;
- renderer-only flow.

UI может опираться на shared adapter contracts, но adapter-kit не должен генерировать UI сам.

### 3. Boundary-guards внешнего мира

Не надо переносить в библиотеку:

- разбор `formData` Trigno;
- разбор BLE config;
- нормализацию ANT+ env overrides.

Boundary должен жить рядом с устройством, потому что он зависит от device-specific semantics.

### 4. Device-specific start gate

То, что у Trigno `connect != start stream`, не означает, что все адаптеры должны иметь `start/stop` flow.

Значит:

- start gate helpers можно предусмотреть как опциональный слой;
- но нельзя заставлять все адаптеры жить по модели `connect -> paused -> start`.

## Предлагаемая форма API `v1`

Важное ограничение: `v1` не должен строиться вокруг одного обязательного entrypoint.

Правильная форма для `adapter-kit`:

- маленькие helper-модули с узкой ответственностью;
- опциональный composition helper верхнего уровня, если он окажется удобным;
- возможность использовать только нужный слой, не включая весь kit целиком.

То есть библиотека должна поддерживать оба сценария.

### Сценарий 1. Адаптер берёт только нужный helper

```ts
import { createUniformSignalEmitter } from '@sensync2/adapter-kit/signal-emit';
import { createOutputRegistry } from '@sensync2/adapter-kit/output-map';
```

### Сценарий 2. Адаптер комбинирует несколько helper'ов

```ts
import { createAdapterStateMachine } from '@sensync2/adapter-kit/adapter-state-machine';
import { createOutputRegistry } from '@sensync2/adapter-kit/output-map';
import { createReconnectPolicy } from '@sensync2/adapter-kit/reconnect-policy';
```

Если позже появится удобный composition helper верхнего уровня, он должен быть опциональным, а не обязательным.

Рабочая форма библиотеки может быть близка к такой:

```ts
const state = createAdapterStateMachine({ adapterId: 'trigno' });
const outputs = createOutputRegistry({
  emg: {
    streamId: 'trigno.avanti',
    channelId: 'trigno.avanti',
    sampleFormat: 'f32',
    units: 'V',
    source: { kind: 'frame', port: 'EMG', channel: 1, frame: 0 },
  },
});
const emitSignal = createUniformSignalEmitter(outputs);
```

Смысл примера не в буквальном API, а в том, что библиотека должна разделить:

- lifecycle;
- outputs mapping;
- emit helpers;
- device-specific transport callbacks.
- и позволять брать каждый из этих слоёв отдельно.

## Минимальные компоненты пакета

Предлагаемая структура:

- `packages/adapter-kit/src/adapter-state-machine.ts`
- `packages/adapter-kit/src/output-map.ts`
- `packages/adapter-kit/src/signal-emit.ts`
- `packages/adapter-kit/src/scan-flow.ts`
- `packages/adapter-kit/src/autoconnect-policy.ts`
- `packages/adapter-kit/src/reconnect-policy.ts`
- `packages/adapter-kit/src/types.ts`
- `packages/adapter-kit/README.md`

Опционально, но не обязательно для `v1`:

- `packages/adapter-kit/src/define-adapter-plugin.ts`

Если такой файл появится, он должен быть только composition helper поверх более мелких модулей, а не единственной точкой входа в библиотеку.

## Первая волна миграции

Нельзя пытаться перевести все адаптеры сразу.

### Первая очередь

1. `fake-signal-adapter`
2. `shape-generator-adapter`
3. `plugins-trigno`

Почему так:

- fake-адаптеры проще всего проверяют lifecycle и `auto-on-init`;
- `Trigno` проверяет, что mapping и `paused/start` flow не абстрагированы слишком грубо.

### Вторая очередь

4. `plugins-ant-plus`
5. `plugins-ble`

Почему позже:

- там выше доля device-specific scan/connect semantics;
- если начать с них, библиотека быстро станет слишком общей и распухнет раньше времени.

## Критерии готовности `v1`

`adapter-kit` можно считать удачным первым этапом, если выполняются все условия:

1. Новый или существующий adapter-plugin можно описать без ручного дублирования state events.
2. Output streams описываются декларативно через mapping-слой.
3. В mapping-слое можно задавать внешние имена, units, sample format и timeline policy.
4. Поддерживаются lifecycle policies `manual` и `auto-on-init`.
5. Поддерживается каркас `auto-from-persisted-profile`, даже если storage профилей ещё не реализован полностью.
6. `fake` и `Trigno` удаётся перевести без потери поведения.
7. В runtime не появляется общий менеджер всех устройств.
8. Любой адаптер может использовать только нужный subset helper'ов, без обязательного подключения всего `adapter-kit`.

## Риски

### Риск 1. `adapter-kit` станет общим device framework

Если попытаться уравнять Trigno, BLE, ANT+ и synthetic adapters под одну богатую абстракцию, библиотека быстро станет тяжелее самих адаптеров.

Снижение риска:

- выносить только повторяющуюся инфраструктуру;
- transport и boundary оставлять внутри конкретных plugin-пакетов.

### Риск 2. Mapping сведут к строковым alias

Если mapping ограничить только rename channel'ов, он не решит реальные задачи таймлайна, units и scaling.

Снижение риска:

- output descriptor должен описывать источник, units, sample format, transform и timeline.

### Риск 3. `autoconnect` превратится в магию

Если адаптер сам начнёт без условий переподключаться и стартовать, оператор потеряет контроль.

Снижение риска:

- вместо булева `autoconnect` использовать явную lifecycle policy;
- для реальных устройств включать автоподключение только через сохранённый профиль и явный режим.

### Риск 4. Watchdog станет ложным универсальным решением

Для разных устройств “тишина” означает разное.

Снижение риска:

- в kit выносить только timers/backoff helpers;
- device-specific правила деградации и reconnect оставлять в адаптере.

## Следующий этап после `v1`

Если `adapter-kit v1` окажется жизнеспособным, дальше можно добавлять:

- profile registry для сохранённых connect profiles;
- общий helper для status snapshot refresh;
- optional start/stop gate helpers для адаптеров типа `Trigno`.

Но это должно идти только после перевода fake + Trigno и проверки, что библиотека не мешает реальному transport-коду.

## Итоговое решение

Для `sensync2` правильное направление такое:

- добавить `packages/adapter-kit` как библиотеку для adapter-plugin'ов;
- вынести туда lifecycle helpers, output mapping, emit helpers, autoconnect/reconnect policy и scan/connect flow helpers;
- не выносить туда transport, UI schema и device-specific boundary;
- опереться на уже существующий опыт `Trigno`, где mapping фактически уже есть, но пока разрознен между transport и adapter-логикой.

Это даст reuse без возврата к центральному manager-подходу старой системы.
