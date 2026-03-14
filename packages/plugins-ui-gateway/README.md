# packages/plugins-ui-gateway

UI gateway plugin.

## Для чего

- Это отдельный плагин-материализатор, который превращает внутренние runtime-события в UI-ориентированный поток.
- Здесь сосредоточена логика схемы UI, флагов, описания stream'ов и бинарного data wire.

## Как работает

- Плагин подписывается на `signal.batch`, adapter state, recorder state, simulation state, telemetry и другие факты.
- Он собирает `UiSchema`, flags snapshot/patches, dynamic form options и выдаёт binary batches с numeric stream IDs.
- При подключении UI-клиента отправляет `ui.init` и текущий снимок состояния.
- В materialized control-потоке теперь различаются `ui.warning` и `ui.error`.
- Concrete-схема зависит от launch profile (`fake`, `fake-hdf5-simulation` или `veloerg`).
- В `veloerg` live-графики держат короткое окно `20s`: в первой строке идут `SmO2` и `tHb`, во второй `RR` от Zephyr.
- `ui.telemetry` теперь несёт не только runtime queue snapshot, но и latest plugin metrics, например качество ANT+ канала и BLE/Zephyr transport.

## Взаимодействие

- Использует только публичные контракты `packages/core` и `packages/plugin-sdk`.
- Его output читает `packages/client-runtime`, а transport до renderer доставляет `apps/desktop`.

Дополнительно:

- Concrete-схемы профилей описаны в [packages/plugins-ui-gateway/SCHEMA.md](SCHEMA.md).
