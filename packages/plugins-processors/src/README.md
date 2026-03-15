# packages/plugins-processors/src

Исходники generic processor-плагинов.

## Для чего

- Папка разделяет reusable processors и их локальные signal-processing helper'ы.

## Как работает

- `index.ts` экспортирует публичные entrypoints пакета.
- `hr-from-rr.ts` содержит чистый estimator без plugin lifecycle.
- `hr-from-rr-processor.ts` собирает worker-плагин на `plugin-kit`.

## Взаимодействие

- Runtime-профили подключают processor по `modulePath`.
- Тесты в этой же папке проверяют и чистую математику estimator'а, и plugin-level поведение.
