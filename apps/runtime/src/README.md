# apps/runtime/src

Внутренности runtime host.

## Для чего

- Здесь лежит orchestration-логика ядра, которую не должны знать плагины и UI.

## Как работает

- `runtime-host.ts` — центральный coordinator: старт, маршрутизация, attach/detach UI-клиентов, telemetry.
- `plugin-host.ts` — адаптер между main runtime и конкретным worker-плагином, включая mailboxes и backpressure.
- `subscription-index.ts` — индекс подписок по event type/filter.
- `session-clock.ts` — относительное время сессии.
- `default-plugins.ts` — описание launch profiles и их plugin-композиций.
- `main.ts` — standalone-точка входа, которая выбирает профиль через `SENSYNC2_PROFILE`.

## Взаимодействие

- Потребляет worker-протокол и event-контракты из `packages/core`.
- Загружает plugin modules через `packages/plugin-sdk`.
- Наружу отдаёт API класса `RuntimeHost`, который использует `apps/desktop`.
- В `default-plugins.ts` зафиксированы базовый профиль `fake` и переходная композиция `fake-hdf5-simulation`.
