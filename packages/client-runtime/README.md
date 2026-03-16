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
- `getVisibleWindow(...)` возвращает X уже относительно `clock.timelineStartSessionMs`, а не относительно глобального старта runtime-сессии.

## Взаимодействие

- Использует wire- и UI-контракты из `packages/core`.
- Сейчас подключается в `apps/client`.
