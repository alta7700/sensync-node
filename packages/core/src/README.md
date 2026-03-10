# packages/core/src

Исходники общих контрактов `sensync2`.

## Для чего

- Описывают единый язык системы.

## Как работает

- `events.ts` — runtime-события и payload signal batch.
- `event-types.ts` — словарь фиксированных event type строк.
- `plugin.ts` — manifest, subscriptions, telemetry и plugin snapshot.
- `ui.ts` — schema-driven UI модель, control rules и stream declarations.
- `ui-wire.ts` — бинарный формат батчей для UI.
- `worker-protocol.ts` — протокол сообщений между main runtime и plugin worker'ом.

## Взаимодействие

- На эти файлы опираются `apps/runtime`, `apps/desktop`, `apps/client`, `packages/plugin-sdk`, `packages/client-runtime` и все плагины.
- Текстовое описание семантики находится в [../CONTRACTS.md](/Users/tascan/Documents/sirius/sensync2/packages/core/CONTRACTS.md).
