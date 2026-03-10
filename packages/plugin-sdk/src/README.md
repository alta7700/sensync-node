# packages/plugin-sdk/src

Исходники SDK и worker bootstrap.

## Для чего

- Разделяют author-facing API и внутренний runtime bootstrap.

## Как работает

- `index.ts` описывает `PluginContext`, `PluginModule` и helper `definePlugin`.
- `worker.ts` запускается внутри `worker_threads` и:
  - импортирует plugin module;
  - держит последовательную очередь событий;
  - реализует таймеры;
  - отправляет `emit/ack/error/telemetry` обратно в runtime.

## Взаимодействие

- Потребляет worker protocol и event types из `packages/core`.
- Запускается из `apps/runtime/src/plugin-host.ts`.
