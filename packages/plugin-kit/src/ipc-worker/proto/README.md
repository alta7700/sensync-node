# packages/plugin-kit/src/ipc-worker/proto

Shared `.proto` контракты для `ipc-worker`.

## Для чего

- Здесь лежат transport envelope и общий numeric-array контракт.

## Как работает

- `transport.proto` описывает `ready/request/response/shutdown`.
- `numeric_array.proto` описывает компактную передачу typed-array как `bytes + sampleFormat + length`.
- Processor-specific `.proto` импортируют эти файлы, но не меняют их смысл.

## Взаимодействие

- TypeScript-артефакты генерируются в `packages/plugin-kit/src/ipc-worker/generated`.
- Python-артефакты генерируются в `packages/plugin-kit/python-runtime/src`.
