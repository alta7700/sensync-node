# apps/client

React renderer для `sensync2`.

## Для чего

- Отрисовывает UI по `UiSchema`, полученной от `ui-gateway`.
- Показывает графики, статусные виджеты, control-кнопки, локальные modal forms, toast-уведомления и telemetry.
- В telemetry-виджете отображает как runtime queue snapshot, так и latest plugin metrics.
- Не содержит runtime-логики и не знает о plugin worker'ах напрямую.

## Как работает

- Приложение стартует через Vite.
- Внутри renderer создаётся `ClientRuntime`, который принимает control-сообщения и binary batches через Electron bridge.
- React хранит layout и подписки, а потоковые данные читает из `ClientRuntime`, а не из component state.
- Явная раскладка страницы теперь приходит из `UiPage.layout` (`row/column/widget`), а `widgetRows` используется только как упрощённый fallback.
- Renderer также конвертирует timeline-relative UI-ввод вроде `2:45` в абсолютный `session time` до отправки shared-команд в runtime.

## Взаимодействие

- Использует `@sensync2/client-runtime` и `@sensync2/core`.
- Получает транспорт через `apps/desktop`.
- Ожидает, что `apps/runtime` и `packages/plugins-ui-gateway` уже материализовали UI-поток.
