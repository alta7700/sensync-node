# apps/client

React renderer для `sensync2`.

## Для чего

- Отрисовывает UI по `UiSchema`, полученной от `ui-gateway`.
- Показывает графики, статусные виджеты, control-кнопки и telemetry.
- Не содержит runtime-логики и не знает о plugin worker'ах напрямую.

## Как работает

- Приложение стартует через Vite.
- Внутри renderer создаётся `ClientRuntime`, который принимает control-сообщения и binary batches через Electron bridge.
- React хранит layout и подписки, а потоковые данные читает из `ClientRuntime`, а не из component state.

## Взаимодействие

- Использует `@sensync2/client-runtime` и `@sensync2/core`.
- Получает транспорт через `apps/desktop`.
- Ожидает, что `apps/runtime` и `packages/plugins-ui-gateway` уже материализовали UI-поток.
