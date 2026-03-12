# packages/core/CONTRACTS.md

Текстовая спецификация межмодульных контрактов `sensync2`. Этот файл нужен там, где одних `TypeScript`-типов недостаточно для понимания семантики.

## 1. Временная модель

- Источник истины для data-path — только `session time`.
- `session time` измеряется в миллисекундах от старта runtime-сессии.
- Wall-clock используется только как метаданные:
  - для отчётов;
  - для экспорта;
  - для отображения времени старта сессии.
- Поля времени в данных и UI должны трактоваться как миллисекунды `session time`, если не сказано обратное.

Следствие:

- `t0Ms`, `timestampsMs`, `dtMs` и `globalTimestamp` нельзя интерпретировать как локальное время компьютера.

## 2. Runtime Event

Базовый контракт описан в [packages/core/src/events.ts](src/events.ts).

Семантика:

- `seq` назначается только runtime.
- `tsMonoMs` назначается только runtime и отражает монотонное внутреннее время публикации события.
- `sourcePluginId` назначается только runtime.
- Плагин при `emit()` не должен пытаться задавать эти поля сам.

Поля маршрутизации:

- `type` — строковый тип события.
- `kind` — логическая категория (`command`, `fact`, `data`, `system`).
- `priority` — класс очереди (`control`, `data`, `system`).

Гарантии `v1`:

- Один и тот же `seq` может обрабатываться несколькими плагинами параллельно.
- Внутри одного плагина события обрабатываются строго последовательно.
- Глобального барьера «все плагины завершили `n` перед началом `n+1`» нет.

## 3. Signal Batch

Сигнальный поток передаётся через `signal.batch`.

Поддерживаются два режима времени:

- `uniform-signal-batch`
  - источник истины: `t0Ms + dtMs`
  - `timestampsMs` обычно отсутствует
- `irregular-signal-batch` и `label-batch`
  - источник истины: `timestampsMs`
  - `dtMs` может быть `0` и не должен использоваться как истина

Правила:

- `sampleCount` должен совпадать с длиной `values`.
- Если присутствует `timestampsMs`, его длина должна совпадать с `sampleCount`.
- Для irregular потоков клиент и runtime обязаны доверять `timestampsMs`, а не реконструировать время из `t0Ms`.

## 4. Recording Events

Запись в `HDF5` управляется command/fact событиями recorder-слоя.

Базовые payload-типы описаны в [packages/core/src/events.ts](src/events.ts).

Текущий `v1` контракт:

- `recording.start`
  - выбирает writer по `writer`;
  - несёт `filenameTemplate`;
  - несёт пользовательские file-level `metadata`;
  - фиксирует набор `channels[]` на всю длительность записи.
- `recording.pause`
  - означает `flush` всех буферов и переход в `paused`;
  - в `v1` не меняет runtime subscriptions, только внутреннее состояние плагина.
- `recording.resume`
  - продолжает запись в уже открытый файл.
- `recording.stop`
  - означает финальный `flush`, `close` и переход в `idle`.
- `recording.state.changed`
  - обязан содержать `writer`;
  - нужен для UI и telemetry;
  - отражает state machine recorder'а.
- `recording.error`
  - обязан содержать `writer` и `code`;
  - ошибка записи не должна происходить "тихо".

Ограничения `v1`:

- `metadata` допускает только scalar-типы:
  - `string`
  - `number`
  - `boolean`
- запись выбирает каналы только по точному `channelId`;
- `sampleFormat` одного `channelId` внутри одного файла менять нельзя;
- динамические `subscribe/unsubscribe` на `pause/resume` пока не поддерживаются runtime и отложены на будущий этап.

## 5. Simulation Events

Симуляция из записанного `HDF5` управляется отдельным command/fact слоем.

Payload-типы описаны в [packages/core/src/events.ts](src/events.ts).

Текущий `v1` контракт:

- `simulation.pause.request`
  - останавливает цикл симуляции;
  - не меняет файл-источник и не сбрасывает курсоры.
- `simulation.resume.request`
  - продолжает симуляцию из текущего окна.
- `simulation.speed.set.request`
  - меняет speed только на одно из разрешённых значений;
  - при активной симуляции должен пересобрать внутренний timer cadence.
- `simulation.state.changed`
  - несёт `adapterId`, `state`, `speed`, `batchMs` и `filePath`;
  - нужен для UI и отладки профиля симуляции.

Ограничения `v1`:

- источник данных только новый on-disk формат recorder'а;
- старый replay bundle больше не поддерживается;
- `connect` всегда начинает чтение файла с начала;
- `disconnect` сбрасывает курсоры;
- `seek` и `loop` не реализованы.

## 6. Plugin Manifest

Контракт описан в [packages/core/src/plugin.ts](src/plugin.ts).

Семантика полей:

- `id`
  - логический идентификатор плагина;
  - должен совпадать с `PluginDescriptor.id` в runtime.
- `required`
  - при падении такого плагина runtime переходит в `degraded_fatal`.
- `subscriptions`
  - описывают, какие события плагин хочет получать;
  - runtime не должен доставлять события вне этого набора.
- `mailbox.controlCapacity`
  - ёмкость очереди команд и системных событий.
- `mailbox.dataCapacity`
  - ёмкость очереди data-событий.
- `mailbox.dataPolicy`
  - `fail-fast`
    - переполнение считается ошибкой архитектуры;
  - `coalesce-latest-per-stream`
    - допускается замена старого `signal.batch` более новым для того же stream.

## 7. Worker Protocol

Протокол описан в [packages/core/src/worker-protocol.ts](src/worker-protocol.ts).

Жизненный цикл:

1. Main runtime отправляет `plugin.init`.
2. Worker импортирует модуль, вызывает `onInit`.
3. Worker отвечает `plugin.ready`.
4. Runtime начинает доставку `plugin.deliver`.
5. После каждого успешно обработанного события worker отправляет `plugin.ack`.
6. При остановке runtime отправляет `plugin.shutdown`.

Ограничения `v1`:

- Внутри worker нет параллельной обработки `onEvent`.
- Таймеры плагина не выполняют бизнес-логику напрямую.
- Таймеры только эмитят новые события обратно в ту же последовательную очередь.

## 8. UI Schema

Базовые типы описаны в [packages/core/src/ui.ts](src/ui.ts).

Смысл schema-слоя:

- Это не конкретный ECharts-конфиг.
- Это библиотечно-независимое описание того, что должен отрисовать renderer.

Правила:

- `pages[].widgetIds` — полный набор виджетов страницы.
- `pages[].widgetRows`
  - если задано, renderer должен использовать именно эту раскладку;
  - если не задано, допустим fallback на один виджет в строку.
- `UiChartWidget.series`
  - `line` — линейная серия;
  - `scatter` — точечная серия;
  - `interval` — интервальная overlay-серия поверх label-stream.

## 9. Control Variants

`UiControlAction` и `UiControlVariant` описывают declarative-кнопки.

Семантика:

- Базовая кнопка задаёт дефолтные поля.
- Первый совпавший `variant.when` поверх них накладывает переопределения.
- `hidden` имеет приоритет над `visible`.
- Если после разрешения варианта отсутствует `commandType`, кнопка должна считаться disabled.

Поддерживаемые логические операторы:

- `eq`
- `and`
- `or`
- `not`

## 10. UI Wire

Бинарный wire описан в [packages/core/src/ui-wire.ts](src/ui-wire.ts).

Текущая версия:

- `version = 1`
- `frameType = 1` означает `signalBatch`

Критичные правила:

- Заголовок выровнен до 8 байт.
- Блок `timestampsMs` тоже выравнивается до 8 байт.
- Это сделано специально, чтобы `Float64Array` можно было читать без копии и без `RangeError`.

Если меняется layout:

- нужно менять текстовую спецификацию здесь;
- нужно проверять encoder и decoder одновременно;
- нужно проверять `apps/client` и `packages/client-runtime`.

## 11. Что документировать отдельно

- Общие контракты системы — в этом файле.
- Конкретную demo-схему `ui-gateway` — в [packages/plugins-ui-gateway/SCHEMA.md](../plugins-ui-gateway/SCHEMA.md).
- On-disk формат `HDF5` recorder'а и ожидания симулятора — в [packages/plugins-hdf5/HDF5_FORMAT.md](../plugins-hdf5/HDF5_FORMAT.md).
