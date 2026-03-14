# apps/runtime/src

Внутренности runtime host.

## Для чего

- Здесь лежит orchestration-логика ядра, которую не должны знать плагины и UI.

## Как работает

- `runtime-host.ts` — центральный coordinator: старт, маршрутизация, attach/detach UI-клиентов, telemetry.
- `plugin-host.ts` — адаптер между main runtime и конкретным worker-плагином, включая mailboxes и backpressure.
- `subscription-index.ts` — индекс подписок по event type/filter.
- `workspace-event-registry.ts` — единый registry событий workspace-уровня и валидация `(type, v)`/manifest.
- `session-clock.ts` — относительное время сессии.
- `default-plugins.ts` — описание launch profiles и их plugin-композиций.
- `launch-profile-boundary.ts` — boundary для `process.env` и file-path validation при сборке launch profiles.
- `main.ts` — standalone-точка входа, которая выбирает профиль через `SENSYNC2_PROFILE`.
- `runtime-host.ts` использует `uiCommandMessageToRuntimeEventInput(...)` из `packages/core`, чтобы не держать локальный bridge-cast между UI boundary и внутренним `RuntimeEventInput`.

## Взаимодействие

- Потребляет worker-протокол и event-контракты из `packages/core`.
- Работает уже не со строковыми "псевдо-ивентами", а с exact union `RuntimeEvent`, который собирается из shared/plugin-specific event map.
- Загружает plugin modules через `packages/plugin-sdk`.
- Наружу отдаёт API класса `RuntimeHost`, который использует `apps/desktop`.
- В `default-plugins.ts` зафиксированы базовый профиль `fake`, переходная композиция `fake-hdf5-simulation` и composite-профиль `veloerg` для ANT+/Moxy и BLE/Zephyr.
