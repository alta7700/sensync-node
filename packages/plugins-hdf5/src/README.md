# packages/plugins-hdf5/src

Исходники HDF5-плагинов.

## Для чего

- Здесь лежит реализация записи и прямой симуляции из нового HDF5 формата.

## Как работает

- `hdf5-recorder-plugin.ts` держит state machine записи, буферы и file handle.
- `hdf5-simulation-adapter.ts` держит readonly file handle, lazy-reader по каналам и цикл симуляции по `batchMs`.
- `hdf5-simulation-adapter.ts` умеет фильтровать каналы по `channelIds`, чтобы один и тот же on-disk файл можно было проигрывать разными profile-композициями.
- `index.ts` экспортирует публичные точки входа пакета.

## Взаимодействие

- Файлы плагинов используют `@sensync2/core`, `@sensync2/plugin-sdk` и `h5wasm/node`.
- Команды записи и симуляции описаны в `packages/core`.
