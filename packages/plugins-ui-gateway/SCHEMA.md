# packages/plugins-ui-gateway/SCHEMA.md

Concrete-схемы UI, которые materialize'ит `ui-gateway`.

Важно:

- Это не общая спецификация `UiSchema`.
- Это описание именно профильных demo-схем из [packages/plugins-ui-gateway/src/profile-schemas.ts](src/profile-schemas.ts).

## 1. Launch profiles

Сейчас runtime profiles используют три concrete-схемы:

- `fake`
- `fake-hdf5-simulation`
- `veloerg`

`fake` — дефолтный dev-профиль. Сама схема больше не выбирается внутри `ui-gateway`, а передаётся ему из `apps/runtime/src/profiles/README.md`.

Важно:

- `fake-signal-adapter` теперь auto-connect'ится на `onInit`, поэтому `adapter.fake.state` обычно быстро переходит в `connected` без отдельного клика.
- `shape-generator-adapter` manual по-прежнему требует явного `adapter.connect.request`.

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
    - команда: `interval.start`
  - если `adapter.fake.state = connected` и `interval.active = true`
    - label: `Стоп интервала`
    - команда: `interval.stop`
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

- live composite-профиль для ANT+/Moxy, BLE/Zephyr и TCP/Trigno;
- Moxy даёт живые графики `SmO2` и `tHb`, Zephyr даёт live-график `RR`, а Trigno даёт raw `EMG + Gyroscope`.

### Страница

- Одна страница: `main`.
- Заголовок страницы: `Veloerg`.

Раскладка страницы задаётся через `page.layout`:

- верхний `row` делит экран на две зоны:
  - левая `column` содержит:
    - `controls-trigno`
    - `controls-main`
    - `controls-zephyr`
  - справа находится `status-main`
- ниже идут отдельные `row`:
  - `chart-trigno-emg | chart-trigno-gyro`
  - `chart-moxy-smo2 | chart-moxy-thb`
  - `chart-zephyr-rr`
  - `telemetry-main`

### Controls

Виджеты:

- `controls-trigno`
- `controls-main`
- `controls-zephyr`

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
- `chart-zephyr-rr`
  - окно: `20_000 ms`
  - поток: `zephyr.rr`
  - ось Y: `[0.3, 1.8] s`

### Telemetry

- `telemetry-main`
- Для `veloerg` сюда также попадают latest metrics качества ANT+ канала от `ant-plus-adapter` и BLE/Zephyr transport metrics от `zephyr-bioharness-3-adapter`.

## 5. Общие правила flags и stream declarations

`ui-gateway` materialize'ит:

- flags patch для adapter state;
- flags patch для adapter scan state;
- flags patch для interval/activity state;
- flags patch для recorder state;
- flags patch для simulation state;
- `ui.form.options.patch` для runtime-driven options локальных форм;
- `ui.error` для recorder error, scan failure и adapter `failed`;
- `ui.warning` для мягких проблем ingress/runtime-contract слоя;
- `ui.stream.declare` при первом появлении stream;
- `ui.init` при подключении клиента.

Правило версий UI-команд:

- `UiControlAction.commandVersion` и `UiModalForm.submitEventVersion` можно задавать явно;
- если версия не указана, renderer отправляет `v=1`.

Правило stream registry:

- `streamNumericId` выдаётся последовательно, начиная с `1`;
- ID живёт только в рамках текущего запуска runtime;
- это транспортный идентификатор, а не стабильный domain ID.
