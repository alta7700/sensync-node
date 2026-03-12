# packages/plugins-ui-gateway

UI gateway plugin.

## Для чего

- Это отдельный плагин-материализатор, который превращает внутренние runtime-события в UI-ориентированный поток.
- Здесь сосредоточена логика схемы UI, флагов, описания stream'ов и бинарного data wire.

## Как работает

- Плагин подписывается на `signal.batch`, adapter state, recorder state, simulation state, telemetry и другие факты.
- Он собирает `UiSchema`, flags snapshot/patches и выдаёт binary batches с numeric stream IDs.
- При подключении UI-клиента отправляет `ui.init` и текущий снимок состояния.
- Concrete-схема зависит от launch profile (`fake` или `fake-hdf5-simulation`).

## Взаимодействие

- Использует только публичные контракты `packages/core` и `packages/plugin-sdk`.
- Его output читает `packages/client-runtime`, а transport до renderer доставляет `apps/desktop`.

Дополнительно:

- Concrete-схемы профилей описаны в [packages/plugins-ui-gateway/SCHEMA.md](SCHEMA.md).
