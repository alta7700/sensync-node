# packages/plugin-sdk

SDK для написания worker-плагинов.

## Для чего

- Даёт authoring API для плагинов без доступа к внутренностям runtime.
- Фиксирует lifecycle `onInit / onEvent / onShutdown` и контекст плагина.

## Как работает

- Плагин экспортирует `PluginModule` через `definePlugin`.
- SDK создаёт `PluginContext` с `emit`, таймерами, clock API и telemetry.
- `PluginContext` также даёт `currentTimelineId()`, `timelineStartSessionMs()` и `requestTimelineReset(...)`.
- Все события, которые плагин подписывает или эмитит в общую шину, должны иметь `(type, v)` и быть зарегистрированы в runtime registry.
- Отдельный worker bootstrap загружает модуль, держит последовательную обработку и общается с runtime по worker-протоколу.
- Для profile-level reset SDK поддерживает optional lifecycle-хуки:
  - `onTimelineResetPrepare`
  - `onTimelineResetAbort`
  - `onTimelineResetCommit`

## Взаимодействие

- Зависит от контрактов `packages/core`.
- Используется всеми runtime-плагинами в `packages/plugins-*`.
