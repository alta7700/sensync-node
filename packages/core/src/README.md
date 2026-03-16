# packages/core/src

Исходники общих контрактов `sensync2`.

## Для чего

- Описывают единый язык системы.

## Как работает

- `events.ts` — runtime-события и payload signal batch.
- `events.ts` также описывает shared command `label.mark.request` для generic label-generator сценариев.
- `events.ts` также описывает shared fact `command.rejected` для мягких отказов команд без worker-crash.
- `events.ts` также описывает shared startup-barrier `runtime.started`, который runtime публикует после регистрации всех manifest'ов в индексе подписок.
- `generated-runtime-event-map.ts` — сгенерированная карта exact event union для shared-событий.
- `runtime-event-map.spec.ts` — декларативное описание shared event map для генератора, не Vitest-suite.
- `runtime-event-map-codegen.ts` — типы для сборки event map из shared и plugin-specific spec-файлов.
- `event-types.ts` — словарь фиксированных event type строк.
- `event-contracts.ts` — базовые типы registry для `(type, v)`.
- `shared-event-contracts.ts` — shared runtime-контракты, которые знает вся система.
- `ui-command-boundary.ts` — boundary guards для UI-команд до попадания в шину и расширяемая карта `UiCommandBoundaryEventMap` для shared/plugin-specific UI-команд, включая `label.mark.request`.
- `plugin.ts` — manifest, subscriptions, telemetry и plugin snapshot.
- `ui.ts` — schema-driven UI модель, declarative layout `row/column/widget`, control rules, modal forms, dynamic form options, stream declarations, `derivedFlags` и helper'ы `createUiCommandMessage(...)` / `uiCommandMessageToRuntimeEventInput(...)`.
- `ui-wire.ts` — бинарный формат батчей для UI.
- `ui-command-helpers.test.ts` — точечный тест на bridge между UI-командой и внутренним runtime-event input.
- `worker-protocol.ts` — протокол сообщений между main runtime и plugin worker'ом.

## Взаимодействие

- На эти файлы опираются `apps/runtime`, `apps/desktop`, `apps/client`, `packages/plugin-sdk`, `packages/client-runtime` и все плагины.
- `events.ts` экспортирует `defineRuntimeEventInput(...)`, `RuntimeEventInput` и exact `RuntimeEvent`, которыми должны пользоваться runtime и плагины при создании событий.
- Текстовое описание семантики находится в [packages/core/CONTRACTS.md](../CONTRACTS.md).
