# packages/plugins-fake/REPLAY_FORMAT.md

Формат replay bundle для `veloerg-h5-replay-adapter`.

## 1. Назначение

Replay bundle нужен для воспроизведения исторической записи как live-потока без прямой зависимости runtime от HDF5.

Это даёт:

- более простой runtime;
- быстрый старт demo-сценариев;
- отделение конвертации данных от data-path исполнения.

## 2. Состав bundle

Bundle — это директория:

- `manifest.json`
- `streams/*.f64bin`

Пример:

```text
test.replay/
  manifest.json
  streams/
    trigno.avanti.f64bin
    zephyr.rr.f64bin
    moxy.smo2.f64bin
```

## 3. manifest.json

Текущий формат:

- `version`
- `format`
- `timeDomain`
- `sourceTimestampUnit`
- `targetTimestampUnit`
- `sourceFile`
- `streams[]`
- `stats`

### stream entry

Поля одного stream:

- `streamId`
- `channelId`
- `sampleFormat`
- `frameKind`
- `sampleCount`
- `dataFile`
- `minTimestampMs`
- `maxTimestampMs`
- `valueMin`
- `valueMax`
- `units` — опционально

Семантика:

- `streamId` — UI/runtime stream id.
- `channelId` — исходный logical channel id.
- `sampleFormat`
  - сейчас в manifest может быть `f64` или `i16`;
  - файл при этом всё равно хранится как interleaved `float64`.
- `frameKind`
  - `irregular-signal-batch` для обычных исторических потоков;
  - `label-batch` для label-stream.

## 4. Формат dataFile

Каждый `dataFile` хранит interleaved данные little-endian `float64`:

```text
[ts0, value0, ts1, value1, ts2, value2, ...]
```

Правила:

- даже если `sampleFormat = i16`, файл всё равно хранится как `float64`;
- фактическое приведение к `Int16Array` выполняется replay-адаптером при публикации событий;
- timestamp и value читаются парами.

## 5. Единицы времени

В replay bundle время должно быть уже в миллисекундах session domain.

Исторический контекст:

- исходный HDF5 от старого Python runtime хранил timestamp в секундах;
- конвертер переводит их в миллисекунды на этапе подготовки bundle.

Следствие:

- runtime не должен повторно масштабировать timestamps из bundle.

## 6. Поведение replay-адаптера

`veloerg-h5-replay-adapter`:

- загружает `manifest.json`;
- читает все `dataFile`;
- для каждого stream держит `cursor`;
- на каждом tick считает, сколько исторического времени уже «должно было пройти»;
- публикует все точки, чей timestamp уже попал в это окно воспроизведения.

Параметры runtime-конфига:

- `bundlePath`
- `adapterId`
- `tickMs`
- `speed`
- `maxSamplesPerBatch`

## 7. Ограничения текущего формата

- Нет random access индекса помимо обычного бинарного поиска по stream-массиву.
- Нет chunk metadata внутри dataFile.
- Нет отдельной компрессии кроме файловой/архивной упаковки снаружи.
- В `v1` bundle рассчитан на один replay source за запуск.

## 8. Кто отвечает за формат

- Нормативное описание — этот файл.
- Конвертер — [scripts/convert_h5_to_replay.py](../../scripts/convert_h5_to_replay.py).
- Потребитель формата — [packages/plugins-fake/src/veloerg-h5-replay-adapter.ts](src/veloerg-h5-replay-adapter.ts).
