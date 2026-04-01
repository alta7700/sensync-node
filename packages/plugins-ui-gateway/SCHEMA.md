# packages/plugins-ui-gateway/SCHEMA.md

Concrete-схемы UI, которые materialize'ит `ui-gateway`.

Важно:

- Это не общая спецификация `UiSchema`.
- Это описание именно профильных demo-схем из [packages/plugins-ui-gateway/src/profile-schemas.ts](src/profile-schemas.ts).

## 1. Launch profiles

Сейчас runtime profiles используют шесть concrete-схем:

- `fake`
- `fake-hdf5-simulation`
- `veloerg`
- `veloerg-replay`
- `pedaling-emg-test`
- `pedaling-emg-replay`

`fake` — дефолтный dev-профиль. Сама схема больше не выбирается внутри `ui-gateway`, а передаётся ему из `apps/runtime/src/profiles/README.md`.

Важно:

- `fake-signal-adapter` теперь auto-connect'ится на `onInit`, поэтому `adapter.fake.state` обычно быстро переходит в `connected` без отдельного клика.
- `shape-generator-adapter` manual по-прежнему требует явного `adapter.connect.request`.
- Для derived UI-флагов схема теперь использует `UiSchema.derivedFlags`, а не hidden special-case внутри `ui-gateway`.

## 2. Профиль `fake`

### Страница

- Одна страница: `main`.
- Заголовок страницы: `Main`.

Раскладка строк:

- `controls-main | status-main`
- `chart-fake-a1`
- `chart-fake-a2`
- `chart-fake-b`
- `telemetry-main`

### Controls

Виджет:

- `controls-main`

Кнопки:

- `toggle-shapes`
  - управляет `adapter.connect.request` / `adapter.disconnect.request` для `adapterId = shapes`
- `shape-sine`
  - отправляет `shape.generate.request` с `shapeName = sine`
  - доступна только когда `adapter.shapes.state = connected`
- `shape-triangle`
  - отправляет `shape.generate.request` с `shapeName = triangle`
  - доступна только когда `adapter.shapes.state = connected`
- `shape-pulse`
  - отправляет `shape.generate.request` с `shapeName = pulse`
  - доступна только когда `adapter.shapes.state = connected`
- `toggle-interval`
  - если `adapter.fake.state = connected` и `interval.active = false`
    - label: `Старт интервала`
    - команда: `label.mark.request`
    - payload: `{ labelId: "interval", value: 1 }`
  - если `adapter.fake.state = connected` и `interval.active = true`
    - label: `Стоп интервала`
    - команда: `label.mark.request`
    - payload: `{ labelId: "interval", value: 0 }`
- `toggle-recording`
  - если `adapter.fake.state = connected` и `recording.local.state ∈ { idle, failed }`
    - label: `Начать запись`
    - команда: `recording.start`
  - если `recording.local.state = recording`
    - label: `Пауза записи`
    - команда: `recording.pause`
  - если `recording.local.state = paused`
    - label: `Продолжить запись`
    - команда: `recording.resume`
- `stop-recording`
  - видима только если `recording.local.state ∈ { recording, paused, stopping }`
  - основная команда: `recording.stop`
- `timeline-reset`
  - если `adapter.fake.state = connected`, `adapter.shapes.state = connected` и запись не активна
    - label: `Сбросить timeline`
    - команда: `timeline.reset.request`
    - payload: `{ reason: "manual_fake_reset" }`

Особенность demo:

- manual connect/disconnect для `fake` больше нет: источник уже должен быть в `connected` после старта профиля;
- `recording.start` сейчас отправляет фиксированные metadata:
  - `testie = fake-demo`
  - `profile = fake`
- Это временное ограничение текущего UI: у нас пока кнопки, но нет поля ввода metadata.

### Status

Виджет:

- `status-main`

Показываемые флаги:

- `adapter.fake.state`
- `adapter.shapes.state`
- `interval.active`
  - initial default: `false`
  - задаётся через `schema.derivedFlags`
  - дальше materialize'ится по последней метке `interval.label`
- `adapter.fake.state` и `adapter.shapes.state`
  - после timeline reset переизлучаются participant-плагинами как persistent snapshots нового timeline
- `activity.active`
- `recording.local.state`
- `recording.local.filePath`

### Графики

#### Fake A1

- widget id: `chart-fake-a1`
- окно: `20_000 ms`
- ось Y: `[-1.2, 1.2]`
- серии:
  - `fake.a1` — линия
  - `shapes.signal` — линия
  - `interval.label` — interval overlay

Для `interval.label`:

- `1` = start
- `0` = end
- это не shared runtime-контракт, а семантика именно fake profile UI.

Derived flag для interval:

- `kind = latest-discrete-signal-value-map`
- `sourceStreamId = interval.label`
- `flagKey = interval.active`
- `initialValue = false`
- `valueMap = { "1": true, "0": false }`

Важно:

- это правило предназначено только для дискретных integer-like значений;
- если профилю понадобится derived flag по непрерывному `f32/f64` сигналу, нужен уже другой rule-kind, а не exact-match по float.

#### Fake A2

- widget id: `chart-fake-a2`
- окно: `20_000 ms`
- ось Y: `[-1.2, 1.2]`
- серии:
  - `fake.a2` — линия
  - `shapes.signal` — линия
  - `interval.label` — interval overlay

#### Fake B

- widget id: `chart-fake-b`
- окно: `20_000 ms`
- ось Y: `[-0.7, 0.7]`
- серии:
  - `fake.b` — линия

### Telemetry

Виджет:

- `telemetry-main`

Показывает:

- queue telemetry runtime;
- latest plugin metrics, если они публикуются плагинами;
- общее число drops.

## 3. Профиль `fake-hdf5-simulation`

Назначение:

- переходный профиль, который оставляет fake-ориентированные графики,
- но источник данных уже не live fake adapter, а `hdf5-simulation-adapter`.

### Страница

- Одна страница: `main`.
- Заголовок страницы: `Main`.

Раскладка строк:

- `controls-main | status-main`
- `chart-fake-a1`
- `chart-fake-a2`
- `chart-fake-b`
- `telemetry-main`

### Controls

Виджет:

- `controls-main`

Кнопки:

- `toggle-fake-hdf5-simulation`
  - если `adapter.fake-hdf5-simulation.state = disconnected`
    - label: `Подключить simulation`
    - команда: `adapter.connect.request`
  - если `adapter.fake-hdf5-simulation.state = connected`
    - label: `Пауза simulation`
    - команда: `simulation.pause.request`
  - если `adapter.fake-hdf5-simulation.state = paused`
    - label: `Продолжить simulation`
    - команда: `simulation.resume.request`
- `disconnect-fake-hdf5-simulation`
  - видима только если `adapter.fake-hdf5-simulation.state ∈ { connected, paused, disconnecting }`
  - основная команда: `adapter.disconnect.request`
- `speed-*`
  - набор фиксированных кнопок скоростей как и в общем simulation-профиле

### Status

Показываемые флаги:

- `adapter.fake-hdf5-simulation.state`
- `simulation.fake-hdf5-simulation.speed`
- `simulation.fake-hdf5-simulation.filePath`
- `simulation.fake-hdf5-simulation.message`

### Графики

Графики совпадают по layout с `fake`, но получают данные уже из файла:

- `chart-fake-a1`
  - `fake.a1`
  - `shapes.signal`
  - `interval.label`
- `chart-fake-a2`
  - `fake.a2`
  - `shapes.signal`
  - `interval.label`
- `chart-fake-b`
  - `fake.b`

### Telemetry

- `telemetry-main`
- Показывает queue telemetry runtime и latest plugin metrics.

## 4. Профиль `veloerg`

Назначение:

- live composite-профиль для ANT+/Moxy, BLE/Zephyr, generic HR-from-RR/DFA processors и TCP/Trigno;
- Moxy даёт живые графики `SmO2` и `tHb`, Zephyr даёт live-графики `RR/HR/DFA-a1`, а Trigno пока остаётся только raw-источником `EMG + Gyroscope` без pedaling-derived слоёв.

### Страница

- Одна страница: `main`.
- Заголовок страницы: `Veloerg`.

Раскладка страницы задаётся через `page.layout`:

- верхний `row` делит экран на две зоны:
  - слева находится `status-main`
  - справа находится `column` с grid controls:
    - `controls-trigno` на всю ширину
    - ниже `row`: `controls-main | controls-zephyr`
    - ниже `controls-lactate-power` на всю ширину
    - ниже `controls-recording` на всю ширину
- ниже идут отдельные `row`:
  - `chart-trigno-emg | chart-trigno-gyro`
  - `chart-moxy-smo2 | chart-moxy-thb`
  - `chart-lactate | chart-power`
  - `chart-zephyr-rr | chart-zephyr-hr`
  - `chart-zephyr-dfa-a1`
  - `telemetry-main`

### Controls

Виджеты:

- `controls-trigno`
- `controls-main`
- `controls-zephyr`
- `controls-lactate-power`
- `controls-recording`

Кнопки:

- `connect-trigno`
  - открывает modal form `connect-trigno-trigno`
  - submit формы отправляет `adapter.connect.request` для `adapterId = trigno`
  - форма содержит:
    - `host`
    - `sensorSlot`
- `disconnect-trigno`
  - видима только если `adapter.trigno.state ∈ { connected, paused, failed, disconnecting }`
  - отправляет `adapter.disconnect.request`
- `start-trigno`
  - видима только если `adapter.trigno.state = paused`
  - отправляет `trigno.stream.start.request`
- `stop-trigno`
  - видима только если `adapter.trigno.state = connected`
  - отправляет `trigno.stream.stop.request`
- `refresh-trigno`
  - видима только если `adapter.trigno.state ∈ { connected, paused }`
  - отправляет `trigno.status.refresh.request`
- `scan-moxy`
  - в базовом состоянии отправляет `adapter.scan.request` для `adapterId = ant-plus`
  - одновременно открывает локальную modal form `connect-moxy-ant-plus`
  - форма содержит `select`, который читает runtime-driven options из `adapter.ant-plus.scan.candidates`
  - submit формы отправляет `adapter.connect.request`
- `disconnect-moxy`
  - видима только если `adapter.ant-plus.state ∈ { connected, failed, disconnecting }`
  - в `connected` отправляет `adapter.disconnect.request`
  - в `failed` тоже отправляет `adapter.disconnect.request`, чтобы сбросить состояние
- `mark-lactate`
  - находится в виджете `controls-lactate-power`
  - открывает modal form `mark-lactate`
  - submit формы отправляет `label.mark.request`
  - payload содержит:
    - `labelId = lactate`
    - `atTimeMs`, собранный из `timelineTimeInput` как абсолютный `session time`
    - `value`
- `power-plus-30`
  - находится в виджете `controls-lactate-power`
  - отправляет `label.mark.request`
  - payload содержит `labelId = power`
  - `value` собирается на клиенте из derived UI-flag `power.current` через `payloadBindings`:
    - fallback `0`
    - затем `+30`
    - итог округляется до integer
- `set-power`
  - находится в виджете `controls-lactate-power`
  - открывает modal form `set-power`
  - submit формы отправляет `label.mark.request`
  - payload содержит:
    - `labelId = power`
    - `value`
- `toggle-recording`
  - вынесена в отдельный виджет `controls-recording`
  - если `adapter.ant-plus.state = connected`, `adapter.zephyr-bioharness.state = connected`, `adapter.trigno.state = connected`
    и `recording.local.state ∈ { idle, failed, null }`
    - label: `Начать запись`
    - команда: `recording.start`
  - если `recording.local.state = recording`
    - label: `Пауза записи`
    - команда: `recording.pause`
  - если `recording.local.state = paused`
    - label: `Продолжить запись`
    - команда: `recording.resume`
- `stop-recording`
  - находится в виджете `controls-recording`
  - видима только если `recording.local.state ∈ { recording, paused, stopping }`
  - основная команда: `recording.stop`
- `scan-zephyr`
  - в базовом состоянии отправляет `adapter.scan.request` для `adapterId = zephyr-bioharness`
  - одновременно открывает локальную modal form `connect-zephyr-zephyr-bioharness`
  - форма содержит `select`, который читает runtime-driven options из `adapter.zephyr-bioharness.scan.candidates`
  - submit формы отправляет `adapter.connect.request`
- `disconnect-zephyr`
  - видима только если `adapter.zephyr-bioharness.state ∈ { connected, failed, disconnecting }`
  - в `connected` отправляет `adapter.disconnect.request`
  - в `failed` тоже отправляет `adapter.disconnect.request`, чтобы сбросить состояние

### Status

Показываемые флаги:

- `adapter.trigno.state`
- `adapter.trigno.message`
- `trigno.host`
- `trigno.sensorSlot`
- `trigno.mode`
- `trigno.startIndex`
- `trigno.serial`
- `trigno.firmware`
- `trigno.backwardsCompatibility`
- `trigno.upsampling`
- `trigno.emgRateHz`
- `trigno.gyroRateHz`
- `adapter.ant-plus.state`
- `adapter.ant-plus.scanning`
- `adapter.ant-plus.scanMessage`
- `adapter.ant-plus.message`
- `adapter.zephyr-bioharness.state`
- `adapter.zephyr-bioharness.scanning`
- `adapter.zephyr-bioharness.scanMessage`
- `adapter.zephyr-bioharness.message`
- `power.current`
  - задаётся через `schema.derivedFlags`
  - materialize'ится по последнему numeric value из `power.label`
- `recording.local.state`
- `recording.local.filePath`

### Графики

- `chart-trigno-emg`
  - окно: `20_000 ms`
  - поток: `trigno.avanti`
  - ось Y: `V`
- `chart-trigno-gyro`
  - окно: `20_000 ms`
  - потоки:
    - `trigno.avanti.gyro.x`
    - `trigno.avanti.gyro.y`
    - `trigno.avanti.gyro.z`
  - ось Y: `deg/s`
- `chart-moxy-smo2`
  - окно: `20_000 ms`
  - поток: `moxy.smo2`
  - ось Y: `[40, 100] %`
- `chart-moxy-thb`
  - окно: `20_000 ms`
  - поток: `moxy.thb`
  - ось Y: `[8, 18] g/dL`
- `chart-lactate`
  - окно: `1_200_000 ms`
  - поток: `lactate.label`
  - тип серии: `scatter`
  - ось Y: `[0, auto] mmol/L`
- `chart-power`
  - окно: `1_200_000 ms`
  - поток: `power.label`
  - тип серии: `line`
  - interpolation: `step-after`
  - ось Y: `[0, auto] W`
- `chart-zephyr-rr`
  - окно: `20_000 ms`
  - поток: `zephyr.rr`
  - ось Y: `[0.3, 1.8] s`
- `chart-zephyr-hr`
  - окно: `20_000 ms`
  - поток: `zephyr.hr`
  - ось Y: `[40, 220] bpm`
- `chart-zephyr-dfa-a1`
  - окно: `120_000 ms`
  - поток: `zephyr.dfa_a1`
  - ось Y: `[0.4, 1.8]`

### Telemetry

- `telemetry-main`
- Для `veloerg` сюда также попадают latest metrics качества ANT+ канала от `ant-plus-adapter` и BLE/Zephyr transport metrics от `zephyr-bioharness-3-adapter`.

## 5. Профиль `veloerg-replay`

Назначение:

- replay-профиль для HDF5-файлов, записанных из `veloerg`;
- повторяет основной графический layout `veloerg`, но без live transport и без recorder control-блока.

### Страница

- Одна страница: `main`.
- Заголовок страницы: `Veloerg replay`.

Раскладка страницы:

- `status-main | controls-main`
- `chart-trigno-emg | chart-trigno-gyro`
- `chart-moxy-smo2 | chart-moxy-thb`
- `chart-lactate | chart-power`
- `chart-zephyr-rr | chart-zephyr-hr`
- `chart-zephyr-dfa-a1`
- `telemetry-main`

### Controls

Виджеты:

- `controls-main`

Кнопки:

- `toggle-veloerg-replay`
  - в базовом состоянии открывает modal form выбора HDF5 и отправляет `adapter.connect.request`
  - после подключения переключается в `simulation.pause.request`
  - после паузы переключается в `simulation.resume.request`
- `disconnect-veloerg-replay`
  - видима только если replay уже подключён или на паузе
  - отправляет `adapter.disconnect.request`
- `speed-*`
  - меняют `simulation.speed.set.request`

### Status

Показываемые флаги:

- `adapter.veloerg-replay.state`
- `adapter.veloerg-replay.message`
- `simulation.veloerg-replay.speed`
- `simulation.veloerg-replay.batchMs`
- `simulation.veloerg-replay.filePath`
- `simulation.veloerg-replay.message`
- `power.current`
  - задаётся через `schema.derivedFlags`
  - materialize'ится по последнему numeric value из `power.label`

### Графики

- `chart-trigno-emg`
  - поток: `trigno.avanti`
- `chart-trigno-gyro`
  - потоки:
    - `trigno.avanti.gyro.x`
    - `trigno.avanti.gyro.y`
    - `trigno.avanti.gyro.z`
- `chart-moxy-smo2`
  - поток: `moxy.smo2`
- `chart-moxy-thb`
  - поток: `moxy.thb`
- `chart-lactate`
  - поток: `lactate.label`
  - тип серии: `scatter`
- `chart-power`
  - поток: `power.label`
  - тип серии: `line`
  - interpolation: `step-after`
- `chart-zephyr-rr`
  - поток: `zephyr.rr`
- `chart-zephyr-hr`
  - поток: `zephyr.hr`
- `chart-zephyr-dfa-a1`
  - поток: `zephyr.dfa_a1`

### Telemetry

- `telemetry-main`

## 6. Общие правила flags и stream declarations

## 7. Профиль `pedaling-emg-test`

Назначение:

- отдельный live-профиль для записи и отладки raw `Trigno EMG + Gyroscope`;
- без ANT+/BLE-датчиков, но с тем же `pedaling-emg-processor`, который строит phase/activity overlays и confidence-диагностику.

### Страница

- Одна страница: `main`.
- Заголовок страницы: `Pedaling EMG test`.

Раскладка строк:

- `status-main | controls-column`
- `chart-trigno-emg | chart-trigno-gyro`
- `chart-pedaling-confidence | chart-pedaling-cycle-period`
- `telemetry-main`

Где `controls-column` содержит:

- `controls-trigno`
- `controls-recording`

### Controls

Виджеты:

- `controls-trigno`
- `controls-recording`

Кнопки `controls-trigno`:

- `connect-trigno`
  - открывает modal form `connect-trigno-trigno`
  - submit формы отправляет `adapter.connect.request` для `adapterId = trigno`
- `disconnect-trigno`
  - видима только если `adapter.trigno.state ∈ { connected, paused, failed, disconnecting }`
- `start-trigno`
  - видима только если `adapter.trigno.state = paused`
  - отправляет `trigno.stream.start.request`
- `stop-trigno`
  - видима только если `adapter.trigno.state = connected`
  - отправляет `trigno.stream.stop.request`
- `refresh-trigno`
  - видима только если `adapter.trigno.state ∈ { connected, paused }`
  - отправляет `trigno.status.refresh.request`

Кнопки `controls-recording`:

- `toggle-recording`
  - если `adapter.trigno.state = connected` и `recording.local.state ∈ { idle, failed, null }`
    - label: `Начать запись`
    - команда: `recording.start`
    - запись фиксирует только raw `Trigno`-каналы:
      - `trigno.avanti`
      - `trigno.avanti.gyro.x`
      - `trigno.avanti.gyro.y`
      - `trigno.avanti.gyro.z`
  - если `recording.local.state = recording`
    - label: `Пауза записи`
    - команда: `recording.pause`
  - если `recording.local.state = paused`
    - label: `Продолжить запись`
    - команда: `recording.resume`
- `stop-recording`
  - видима только если `recording.local.state ∈ { recording, paused, stopping }`
  - отправляет `recording.stop`

### Status

Показываемые флаги:

- `adapter.trigno.state`
- `adapter.trigno.message`
- `trigno.host`
- `trigno.sensorSlot`
- `trigno.mode`
- `trigno.startIndex`
- `trigno.serial`
- `trigno.firmware`
- `trigno.backwardsCompatibility`
- `trigno.upsampling`
- `trigno.emgRateHz`
- `trigno.gyroRateHz`
- `recording.local.state`
- `recording.local.filePath`

### Графики

- `chart-trigno-emg`
  - поток: `trigno.avanti`
  - overlay interval stream: `pedaling.phase.coarse`
  - overlay interval stream: `pedaling.activity.vastus-lateralis`
- `chart-trigno-gyro`
  - потоки:
    - `trigno.avanti.gyro.x`
    - `trigno.avanti.gyro.y`
    - `trigno.avanti.gyro.z`
  - overlay interval stream: `pedaling.phase.coarse`
- `chart-pedaling-confidence`
  - потоки:
    - `pedaling.phase.confidence`
    - `pedaling.emg.confidence`
- `chart-pedaling-cycle-period`
  - поток: `pedaling.cycle.period-ms`

## 6. Профиль `pedaling-emg-replay`

Назначение:

- replay-профиль для тех же raw `Trigno EMG + Gyroscope` потоков из HDF5;
- позволяет выбрать файл перед `connect`, эмулировать воспроизведение и прогонять тот же `pedaling-emg-processor`.

### Страница

- Одна страница: `main`.
- Заголовок страницы: `Pedaling EMG replay`.

Раскладка строк:

- `status-main | controls-main`
- `chart-trigno-emg | chart-trigno-gyro`
- `chart-pedaling-confidence | chart-pedaling-cycle-period`
- `telemetry-main`

### Controls

Виджет:

- `controls-main`

Кнопки:

- `toggle-pedaling-emg-replay`
  - если `adapter.pedaling-emg-replay.state = disconnected`
    - label: `Подключить replay`
    - команда: `adapter.connect.request`
    - открывает modal form, которая собирает `formData.filePath`
  - если `adapter.pedaling-emg-replay.state = connected`
    - label: `Пауза replay`
    - команда: `simulation.pause.request`
  - если `adapter.pedaling-emg-replay.state = paused`
    - label: `Продолжить replay`
    - команда: `simulation.resume.request`
- `disconnect-pedaling-emg-replay`
  - видима только если `adapter.pedaling-emg-replay.state ∈ { connected, paused, disconnecting }`
  - отправляет `adapter.disconnect.request`
- `speed-*`
  - набор кнопок скоростей симуляции

Modal form replay:

- содержит `fileInput` с `fieldId = filePath`
- путь уходит в `adapter.connect.request.payload.formData.filePath`

### Status

Показываемые флаги:

- `adapter.pedaling-emg-replay.state`
- `adapter.pedaling-emg-replay.message`
- `simulation.pedaling-emg-replay.speed`
- `simulation.pedaling-emg-replay.batchMs`
- `simulation.pedaling-emg-replay.filePath`
- `simulation.pedaling-emg-replay.message`

### Графики

Графики совпадают по составу с `pedaling-emg-test`, но вход уже идёт из replay:

- `chart-trigno-emg`
  - `trigno.avanti`
  - `pedaling.phase.coarse`
  - `pedaling.activity.vastus-lateralis`
- `chart-trigno-gyro`
  - `trigno.avanti.gyro.x`
  - `trigno.avanti.gyro.y`
  - `trigno.avanti.gyro.z`
  - `pedaling.phase.coarse`
- `chart-pedaling-confidence`
  - `pedaling.phase.confidence`
  - `pedaling.emg.confidence`
- `chart-pedaling-cycle-period`
  - `pedaling.cycle.period-ms`

## 7. Общие правила flags и stream declarations

`ui-gateway` materialize'ит:

- flags patch для adapter state;
- flags patch для adapter scan state;
- flags patch для interval/activity state;
- flags patch для recorder state;
- flags patch для simulation state;
- `ui.form.options.patch` для runtime-driven options локальных форм;
- `ui.error` для recorder error, scan failure и adapter `failed`;
- `ui.warning` для мягких проблем ingress/runtime-contract слоя и `command.rejected`;
- `ui.stream.declare` при первом появлении stream;
- `ui.init` при подключении клиента.

Правило версий UI-команд:

- `UiControlAction.commandVersion` и `UiModalForm.submitEventVersion` можно задавать явно;
- если версия не указана, renderer отправляет `v=1`.

Правило stream registry:

- `streamNumericId` выдаётся последовательно, начиная с `1`;
- ID живёт только в рамках текущего запуска runtime;
- это транспортный идентификатор, а не стабильный domain ID.
