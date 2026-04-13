# packages/client-runtime

Runtime слой для renderer/UI.

## Для чего

- Материализует control и binary поток в удобное состояние для UI.
- Хранит флаги, stream registry, dynamic form options, уведомления UI и кольцевые буферы сигналов.

## Как работает

- Принимает transport с интерфейсом `ClientTransport`.
- После `ui.init` создаёт локальную картину сессии.
- Binary frames пишет в `StreamBufferStore`, а UI читает окна данных по запросу.
- `sendCommand(...)` теперь отправляет не только `eventType`, но и `eventVersion`, а сборка `UiCommandMessage` централизована через `createUiCommandMessage(...)`.
- `ui.warning` materialize'ится отдельно от `ui.error`, но попадает в тот же список уведомлений.
- `ui.timeline.reset` очищает только timeline-local буферы, но не теряет schema и stream registry.
- Для диагностики stop-flow runtime пишет в stdout короткий лог на `ui.flags.patch` с recording-флагами и на `ui.timeline.reset`.
- `getVisibleWindow(...)` возвращает X уже относительно `clock.timelineStartSessionMs`, а не относительно глобального старта runtime-сессии.
- `getVisibleWindow(...)` теперь может по запросу включать последнюю точку до начала окна, чтобы ступенчатые setpoint-графики не рвались на левом краю.
- `getLatestValue(...)`, `getLatestValues(...)` и `getLatestEntries(...)` используются для summary-строк, которым нужны последние значения и timestamps потока, а не локальный React state.
- Если UI загружает history-viewer поток одним большим batch, store автоматически расширяет кольцевой буфер под размер этого snapshot, чтобы не терять историю.

## Взаимодействие

- Использует wire- и UI-контракты из `packages/core`.
- Сейчас подключается в `apps/client`.
