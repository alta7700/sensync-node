# packages/plugins-ui-gateway

UI gateway plugin.

## Для чего

- Это отдельный плагин-материализатор, который превращает внутренние runtime-события в UI-ориентированный поток.
- Здесь сосредоточена логика схемы UI, флагов, описания stream'ов и бинарного data wire.

## Как работает

- Плагин подписывается на `signal.batch`, adapter state, telemetry и другие факты.
- Он собирает `UiSchema`, flags snapshot/patches и выдаёт binary batches с numeric stream IDs.
- При подключении UI-клиента отправляет `ui.init` и текущий снимок состояния.

## Взаимодействие

- Использует только публичные контракты `packages/core` и `packages/plugin-sdk`.
- Его output читает `packages/client-runtime`, а transport до renderer доставляет `apps/desktop`.

Дополнительно:

- Текущая concrete-схема UI описана в [SCHEMA.md](/Users/tascan/Documents/sirius/sensync2/packages/plugins-ui-gateway/SCHEMA.md).
