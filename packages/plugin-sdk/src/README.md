# packages/plugin-sdk/src

Исходники SDK и worker bootstrap.

## Для чего

- Разделяют author-facing API и внутренний runtime bootstrap.

## Как работает

- `index.ts` описывает `PluginContext`, `PluginModule` и helper `definePlugin`.
- `PluginContext.emit(...)` и `setTimer(...)` принимают exact `RuntimeEventInput`, а не размытый `FactEvent<string>`.
- Для создания event input внутри плагина нужно использовать `defineRuntimeEventInput(...)` из `@sensync2/core`, если TypeScript иначе расширяет literal-типы.
- `worker.ts` запускается внутри `worker_threads` и:
  - импортирует plugin module;
  - держит последовательную очередь событий;
  - реализует таймеры;
  - отправляет `emit/ack/error/telemetry` обратно в runtime.
- Таймеры тоже обязаны эмитить зарегистрированные события с явным `v`.

## Взаимодействие

- Потребляет worker protocol и event types из `packages/core`.
- Запускается из `apps/runtime/src/plugin-host.ts`.
