# packages/client-runtime

Runtime слой для renderer/UI.

## Для чего

- Материализует control и binary поток в удобное состояние для UI.
- Хранит флаги, stream registry, dynamic form options, уведомления UI и кольцевые буферы сигналов.

## Как работает

- Принимает transport с интерфейсом `ClientTransport`.
- После `ui.init` создаёт локальную картину сессии.
- Binary frames пишет в `StreamBufferStore`, а UI читает окна данных по запросу.

## Взаимодействие

- Использует wire- и UI-контракты из `packages/core`.
- Сейчас подключается в `apps/client`.
