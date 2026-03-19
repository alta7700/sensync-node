# packages/plugins-processor-pedaling-emg/proto

Локальные protobuf-контракты для Python compute-worker `pedaling-emg`.

## Для чего

- Здесь лежит метод-специфичный wire-контракт между TS worker-плагином и Python compute-worker.

## Как работает

- Shared transport envelope и `NumericArray` приходят из `@sensync2/plugin-kit/ipc-worker`.
- Эта папка описывает только payload запроса/ответа конкретного `pedaling-emg` метода.

## Взаимодействие

- Codegen запускается через корневой `npm run generate:compute-proto`.
- TS-артефакты генерируются в `src/generated`, Python-артефакты — в `python_worker/generated`.
