# План: запись в HDF5

Дата исследования: 10 марта 2026 года.

Статус решения на сейчас:
- первая реализация идёт как отдельный пакет `packages/plugins-hdf5`;
- библиотека записи: `usnistgov/h5wasm`;
- `v1` без отдельного внутреннего writer thread;
- `v1` без динамических subscribe/unsubscribe в runtime, пауза работает через игнорирование входящих data events.

## Цель

Понять, можно ли в `sensync2` добавить запись в `HDF5` так, чтобы по возможностям это было не хуже текущего `sensync`:
- отдельный файл записи на сессию;
- отдельный dataset на канал или фичу;
- расширяемые datasets;
- буферизация и пакетная запись;
- метаданные на файл и на dataset;
- сжатие.

## Что уже делает текущий `sensync`

Проверено по `../sensync/consumers/HDF5Consumer.py`.

Текущая реализация:
- создаёт новый `.h5` файл на старт записи;
- создаёт datasets заранее;
- использует `maxshape=(None, 2)` для дозаписи;
- пишет чанками со `gzip` сжатием;
- накапливает буфер и сбрасывает его по `min_samples` или `max_seconds`;
- сохраняет атрибуты файла и датасетов.

Для `sensync2` это переносится в отдельный `Hdf5RecorderPlugin`, который подписывается на нужные `signal.batch` и хранит собственные буферы.

## Готовые библиотеки

### Кандидат 1: `h5wasm`

- Репозиторий: [usnistgov/h5wasm](https://github.com/usnistgov/h5wasm)
- npm: [h5wasm](https://www.npmjs.com/package/h5wasm)
- Активность:
  - `133` stars
  - последний push: `2026-03-01`
  - npm latest: `0.9.0`, опубликован `2026-02-19`
- Популярность:
  - около `4929` загрузок npm за неделю `2026-03-03..2026-03-09`

Что важно по возможностям:
- библиотека явно поддерживает `Node.js`;
- README прямо описывает `Writing`, `create_dataset`, `resize`, `compression`;
- есть режимы `SWMR`, в том числе append через `"Sa"`.

Оценка:
- это лучший кандидат для `sensync2` по сочетанию свежести, простоты интеграции и отсутствия нативной сборки;
- особенно хорошо подходит для Electron/Node-окружения, где нежелательно тащить тяжёлый нативный addon на старте проекта.

Ограничения:
- это `WASM`, а не нативная библиотека;
- реальную производительность нужно мерить на длинной записи и на высокочастотных потоках, особенно для EMG и частых append.

### Кандидат 2: `hdf5` / `hdf5.node`

- Репозиторий: [HDF-NI/hdf5.node](https://github.com/HDF-NI/hdf5.node)
- npm: [hdf5](https://www.npmjs.com/package/hdf5)
- Активность:
  - `125` stars
  - последний push в репозиторий: `2023-05-27`
  - npm latest: `0.3.5`, опубликован `2018-12-23`
  - npm metadata обновлялись `2022-06-18`
- Популярность:
  - около `50` загрузок npm за неделю `2026-03-03..2026-03-09`

Что важно по возможностям:
- библиотека умеет read/write;
- README упоминает `gzip` compression и `single write multi read`;
- это нативный binding к HDF5, а не WASM.

Оценка:
- по возможностям библиотека выглядит пригодной;
- по жизнеспособности для нового проекта это слабый вариант: пакет давно не публиковался, интеграция нативная, под Electron и новые версии Node это повышает риск сборки и сопровождения.

## Если писать самостоятельно

Самостоятельно реализовывать формат `HDF5` нельзя считать разумным вариантом.

Оценка:
- сложность: очень высокая;
- риск ошибки: очень высокий;
- зона риска: layout формата, совместимость с внешними инструментами, chunking, compression, атрибуты, корректность flush/close.

Если обе Node-библиотеки не устроят по throughput, практичный запасной путь не "писать HDF5 самому", а:
- либо перейти на нативный addon/sidecar;
- либо временно писать внутренний append-friendly формат и отдельно конвертировать в `HDF5`.

## Рекомендация для `sensync2`

Рекомендую такой путь:

1. Делать отдельный пакет `packages/plugins-hdf5` с `Hdf5RecorderPlugin`.
2. Первую реализацию делать на `h5wasm`.
3. Повторить ключевую семантику текущего `HDF5Consumer`:
   - один файл на запись;
   - отдельные datasets для `timestamps` и `values`;
   - локальный буфер внутри плагина;
   - flush по порогам;
   - метаданные файла и datasets.
4. Перед фиксацией решения прогнать benchmark на реальной нагрузке:
   - EMG;
   - длительная сессия;
   - одновременная запись нескольких потоков.
5. Если узкое место окажется именно в `h5wasm`, только тогда рассматривать:
   - `hdf5.node`;
   - отдельный Python/native sidecar для записи.

Итоговая оценка:
- добавить запись в `HDF5` в `sensync2` можно;
- самый реалистичный стартовый выбор: `h5wasm`;
- риск проекта: низкий или средний, если не пытаться сразу оптимизировать до предела и сначала сделать правильный API `Hdf5RecorderPlugin`.

## Черновой набросок `Hdf5RecorderPlugin v1`

### Пакет

- Код плагина живёт в `packages/plugins-hdf5`.
- Плагин запускается как обычный worker-плагин `sensync2`.

### Что слушает

- `recording.start`
- `recording.stop`
- `recording.pause`
- `recording.resume`
- `signal.batch`

### Что делает

- на `recording.start`:
  - валидирует `writer`;
  - создаёт новый файл;
  - фиксирует конфиг записи;
  - создаёт HDF5-группы и datasets лениво или заранее;
  - переходит в состояние `recording`;
- на `signal.batch`:
  - если состояние не `recording`, игнорирует событие;
  - если `channelId` не выбран для записи, игнорирует событие;
  - добавляет данные в JS-буфер конкретного dataset;
  - проверяет `minSamples` / `maxBufferedMs`;
  - если порог достигнут, сбрасывает буфер в HDF5;
- на `recording.pause`:
  - flush всех буферов;
  - переход в `paused`;
- на `recording.resume`:
  - переход в `recording`;
- на `recording.stop`:
  - flush всех буферов;
  - `file.flush()` и `file.close()`;
  - переход в `idle`.

### State machine

- `idle`
- `recording`
- `paused`
- `stopping`
- `failed`

### События наружу

- `recording.state.changed`
- `recording.error`

Обе группы событий должны содержать `writer`, чтобы UI мог отображать состояние по `writerKey`.

### Формат файла `v1`

На канал создаётся группа:

- `/channels/<channelId>/timestamps`
- `/channels/<channelId>/values`

Соглашения:
- `timestamps` пишутся в `session time` миллисекундах от старта сессии;
- абсолютное время старта сессии лежит в `file.attrs`;
- `values` имеют dtype в соответствии с `sampleFormat`;
- `sampleFormat` в рамках одного `channelId` внутри одного файла менять нельзя.

### Метаданные

`recording.start` несёт:
- `writer`
- `metadata`
- `filenameTemplate`

В `metadata` на `v1` разрешаем только scalar-типы:
- `string`
- `number`
- `boolean`

Имя файла строится по шаблону вида:
- `{fio}-{startDate}`
- `{writer}-{startDateTime}`

Шаблон должен уметь использовать:
- служебные поля (`writer`, `startDate`, `startDateTime`);
- пользовательские поля из `metadata`.

### Конфиг per dataset

На `v1` фиксируем только:
- `channelId`
- `minSamples`
- `maxBufferedMs`

Параметры `compression`, `compressionLevel`, `chunks` пока не выводим в командный слой.
Если понадобятся, добавим позже либо в plugin config, либо в расширенный `recording.start`.

## Отложенное улучшение

Сейчас runtime использует статические подписки из `manifest`.
Поэтому на `pause` / `resume` `Hdf5RecorderPlugin` не отписывается и не подписывается заново, а просто игнорирует или принимает `signal.batch` по своему внутреннему состоянию.

Это сознательное упрощение `v1`.

Отдельно хотим позже добавить в план:
- динамические subscribe/unsubscribe для plugin workers;
- чтобы recorder на `pause` действительно переставал получать data events на уровне runtime routing, а не только на уровне логики плагина.

## Источники

- [usnistgov/h5wasm](https://github.com/usnistgov/h5wasm)
- [h5wasm на npm](https://www.npmjs.com/package/h5wasm)
- [HDF-NI/hdf5.node](https://github.com/HDF-NI/hdf5.node)
- [hdf5 на npm](https://www.npmjs.com/package/hdf5)
- Текущая реализация в `sensync`: `../sensync/consumers/HDF5Consumer.py`
