# packages/core

Общие контракты системы.

## Для чего

- Это источник истины для типов событий, UI schema, plugin manifest и бинарного UI wire.
- Любой модуль, который говорит на языке runtime или UI, должен опираться на этот пакет.
- Здесь же теперь живут shared-контракты для adapter scan flow и schema-driven modal forms.
- Здесь же теперь живут shared event contracts, версии событий и boundary-guards для UI ingress.
- Здесь же теперь живёт generic shared-команда `label.mark.request` для label-stream сценариев вроде interval/lactate.
- Здесь же теперь живёт shared fact `command.rejected` для мягких отказов команд, которые нужно донести до UI без падения worker'а.
- Здесь же теперь живёт shared fact `viewer.state.changed` для интерактивного HDF5 history-viewer режима, включая file-level scalar metadata.
- Здесь же теперь живут exact union `UiCommandMessage`, расширяемая карта `UiCommandBoundaryEventMap` и допустимые `commandType/submitEventType` для schema-driven UI.
- Здесь же теперь живёт declarative layout-модель `UiPage.layout`, чтобы renderer не угадывал сложную раскладку по `widgetRows`.
- Здесь же теперь живут declarative `UiSchema.derivedFlags`, чтобы UI мог выводить локальные флаги из live-потоков без отдельного runtime fact.
- Здесь же теперь живут client-side `payloadBindings`, `timelineTimeInput` и `submitTarget`, чтобы schema-driven UI мог собирать top-level payload без ad-hoc логики в профилях.
- Здесь же теперь живут helper'ы `createUiCommandMessage(...)` и `uiCommandMessageToRuntimeEventInput(...)`, чтобы bridge-cast не дублировался по runtime и client-runtime.

## Как работает

- Пакет не содержит бизнес-логики.
- Он описывает формы данных, registry shared-событий и вспомогательные функции для безопасной передачи `TypedArray` между потоками.
- Для live-stream/data-path каноническим публичным идентификатором считается только `streamId`.
- Для UI schema пакет также фиксирует `viewportMode` графиков, именованные поля status-виджетов и marker'ы графиков по flag-значениям, чтобы renderer одинаково трактовал tail/history-режим и profile-specific UI-аннотации вроде stop-line.

## Взаимодействие

- Используется всеми `apps/*` и почти всеми `packages/*`.
- Изменения здесь требуют синхронной проверки runtime, SDK, плагинов, desktop и client.

Дополнительно:

- Семантика контрактов описана в [packages/core/CONTRACTS.md](CONTRACTS.md).
