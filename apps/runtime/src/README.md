# apps/runtime/src

Внутренности runtime host.

## Для чего

- Здесь лежит orchestration-логика ядра, которую не должны знать плагины и UI.

## Как работает

- `runtime-host.ts` — центральный coordinator: старт, маршрутизация, attach/detach UI-клиентов, telemetry.
- `runtime-host.ts` после готовности всех worker'ов публикует shared startup-barrier `runtime.started`, чтобы adapter-автозапуск не терял ранние state/data события.
- `plugin-host.ts` — адаптер между main runtime и конкретным worker-плагином, включая mailboxes и backpressure.
- `subscription-index.ts` — индекс подписок по event type/filter.
- `workspace-event-registry.ts` — единый registry событий workspace-уровня и валидация `(type, v)`/manifest.
- `workspace-ui-command-boundary.ts` — агрегатор shared и plugin-specific UI guards для ingress из renderer.
- `session-clock.ts` — относительное время сессии.
- `default-plugins.ts` — описание launch profiles и их plugin-композиций.
- `default-plugins.ts` также фиксирует transport-sensitive режимы устройств, например `BC=OFF + UPSAMPLE=OFF` для Trigno в профиле `veloerg`.
- `launch-profile-boundary.ts` — boundary для `process.env` и file-path validation при сборке launch profiles.
- `main.ts` — standalone-точка входа, которая выбирает профиль через `SENSYNC2_PROFILE`.
- `runtime-host.ts` использует `uiCommandMessageToRuntimeEventInput(...)` из `packages/core`, чтобы не держать локальный bridge-cast между UI boundary и внутренним `RuntimeEventInput`.

## Взаимодействие

- Потребляет worker-протокол и event-контракты из `packages/core`.
- Работает уже не со строковыми "псевдо-ивентами", а с exact union `RuntimeEvent`, который собирается из shared/plugin-specific event map.
- Загружает plugin modules через `packages/plugin-sdk`.
- Наружу отдаёт API класса `RuntimeHost`, который использует `apps/desktop`.
- В `default-plugins.ts` зафиксированы базовый профиль `fake`, переходная композиция `fake-hdf5-simulation` и composite-профиль `veloerg` для ANT+/Moxy, BLE/Zephyr и TCP/Trigno.
