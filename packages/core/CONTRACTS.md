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

Базовый контракт описан в [events.ts](/Users/tascan/Documents/sirius/sensync2/packages/core/src/events.ts).

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

## 4. Plugin Manifest

Контракт описан в [plugin.ts](/Users/tascan/Documents/sirius/sensync2/packages/core/src/plugin.ts).

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

## 5. Worker Protocol

Протокол описан в [worker-protocol.ts](/Users/tascan/Documents/sirius/sensync2/packages/core/src/worker-protocol.ts).

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

## 6. UI Schema

Базовые типы описаны в [ui.ts](/Users/tascan/Documents/sirius/sensync2/packages/core/src/ui.ts).

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

## 7. Control Variants

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

## 8. UI Wire

Бинарный wire описан в [ui-wire.ts](/Users/tascan/Documents/sirius/sensync2/packages/core/src/ui-wire.ts).

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

## 9. Что документировать отдельно

- Общие контракты системы — в этом файле.
- Конкретную demo-схему `ui-gateway` — в [SCHEMA.md](/Users/tascan/Documents/sirius/sensync2/packages/plugins-ui-gateway/SCHEMA.md).
- Формат replay bundle — в [REPLAY_FORMAT.md](/Users/tascan/Documents/sirius/sensync2/packages/plugins-fake/REPLAY_FORMAT.md).
