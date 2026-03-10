# packages/plugins-ui-gateway/SCHEMA.md

Текущая concrete-схема UI, которую materialize'ит `ui-gateway`.

Важно:

- Это не общая спецификация `UiSchema`.
- Это описание именно текущего demo/replay UI, собранного в [ui-gateway-plugin.ts](/Users/tascan/Documents/sirius/sensync2/packages/plugins-ui-gateway/src/ui-gateway-plugin.ts).

## 1. Страница

- Одна страница: `main`.
- Заголовок страницы: `Main`.

Раскладка строк:

- `controls-main | status-main`
- `chart-emg | chart-rr`
- `chart-moxy-smo2 | chart-moxy-thb`
- `chart-power | chart-lactate`
- `telemetry-main`

## 2. Controls

Виджет:

- `controls-main`

Кнопка:

- `toggle-replay`

Семантика состояний:

- если `adapter.velo-replay.state = disconnected`
  - label: `Запустить replay`
  - команда: `adapter.connect.request`
- если `adapter.velo-replay.state = connecting`
  - label: `Запуск replay...`
  - кнопка disabled
  - `isLoading = true`
- если `adapter.velo-replay.state = connected`
  - label: `Остановить replay`
  - команда: `adapter.disconnect.request`
- если `adapter.velo-replay.state = disconnecting`
  - label: `Остановка replay...`
  - кнопка disabled
  - `isLoading = true`

## 3. Status

Виджет:

- `status-main`

Показываемые флаги:

- `adapter.velo-replay.state`

## 4. Графики

### EMG

- widget id: `chart-emg`
- поток линии: `trigno.avanti`
- поток интервалов: `trigno.avanti.activity`
- окно: `20_000 ms`
- ось Y: `[-0.00035, 0.00035]`

Особенность:

- `trigno.avanti.activity` трактуется как label-stream:
  - `0` = start
  - `1` = end

### RR

- widget id: `chart-rr`
- поток: `zephyr.rr`
- окно: `20_000 ms`
- ось Y: `[0.2, 1.2]`

### SmO2

- widget id: `chart-moxy-smo2`
- поток: `moxy.smo2`
- окно: `120_000 ms`
- ось Y: `[30, 90]`

### tHb

- widget id: `chart-moxy-thb`
- поток: `moxy.thb`
- окно: `120_000 ms`
- ось Y: `[11.2, 12.2]`

### Power

- widget id: `chart-power`
- поток: `power.watts`
- окно: `120_000 ms`
- ось Y: `[0, 180]`

### Lactate

- widget id: `chart-lactate`
- поток: `lactate.label`
- тип серии: `scatter`
- окно: `120_000 ms`
- ось Y: `[0, 6]`

## 5. Telemetry

Виджет:

- `telemetry-main`

Показывает:

- queue telemetry runtime;
- общее число drops.

## 6. Флаги и stream declarations

`ui-gateway` сейчас сам materialize'ит:

- flags patch для adapter state;
- `ui.stream.declare` при первом появлении stream;
- `ui.init` при подключении клиента.

Правило stream registry:

- `streamNumericId` выдаётся последовательно, начиная с `1`;
- ID живёт только в рамках текущего запуска runtime;
- это транспортный идентификатор, а не стабильный domain ID.
