# packages/plugins-hdf5/src

Исходники HDF5-плагинов.

## Для чего

- Здесь лежит реализация записи и прямой симуляции из нового HDF5 формата.

## Как работает

- `hdf5-recorder-plugin.ts` держит state machine записи, буферы и file handle.
- `hdf5-recorder-plugin.ts` также держит deferred-start/post-stop reset flow:
  - pending `recording.start` хранится до `onTimelineResetRequestResult(status=succeeded)`;
  - локальный `onTimelineResetCommit` не открывает файл сам по себе;
  - failed pre-start reset отклоняет команду через `command.rejected`;
  - post-stop reset best-effort и не откатывает успешный `recording.stop`.
- `hdf5-simulation-adapter.ts` держит readonly file handle, lazy-reader по потокам и цикл симуляции по `batchMs`.
- `hdf5-simulation-adapter.ts` умеет фильтровать runtime-потоки по `streamIds`, чтобы один и тот же on-disk файл можно было проигрывать разными profile-композициями.
- `hdf5-simulation-adapter.ts` не меняет `signal.batch` timestamps из файла, а только пробрасывает `recordingStartSessionMs` в `simulation.state.changed` для UI-сдвига timeline origin.
- `hdf5-simulation-boundary.ts` изолирует file-boundary: валидацию config, открытие HDF5, проверку структуры `/channels/*` и чтение dataset-ов.
- `hdf5-simulation-boundary.ts` также читает root attr `recordingStartSessionMs` и fallback'ается к первому sample, если attr отсутствует или противоречит данным.
- `hdf5-simulation-boundary.test.ts` проверяет этот boundary отдельно от runtime-плагина.
- `event-contracts.ts` описывает plugin-specific тик `hdf5.simulation.tick`.
- `index.ts` экспортирует публичные точки входа пакета.

## Взаимодействие

- Файлы плагинов используют `@sensync2/core`, `@sensync2/plugin-sdk` и `h5wasm/node`.
- Команды записи и симуляции описаны в `packages/core`.
- Recorder materialize'ит subscriptions и `required` из config ещё до `plugin.ready`, поэтому readiness checks живут в runtime, а не в UI.
