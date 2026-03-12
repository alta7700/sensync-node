# packages/plugins-ui-gateway/SCHEMA.md

Concrete-схемы UI, которые materialize'ит `ui-gateway`.

Важно:

- Это не общая спецификация `UiSchema`.
- Это описание именно профильных demo-схем из [packages/plugins-ui-gateway/src/ui-gateway-plugin.ts](src/ui-gateway-plugin.ts).

## 1. Launch profiles

Сейчас `ui-gateway` поддерживает три concrete-схемы:

- `fake`
- `fake-hdf5-simulation`
- `veloerg`

`fake` — дефолтный dev-профиль.

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

- `toggle-fake`
  - управляет `adapter.connect.request` / `adapter.disconnect.request` для `adapterId = fake`
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

- минимальный live-профиль для ANT+/Moxy сценария;
- сейчас transport ещё fake, но UI, scan flow и data-path уже идут через те же runtime-контракты, что и будут использоваться дальше.

### Страница

- Одна страница: `main`.
- Заголовок страницы: `Veloerg`.

Раскладка строк:

- `controls-main | status-main`
- `chart-moxy-smo2`
- `chart-moxy-thb`
- `telemetry-main`

### Controls

Виджет:

- `controls-main`

Кнопки:

- `scan-moxy`
  - в базовом состоянии отправляет `adapter.scan.request` для `adapterId = ant-plus`
  - одновременно открывает локальную modal form `connect-moxy-ant-plus`
  - форма содержит `select`, который читает runtime-driven options из `adapter.ant-plus.scan.candidates`
  - submit формы отправляет `adapter.connect.request`
- `disconnect-moxy`
  - видима только если `adapter.ant-plus.state ∈ { connected, failed, disconnecting }`
  - в `connected` отправляет `adapter.disconnect.request`
  - в `failed` тоже отправляет `adapter.disconnect.request`, чтобы сбросить состояние

### Status

Показываемые флаги:

- `adapter.ant-plus.state`
- `adapter.ant-plus.scanning`
- `adapter.ant-plus.scanMessage`
- `adapter.ant-plus.message`

### Графики

- `chart-moxy-smo2`
  - окно: `20_000 ms`
  - поток: `moxy.smo2`
  - ось Y: `[40, 100] %`
- `chart-moxy-thb`
  - окно: `20_000 ms`
  - поток: `moxy.thb`
  - ось Y: `[8, 18] g/dL`

### Telemetry

- `telemetry-main`
- Для `veloerg` сюда также попадают latest metrics качества ANT+ канала от `ant-plus-adapter`.

## 5. Общие правила flags и stream declarations

`ui-gateway` materialize'ит:

- flags patch для adapter state;
- flags patch для adapter scan state;
- flags patch для interval/activity state;
- flags patch для recorder state;
- flags patch для simulation state;
- `ui.form.options.patch` для runtime-driven options локальных форм;
- `ui.error` для recorder error, scan failure и adapter `failed`;
- `ui.stream.declare` при первом появлении stream;
- `ui.init` при подключении клиента.

Правило stream registry:

- `streamNumericId` выдаётся последовательно, начиная с `1`;
- ID живёт только в рамках текущего запуска runtime;
- это транспортный идентификатор, а не стабильный domain ID.
