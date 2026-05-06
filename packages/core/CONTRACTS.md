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
- `v` — версия контракта события и часть identity вместе с `type`.
- `tsMonoMs` назначается только runtime и отражает монотонное внутреннее время публикации события.
- `sourcePluginId` назначается только runtime.
- Плагин при `emit()` не должен пытаться задавать эти поля сам.

Поля маршрутизации:

- `type` — строковый тип события.
- `v` — версия события внутри registry.
- `kind` — логическая категория (`command`, `fact`, `data`, `system`).
- `priority` — класс очереди (`control`, `data`, `system`).
- `timelineId` — идентификатор текущего timeline epoch внутри одной runtime-сессии.

## 2.1 Event Registry

В `sensync2` событие в общей шине идентифицируется парой `(type, v)`.

Правила:

- shared-события описываются в [packages/core/src/shared-event-contracts.ts](src/shared-event-contracts.ts);
- plugin-specific события описываются рядом с пакетами `packages/plugins-*/src/event-contracts.ts`;
- runtime собирает единый workspace registry и не маршрутизирует событие, если `(type, v)` не зарегистрирован;
- runtime также проверяет согласованность `kind` и `priority` с контрактом;
- plugin `emit` допускается только для событий, явно перечисленных в `manifest.emits`.

Типизация runtime-событий:

- `RuntimeEvent` больше не является "общим мешком" `CommandEvent | FactEvent | SignalBatchEvent`;
- точный union собирается кодогенерацией из:
  - [packages/core/src/runtime-event-map.spec.ts](src/runtime-event-map.spec.ts)
  - `packages/plugins-*/src/runtime-event-map.spec.ts`;
- сгенерированные augmentation-файлы `generated-runtime-event-map.ts` подключаются автоматически через package entrypoints;
- для создания input-событий нужно использовать `defineRuntimeEventInput(...)`, чтобы сохранить literal-типы `type`, `v`, `kind` и `priority`.

Boundary-валидация payload:

- payload не валидируется тяжёлой schema-проверкой в hot path шины;
- внешние ingress-слои обязаны валидировать payload до попадания в шину;
- для UI-команд shared-guards живут в [packages/core/src/ui-command-boundary.ts](src/ui-command-boundary.ts).
- общая карта boundary-слоёв и границ доверия описана в [BOUNDARIES.md](../../BOUNDARIES.md).

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

- `streamId` — единственный идентификатор data stream в runtime, UI, recorder и processor-слое.
- `sampleCount` должен совпадать с длиной `values`.
- Если присутствует `timestampsMs`, его длина должна совпадать с `sampleCount`.
- Для irregular потоков клиент и runtime обязаны доверять `timestampsMs`, а не реконструировать время из `t0Ms`.
- Отдельного public `channelId` в shared `signal.batch` контракте больше нет; если адаптеру нужен внутренний `channel`, это уже device-specific mapping, а не runtime identity.

## 3.1 Runtime Startup Barrier

После того как runtime зарегистрировал manifest'ы всех worker-плагинов в индексе подписок,
он публикует shared fact `runtime.started`.

Правила:

- это system-event, а не UI-сообщение;
- он нужен как безопасный барьер для startup-логики, которая не должна эмитить state/data раньше готовности подписчиков;
- `auto-on-init` для adapter-логики в `v1` следует трактовать как "автоподключить после `runtime.started`", а не "выполнить прямо внутри `onInit()`".

## 3.2 Timeline Reset

Profile-level `timeline reset` — это отдельный coordinator protocol, а не обычное событие общей шины.

Shared ingress:

- UI отправляет `timeline.reset.request`;
- `RuntimeHost` перехватывает эту команду до `publish()` и запускает special reset protocol;
- plugin-side reset request идёт отдельным worker-protocol сообщением, а не через `ctx.emit(...)`.
- plugin-requester получает отдельный out-of-band `request-result`, а не должен угадывать итог reset по локальным participant-hook'ам.

Инварианты `v1`:

- глобальный `SessionClock` не сбрасывается;
- `timelineId` меняется только после успешного `prepare` всего worker-cohort reset barrier;
- profile `participants` задают lifecycle/policy subset, но новый `timelineId` обязан быть разослан всем worker'ам, чтобы non-participant emit path не оставался на устаревшем timeline;
- `timelineStartSessionMs` фиксирует "ноль" нового теста внутри той же runtime-сессии;
- старые queued events не должны проходить safe-point после входа в `prepare`;
- `plugin.emit` обязан нести `timelineId`, а runtime обязан дропать emit с устаревшим timeline;
- reset запрещён, если recorder находится в `recording` или `paused`.
- `requestTimelineReset(...)` в worker возвращает локальный `requestId`; итог этого запроса приходит только через отдельный requester-result:
  - `rejected` — runtime отклонил запрос до входа в barrier;
  - `aborted` — prepare/barrier abort;
  - `failed` — commit/global failure;
  - `succeeded` — только после полного finish reset в runtime.

UI-модель:

- `ui.init.clock` теперь обязан нести `timelineId` и `timelineStartSessionMs`;
- `ui.timeline.reset` очищает только timeline-local client state;
- renderer показывает X как `absoluteSessionMs - timelineStartSessionMs`.

## 4. Recording Events

Запись в `HDF5` управляется command/fact событиями recorder-слоя.

Базовые payload-типы описаны в [packages/core/src/events.ts](src/events.ts).

Текущий `v1` контракт:

- `recording.start`
  - выбирает writer по `writer`;
  - несёт `filenameTemplate`;
  - несёт пользовательские file-level `metadata`;
  - фиксирует набор stream-конфигов в `channels[]` на всю длительность записи;
  - имя поля `channels[]` историческое, но каждая запись внутри идентифицируется по `streamId`.
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
- запись выбирает потоки только по точному `streamId`;
- `sampleFormat` одного `streamId` внутри одного файла менять нельзя;
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
  - для HDF5 replay может дополнительно нести `recordingStartSessionMs` из file metadata;
  - нужен для UI и отладки профиля симуляции.
- `viewer.state.changed`
  - несёт `adapterId`, `state` и `filePath`;
  - может дополнительно нести `recordingStartSessionMs`, `dataStartMs`, `dataEndMs` и file-level scalar `metadata`;
  - нужен для UI history-viewer режима, где файл не проигрывается по таймеру, а загружается целиком.

Ограничения `v1`:

- источник данных только новый on-disk формат recorder'а;
- старый replay bundle больше не поддерживается;
- `connect` всегда начинает чтение файла с начала;
- `disconnect` сбрасывает курсоры;
- `seek` и `loop` не реализованы.
- HDF5 replay не должен переписывать `signal.batch` timestamps только ради UI;
  - display-origin `00:00` должен строиться отдельно по `recordingStartSessionMs`, а не за счёт мутации данных потока.
- HDF5 viewer не должен притворяться simulation-источником:
  - для интерактивного просмотра нужно использовать `viewer.state.changed`, а не перегружать `simulation.state.changed` полями, не связанными с cadence.

## 5.1 Adapter Scan Events

Поиск устройств управляется отдельным command/fact слоем discovery.

Payload-типы описаны в [packages/core/src/events.ts](src/events.ts).

Текущий `v1` контракт:

- `adapter.scan.request`
  - запускает поиск устройств для конкретного `adapterId`;
  - может нести adapter-specific `formData`;
  - не означает подключение;
  - может нести `timeoutMs`.
- `adapter.scan.state.changed`
  - отражает только факт активного поиска;
  - `scanning=true` означает, что UI должен показать состояние поиска;
  - `scanning=false` означает, что конкретный scan завершён или прерван.
- `adapter.scan.candidates`
  - несёт итоговый список найденных устройств;
  - `scanId` живёт только в рамках одного scan;
  - `connectFormData` внутри кандидата считается opaque payload-фрагментом для последующего `adapter.connect.request`;
  - если scan реализован через `plugin-kit/scan-flow`, наружу обычно уходит только `{ candidateId }`, а plugin-specific данные остаются во внутреннем cache адаптера.

Ограничения `v1`:

- отдельные `scan.cancel` и `scan.progress` не поддерживаются;
- ошибки поиска могут materialize'иться в `ui.error`, а не в отдельную scan-state machine;
- список кандидатов не должен сериализоваться через flags patch.

## 5.2 Label Mark Events

Generic label-stream'ы управляются shared command `label.mark.request`.

Текущий `v1` контракт:

- `label.mark.request`
  - адресует внутренний `labelId`, а не внешний `streamId`;
  - несёт numeric `value`;
  - может нести `atTimeMs` в `session time`;
  - не определяет сам, какой `streamId` или `sampleFormat` использовать, это уже responsibility конкретного plugin config.

Правила:

- `atTimeMs`, если задан, трактуется только как `session time`;
- human-readable строка времени вроде `2:45` не является частью runtime-контракта;
- UI ingress обязан перевести такой текст в numeric `atTimeMs` до отправки `label.mark.request`;
- для одного `labelId` время меток должно быть неубывающим;
- interval/open-close semantics не являются частью shared-команды и задаются уже profile/UI-слоем.

## 5.3 Command Rejected Events

Мягкие отказы команд, которые не должны валить worker, materialize'ятся через shared fact `command.rejected`.

Текущий `v1` контракт:

- `command.rejected`
  - несёт `commandType` и `commandVersion`, чтобы было ясно, какая команда была отклонена;
  - несёт machine-readable `code` и user-visible `message`;
  - может нести `requestId`;
  - может нести plugin-specific `details`.

Правила:

- `command.rejected` не означает падение plugin worker'а;
- это именно warning-path, а не hard failure;
- UI/materializer может показывать такие события как `ui.warning`;
- telemetry может идти параллельно, но не заменяет user-visible сигнал о reject.

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
  - runtime не должен доставлять события вне этого набора;
  - подписка указывается как `(type, v)` и при startup проверяется на существование в registry.
- `emits`
  - перечисляют все события, которые плагин может выпустить в общую шину;
  - отсутствие нужного `(type, v)` в `emits` считается нарушением контракта emit path.
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
4. Runtime регистрирует manifest плагина в индексе подписок.
5. После готовности всех worker'ов runtime может публиковать startup-barrier `runtime.started`.
6. Runtime начинает обычную доставку `plugin.deliver`.
7. После каждого успешно обработанного события worker отправляет `plugin.ack`.
8. При остановке runtime отправляет `plugin.shutdown`.

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
- `derivedFlags[]`
  - описывает локальные UI-флаги, которые materialize'ятся не из отдельного runtime fact, а из других уже известных UI-данных;
  - в `v1` поддерживаются правила `latest-discrete-signal-value-map` и `latest-numeric-signal-value`;
  - `initialValue` попадает в `ui.init.flags` ещё до первого live-batch;
  - `sourceStreamId` должен совпадать с точным `streamId`, prefix-механики здесь нет;
  - `latest-discrete-signal-value-map` предназначен только для integer-like значений (`0/1`, enum-коды и т.п.);
  - `valueMap` обязан использовать только целочисленные ключи;
  - `latest-numeric-signal-value` сохраняет последнее numeric-значение потока в UI-flag без дополнительного `valueMap`;
  - непрерывные `f32/f64` сравнения по exact value не входят в `latest-discrete-signal-value-map` и требуют отдельного rule-kind.
- `pages[].layout`
  - если задан, renderer должен использовать именно это дерево layout;
  - `row` задаёт горизонтальную группу;
  - `column` задаёт вертикальную группу;
  - `widget` ссылается на конкретный `widgetId`;
  - `minWidth/minHeight/grow/gap` являются declarative layout-подсказками, а не сырыми CSS-стилями.
- `pages[].widgetRows`
  - используется только как fallback для простых схем без `layout`;
  - если задано, renderer должен использовать именно эту раскладку строк без скрытого auto-reflow;
  - если не задано, допустим fallback на один виджет в строку.
- `UiChartWidget.series`
  - `line` — линейная серия;
  - `scatter` — точечная серия;
  - `interval` — интервальная overlay-серия поверх label-stream.
  - `line.interpolation = step-after` означает ступенчатую серию по точкам setpoint/change-event;
  - для `step-after` renderer может подтягивать последнюю точку до начала окна и протягивать последнее значение до правой границы окна.
- `UiChartWidget.viewportMode`
  - `tail` — график показывает обычное скользящее окно последних данных;
  - `history` — renderer запрашивает весь доступный history snapshot и включает интерактивный pan/zoom.

## 9. Control Variants

`UiControlAction` и `UiControlVariant` описывают declarative-кнопки.

## 10. Runtime Telemetry

`runtime.telemetry.snapshot` и materialized `ui.telemetry` используются не только для очередей runtime, но и для latest plugin metrics.

Правила `v1`:

- `queues[]` и `dropped` остаются snapshot runtime-очередей;
- `metrics[]` содержит последние известные значения plugin metrics, а не историю;
- метрики идентифицируются парой `pluginId + name + tags`;
- runtime может перезаписывать более старое значение метрики новым без накопления временного ряда;
- UI не должен трактовать `metrics[]` как stream данных, это диагностический срез состояния.

Семантика:

- Базовая кнопка задаёт дефолтные поля.
- Первый совпавший `variant.when` поверх них накладывает переопределения.
- `hidden` имеет приоритет над `visible`.
- Если после разрешения варианта отсутствует `commandType`, кнопка должна считаться disabled.
- `commandVersion`, если задан, должен отправляться в `UiCommandMessage`.
- Если `commandVersion` не задан, renderer использует `v=1`.
- `commandType` в schema теперь не произвольная строка, а union допустимых UI-команд из boundary-registry.
- `payloadBindings` — это client-side derivation payload до отправки команды;
- `payloadBindings.kind = number-from-flag` читает numeric UI-flag, применяет optional arithmetic/clamp/round и пишет итог в top-level payload по `payloadKey`.

Поддерживаемые логические операторы:

- `eq`
- `and`
- `or`
- `not`

## 9.1 Modal Forms и Dynamic Options

`UiControlAction` может открывать локальный `modalForm`.

Семантика:

- `modalForm` описывается в общей `UiSchema`, но его open/close состояние живёт только в renderer;
- runtime не знает, открыта форма или нет;
- submit формы отправляет обычный `UiCommandMessage` в runtime;
- `UiCommandMessage` всегда несёт не только `eventType`, но и `eventVersion`;
- `UiCommandMessage` теперь типизируется от расширяемой `UiCommandBoundaryEventMap`, то есть `eventType`, `eventVersion` и `payload` берутся из exact shared/plugin-specific boundary map, а не живут отдельным строковым контрактом;
- `createUiCommandMessage(...)` — единственный sanctioned helper для сборки `UiCommandMessage` в schema-driven местах;
- `uiCommandMessageToRuntimeEventInput(...)` — единственный sanctioned helper для bridge между UI boundary и внутренним `RuntimeEventInput`;
- `submitEventVersion`, если не задан, трактуется как `1`;
- поля формы по умолчанию собираются в `payload.formData`, если renderer не вводит более узкое поведение.
- поле формы может явно отправляться в top-level payload через `submitTarget = payload`;
- `timelineTimeInput` — это UI-only поле времени относительно текущего `timeline`, которое ingress обязан конвертировать в absolute `session time`.

Поддерживаемые node-виды `v1`:

- `row`
- `column`
- `textInput`
- `timelineTimeInput`
- `numberInput`
- `decimalInput`
- `fileInput`
- `select`

Для `select`:

- options приходят отдельным control message `ui.form.options.patch`;
- `sourceId` связывает конкретное поле формы с runtime-данными;
- `payload` выбранной option может использоваться renderer'ом как дополнительный merge в `formData`.

Ограничения `v1`:

- формы не являются отдельной второй schema-системой;
- flags snapshot/patch не предназначены для переноса массивов option'ов;
- `fileInput` в desktop-режиме опирается на Electron bridge, а не на прямой доступ renderer к Node API.

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
