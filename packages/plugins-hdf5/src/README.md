# packages/plugins-hdf5/src

Исходники HDF5-плагинов.

## Для чего

- Здесь лежит реализация записи, прямой симуляции и интерактивного viewer-режима из нового HDF5 формата.

## Как работает

- `hdf5-recorder-plugin.ts` держит state machine записи, буферы и file handle.
- `hdf5-recorder-plugin.ts` рядом с каждой записью пишет sidecar `*.diagnostic.jsonl`: туда попадают start/stop/reset события и краткие summary по flush потоков.
- `hdf5-recorder-plugin.ts` также держит deferred-start/post-stop reset flow:
  - pending `recording.start` хранится до `onTimelineResetRequestResult(status=succeeded)`;
  - локальный `onTimelineResetCommit` не открывает файл сам по себе;
  - failed pre-start reset отклоняет команду через `command.rejected`;
  - post-stop reset best-effort и не откатывает успешный `recording.stop`.
- `hdf5-simulation-adapter.ts` держит readonly file handle, lazy-reader по потокам и цикл симуляции по `batchMs`.
- `hdf5-simulation-adapter.ts` умеет фильтровать runtime-потоки по `streamIds`, чтобы один и тот же on-disk файл можно было проигрывать разными profile-композициями.
- `hdf5-simulation-adapter.ts` не меняет `signal.batch` timestamps из файла, а только пробрасывает `recordingStartSessionMs` в `simulation.state.changed` для UI-сдвига timeline origin.
- `hdf5-viewer-adapter.ts` использует тот же reader state, но не эмулирует время: он читает поток целиком и публикует `viewer.state.changed`, чтобы UI мог зумить и панорамировать историю.
- Для viewer-пути `hdf5-simulation-boundary.ts` отдаёт uniform-потоки с явными `timestampsMs`, чтобы renderer не восстанавливал X из `sampleRateHz` и не подменял фактическое время.
- `hdf5-simulation-boundary.ts` изолирует file-boundary: валидацию config, открытие HDF5, проверку структуры `/channels/*` и чтение dataset-ов.
- `hdf5-simulation-boundary.ts` также читает root attr `recordingStartSessionMs` и fallback'ается к первому sample, если attr отсутствует или противоречит данным.
- `hdf5-simulation-boundary.ts` для старых файлов также умеет выводить `sampleFormat` из `values.dtype`, если attr `sampleFormat` отсутствует.
- Для viewer-пути тот же boundary может синтетически подставить `frameKind = irregular-signal-batch`, если в старом файле есть только `timestamps + values`; для replay этот attr по-прежнему обязателен.
- Для viewer-пути boundary также вычитывает file-level scalar metadata из root attrs и отдает их наружу через `viewer.state.changed`.
- `hdf5-simulation-boundary.test.ts` проверяет этот boundary отдельно от runtime-плагина.
- `event-contracts.ts` описывает plugin-specific тик `hdf5.simulation.tick`.
- `index.ts` экспортирует публичные точки входа пакета.

## Взаимодействие

- Файлы плагинов используют `@sensync2/core`, `@sensync2/plugin-sdk` и `h5wasm/node`.
- Команды записи и симуляции описаны в `packages/core`.
- Recorder materialize'ит subscriptions и `required` из config ещё до `plugin.ready`, поэтому readiness checks живут в runtime, а не в UI.
- Viewer и simulation используют один и тот же HDF5 boundary, но разные shared state-контракты: `simulation.state.changed` для таймерного replay и `viewer.state.changed` для интерактивного history-режима.
