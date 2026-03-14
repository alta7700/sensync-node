# packages/core

Общие контракты системы.

## Для чего

- Это источник истины для типов событий, UI schema, plugin manifest и бинарного UI wire.
- Любой модуль, который говорит на языке runtime или UI, должен опираться на этот пакет.
- Здесь же теперь живут shared-контракты для adapter scan flow и schema-driven modal forms.
- Здесь же теперь живут shared event contracts, версии событий и boundary-guards для UI ingress.
- Здесь же теперь живут exact union `UiCommandMessage` и допустимые `commandType/submitEventType` для schema-driven UI.
- Здесь же теперь живут helper'ы `createUiCommandMessage(...)` и `uiCommandMessageToRuntimeEventInput(...)`, чтобы bridge-cast не дублировался по runtime и client-runtime.

## Как работает

- Пакет не содержит бизнес-логики.
- Он описывает формы данных, registry shared-событий и вспомогательные функции для безопасной передачи `TypedArray` между потоками.

## Взаимодействие

- Используется всеми `apps/*` и почти всеми `packages/*`.
- Изменения здесь требуют синхронной проверки runtime, SDK, плагинов, desktop и client.

Дополнительно:

- Семантика контрактов описана в [packages/core/CONTRACTS.md](CONTRACTS.md).
