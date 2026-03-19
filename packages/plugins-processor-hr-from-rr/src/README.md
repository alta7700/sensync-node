# packages/plugins-processor-hr-from-rr/src

Исходники generic processor'а `hr-from-rr`.

## Для чего

- Папка разделяет чистую математику estimator'а и worker-plugin lifecycle.

## Как работает

- `hr-from-rr.ts` содержит чистый estimator без runtime-зависимостей.
- `hr-from-rr-processor.ts` собирает worker-плагин на `plugin-kit`.
- `index.ts` экспортирует публичные entrypoints пакета.

## Взаимодействие

- Runtime-профили подключают processor по `modulePath`.
- Тесты в этой папке покрывают и estimator, и plugin-level поведение.
