# packages/plugin-sdk

SDK для написания worker-плагинов.

## Для чего

- Даёт authoring API для плагинов без доступа к внутренностям runtime.
- Фиксирует lifecycle `onInit / onEvent / onShutdown` и контекст плагина.

## Как работает

- Плагин экспортирует `PluginModule` через `definePlugin`.
- SDK создаёт `PluginContext` с `emit`, таймерами, clock API и telemetry.
- Отдельный worker bootstrap загружает модуль, держит последовательную обработку и общается с runtime по worker-протоколу.

## Взаимодействие

- Зависит от контрактов `packages/core`.
- Используется всеми runtime-плагинами в `packages/plugins-*`.
