# packages/plugins-hdf5

Пакет с HDF5-плагинами записи и симуляции.

## Для чего

- Даёт отдельный recorder-плагин для записи выбранных `signal.batch` потоков в `HDF5`.
- Даёт отдельный simulation-плагин, который читает тот же новый on-disk формат напрямую, без промежуточного replay bundle.

## Как работает

- `hdf5-recorder-plugin.ts` пишет `/channels/<channelId>/timestamps` и `/channels/<channelId>/values`.
- `hdf5-simulation-adapter.ts` лениво читает те же datasets с помощью `h5wasm.slice()` и формирует новые runtime-batch по окну `batchMs`.
- `hdf5-simulation-adapter.ts` может ограничивать воспроизведение только выбранными `channelIds`, которые пришли в plugin config.
- File-boundary для симуляции вынесен в `src/hdf5-simulation-boundary.ts`, чтобы адаптер не смешивал runtime-state machine и разбор внешнего HDF5.
- Внутренний тик симуляции зарегистрирован рядом в `src/event-contracts.ts`.
- Оба плагина используют один и тот же HDF5 контракт, описанный отдельно.

## Взаимодействие

- Использует контракты из `packages/core`.
- Запускается через `packages/plugin-sdk` как обычные worker-плагины.
- Recorder подключается к live-источникам, а simulation-плагин работает как отдельный data-source profile.

Дополнительно:

- On-disk формат описан в [packages/plugins-hdf5/HDF5_FORMAT.md](HDF5_FORMAT.md).
