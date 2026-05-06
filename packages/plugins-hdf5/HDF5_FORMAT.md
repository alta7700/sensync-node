# packages/plugins-hdf5/HDF5_FORMAT.md

On-disk формат `HDF5`, который считается источником истины для recorder и `hdf5-simulation`.

## 1. Общее

- Поддерживается только новый формат `sensync2`.
- Старый replay bundle и старые HDF5-схемы сюда не входят.
- Источник истины по времени в файле — explicit `timestamps`.

## 2. Структура файла

Корень файла содержит:

- attrs recorder/session metadata;
- группу `/channels`.

Важно: имя группы `/channels` историческое. Логической runtime-единицей внутри файла считается поток (`stream`), а не отдельный public `channel`.

Каждый runtime-поток хранится в группе:

- `/channels/<streamId>`

## 3. Обязательные attrs группы потока

- `streamId: string`
- `sampleFormat: "f32" | "f64" | "i16"`
- `frameKind: "uniform-signal-batch" | "irregular-signal-batch" | "label-batch"`
- `minSamples: number`
- `maxBufferedMs: number`

## 4. Необязательные attrs группы потока

- `units: string`
- `sampleRateHz: number`

Правило:

- `sampleRateHz` обязателен для корректного восстановления `uniform-signal-batch` без деградации в irregular режим.

Примечание по совместимости:

- штатный `sensync2` writer обязан писать `sampleFormat` как attr группы потока;
- reader в `hdf5-simulation-boundary.ts` допускает старые файлы без этого attr и в таком случае выводит формат из `values.dtype`;
- если `values.dtype` нельзя сопоставить с runtime `sampleFormat`, файл отклоняется на boundary.
- штатный `sensync2` writer обязан писать `frameKind` как attr группы потока;
- viewer-reader может подставить `frameKind = irregular-signal-batch`, если старый файл содержит только `timestamps + values`;
- replay-reader этим fallback не пользуется, потому что без `frameKind` он уже не должен сам угадывать cadence-семантику потока.

## 5. Datasets потока

Внутри `/channels/<streamId>` должны быть datasets потока:

- `timestamps`
  - dtype: `Float64`
  - shape: `[N]`
- `values`
  - dtype зависит от `sampleFormat`
  - shape: `[N]`

Правила:

- `timestamps.length === values.length`
- `timestamps` монотонны по неубыванию
- оба datasets одномерные

## 6. Корневые attrs файла

Recorder сейчас пишет как минимум:

- `writer`
- `sessionStartWallMs`
- `recordingStartWallMs`
- `recordingStartSessionMs`
- `createdAt`
- `filenameTemplate`
- `recorderPluginId`
- пользовательские scalar metadata из `recording.start.payload.metadata`

Правило для viewer:

- scalar root attrs, которые не зарезервированы под служебные поля recorder'а, могут быть проброшены в `viewer.state.changed.metadata` для UI;
- это metadata только для display/annotation слоя и не должно менять data-path semantics `signal.batch`.

## 7. Ожидания `hdf5-simulation`

`hdf5-simulation-adapter` исходит из следующего:

- файл открыт в readonly режиме;
- если в config передан `streamIds`, adapter проигрывает только их и игнорирует остальные группы файла;
- если в config одновременно включён `requireAllStreamIds`, отсутствие хотя бы одного потока из `streamIds` считается ошибкой boundary, а не допустимым частичным replay;
- чтение идёт только вперёд;
- курсоры по потокам сдвигаются по окнам `batchMs`;
- в один цикл симуляции каждый поток может отдать максимум один `signal.batch`;
- `uniform-signal-batch` восстанавливается только если в attrs есть `sampleRateHz`;
- если `frameKind = uniform-signal-batch`, но `sampleRateHz` отсутствует, адаптер имеет право деградировать поток до `irregular-signal-batch` с explicit `timestampsMs`.
- `signal.batch` timestamps из datasets не должны переписываться только ради replay UI.
- Если в корневых attrs есть `recordingStartSessionMs`, replay-adapter должен пробросить его наружу как metadata для display-origin timeline в UI.
- Если `recordingStartSessionMs` отсутствует или оказывается позже первого sample, replay должен fallback'нуться к `dataStartMs` файла.
- Для `veloerg-replay` и `veloerg-viewer` это означает намеренный breaking change: старые single-sensor файлы с `trigno.avanti*` не удовлетворяют новому набору `trigno.vl.avanti*` / `trigno.rf.avanti*` и должны отклоняться на boundary.
