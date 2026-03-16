# packages/plugin-sdk

SDK для написания worker-плагинов.

## Для чего

- Даёт authoring API для плагинов без доступа к внутренностям runtime.
- Фиксирует lifecycle `onInit / onEvent / onShutdown` и контекст плагина.

## Как работает

- Плагин экспортирует `PluginModule` через `definePlugin`.
- SDK создаёт `PluginContext` с `emit`, таймерами, clock API и telemetry.
- `PluginContext` также даёт `currentTimelineId()`, `timelineStartSessionMs()` и `requestTimelineReset(...)`.
- `requestTimelineReset(...)` возвращает локальный `requestId` или `null`, если worker не может отправить запрос прямо сейчас.
- Все события, которые плагин подписывает или эмитит в общую шину, должны иметь `(type, v)` и быть зарегистрированы в runtime registry.
- Отдельный worker bootstrap загружает модуль, держит последовательную обработку и общается с runtime по worker-протоколу.
- Для profile-level reset SDK поддерживает optional lifecycle-хуки:
  - `onTimelineResetPrepare`
  - `onTimelineResetAbort`
  - `onTimelineResetCommit`
  - `onTimelineResetRequestResult`
- При reset автор плагина обязан явно разделять:
  - persistent state: соединение, конфиг, transport/session handle, который переживает новый timeline;
  - timeline-local state: окна, estimator state, derived snapshots, packet backlog, first-batch anchors.
- Практическая модель authoring:
  - `active reset participant` реализует все три reset-hook'а и чистит timeline-local state;
  - `passive reset-aware plugin` не держит timeline-local буферы, но корректно живёт после получения нового `timelineId`;
  - `reset-disabled for profile` нельзя подключать в профиль с enabled reset без явной стратегии.
- В `prepare` нельзя оставлять active emit path: SDK сам запрещает `emit()` в этой фазе.
- В `abort` нужно восстановить локальный lifecycle так, чтобы plugin вернулся в прежний рабочий режим.
- В `commit` нужно:
  - сбросить timeline-local state;
  - заново переякорить локальную временную модель;
  - при high-rate batched input по возможности не рвать transport, а клиповать первый post-reset batch относительно `timelineStartSessionMs`.
- `onTimelineResetRequestResult` нужен requester-плагинам:
  - `status=succeeded` приходит только после глобального завершения reset barrier;
  - `status=rejected` приходит, если runtime отклонил reset ещё до входа в barrier;
  - `status=aborted|failed` приходит после завершения abort/failure path во всём runtime, а не в локальном hook конкретного participant.

## Взаимодействие

- Зависит от контрактов `packages/core`.
- Используется всеми runtime-плагинами в `packages/plugins-*`.
