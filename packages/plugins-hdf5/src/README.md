# packages/plugins-hdf5/src

Исходники `Hdf5RecorderPlugin`.

## Для чего

- Здесь находится реализация state machine записи и HDF5 append-логика.

## Как работает

- `hdf5-recorder-plugin.ts` держит текущее состояние записи, буферы и file handle.
- `index.ts` экспортирует публичную точку входа пакета.

## Взаимодействие

- Файл плагина использует `@sensync2/core`, `@sensync2/plugin-sdk` и `h5wasm/node`.
- Команды записи и state events описаны в `packages/core`.
