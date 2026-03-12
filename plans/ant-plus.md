# План: поддержка ANT+ датчиков

Дата исследования: 10 марта 2026 года.

## Цель

Понять, можно ли в `sensync2` поддержать ANT+ датчики, включая кейс Moxy, без возврата к Python `openant`.

## Что уже делает текущий `sensync`

Проверено по `../sensync/drivers/moxy/driver.py`.

Текущий драйвер:
- работает через USB ANT+ stick;
- использует `openant`;
- настраивает канал под `Muscle Oxygen` profile (`device type 31`);
- обрабатывает broadcast пакеты;
- дедуплицирует данные по `event_count`;
- держит работу node в отдельном потоке.

Вывод:
- текущий use case не абстрактный ANT+, а вполне конкретный профиль `Muscle Oxygen`;
- если Node-библиотека закрывает именно этот профиль, перенос сильно упрощается.

## Готовые библиотеки

### Кандидат 1: `ant-plus`

- Репозиторий: [Loghorn/ant-plus](https://github.com/Loghorn/ant-plus)
- npm: [ant-plus](https://www.npmjs.com/package/ant-plus)
- Активность:
  - `147` stars
  - последний push: `2026-02-26`
  - npm latest: `0.2.0`, опубликован `2026-02-26`
- Популярность:
  - около `30` загрузок npm за неделю `2026-03-03..2026-03-09`

Что важно:
- библиотека живая, обновлялась совсем недавно;
- работает через USB stick и `libusb`;
- README описывает `GarminStick2` / `GarminStick3`, attach/scan lifecycle и требования по ОС;
- в репозитории есть явная поддержка muscle oxygen:
  - [src/muscle-oxygen-sensors.ts](https://github.com/Loghorn/ant-plus/blob/master/src/muscle-oxygen-sensors.ts)
  - [sample/muscle-oxygen.js](https://github.com/Loghorn/ant-plus/blob/master/sample/muscle-oxygen.js)

Это очень сильный сигнал. Для нашего кейса это не "может быть когда-нибудь подойдёт", а библиотека, в которой профиль уже существует.

### Альтернативы

По Node-экосистеме заметного второго кандидата такого же уровня я не нашёл.

Это нормально: рынок ANT+ маленький, и в нём важнее активность репозитория и наличие именно нужного профиля, чем абсолютные числа по stars и downloads.

## Если делать без библиотеки

Самостоятельная реализация здесь уже ощутимо опаснее, чем Trigno TCP.

Оценка:
- сложность: средняя или высокая;
- риск ошибки: высокий.

Где основные риски:
- работа с USB stick и драйверами на разных ОС;
- инициализация канала и жизненный цикл устройства;
- ANT+ profile parsing;
- особенности конкретных сенсоров;
- упаковка под Electron.

То есть без библиотеки пришлось бы реализовывать не только прикладной профиль, но и большую часть transport/device слоя.

## Рекомендация для `sensync2`

Рекомендую принять `ant-plus` как основной путь для ANT+ интеграции.

Практичный план:

1. Сделать один `ant-plus-adapter` plugin worker, который владеет USB stick и жизненным циклом `attach / scan / select / connect / disconnect`.
2. Внутри `ant-plus-adapter` держать реестр профильных обработчиков ANT+ устройств:
   - в `v1` реализовать только `Muscle Oxygen`;
   - следующими кандидатами считать `heart-rate` и другие стандартные профили;
   - не давать нескольким runtime-плагинам открывать один и тот же stick параллельно.
3. Сначала закрыть именно сценарий Moxy:
   - USB stick;
   - scan/select flow;
   - `Muscle Oxygen` packets;
   - дедупликация по `event_count`, как сейчас;
   - восстановление временной шкалы измерений внутри worker.
4. Параллельно начать отдельный launch/UI profile `veloerg`, в который потом войдут live-источники для велоэргометрического сценария.
5. Вынести требования запуска и отладки в отдельную документацию:
   - `libusb`;
   - драйверы;
   - ограничения на параллельный доступ к stick;
   - особенности macOS и Windows.

## Зафиксированные решения

### 1. Архитектура ANT+ слоя

- `sensync2` делает не отдельный Moxy-only plugin, а общий ANT+ слой.
- Практическая форма этого слоя в `v1`:
  - один runtime-plugin `ant-plus-adapter`;
  - внутри него transport к USB stick;
  - поверх transport — профильные декодеры ANT+.
- Это важно, потому что физический stick — общий ресурс. Архитектура с несколькими независимыми worker'ами, каждый из которых сам открывает stick, создаст конфликт владения устройством.

### 2. Временная модель Moxy

- Публичные `signal.batch` для Moxy должны оставаться в `session time`, а не в wall-clock.
- Это не просто рекомендация, а текущий контракт `sensync2`:
  - runtime назначает только `seq`, `tsMonoMs` и `sourcePluginId`;
  - `t0Ms` и `timestampsMs` заполняет сам адаптер;
  - `t0Ms` и `timestampsMs` по контракту интерпретируются как миллисекунды от старта runtime-сессии.
- Поэтому для live Moxy в `v1` фиксируем такую схему:
  - при первом валидном пакете после `connect` или `reconnect` адаптер якорит поток к `ctx.clock.nowSessionMs()`;
  - дальше внутри worker восстанавливает шкалу измерений по `measurement_interval` и `event_count`;
  - в `signal.batch` наружу публикуется уже session-time представление измерений, а не время получения пакета ядром.

### 3. Публичный контракт данных Moxy

- В `v1` наружу публикуются только измерительные каналы:
  - `moxy.smo2`
  - `moxy.thb`
- Служебные поля профиля остаются внутренними данными worker'а:
  - `event_count`
  - `measurement_interval`
  - scan metadata
- `prev_smo2` пока не выводится в публичный контракт:
  - это не самостоятельный основной канал измерения;
  - его можно вернуть позже, если появится внятный пользовательский сценарий, а не только отладочная ценность.

### 4. Scan/select и формы конфигурации

- Для ANT+ нужен явный scan/select flow, а не только кнопка `connect`.
- Формы конфигурации добавляем как расширение существующего schema/UI слоя, а не как отдельную новую "систему схем".
- Базовая сущность для этого слоя: `modalForm`.
- `modalForm` живёт локально на клиенте:
  - runtime не знает, открыта форма или нет;
  - runtime не хранит её локальное состояние;
  - клиент сам управляет open/close, редактированием полей и submit lifecycle.
- `modalForm` описывается прямо в UI schema и умеет:
  - поля `textInput`;
  - поля `numberInput`;
  - поля `decimalInput`;
  - поля `fileInput` для выбора существующего файла или директории;
  - кнопку `submit`;
  - layout-контейнеры `row` и `column` для группировки полей.
- Это не отдельная новая схема, а расширение существующих виджетов и control-описаний в сторону более динамичного поведения.
- Для `v1` не закладываем архитектуру, где по клику UI сначала запрашивает форму у плагина:
  - это превращает `ui-gateway` в RPC-слой;
  - это хуже стыкуется с текущей цепочкой `runtime -> plugins -> ui-gateway -> client-runtime`.
- Если для валидации окажется полезен `zod`, его можно использовать на стороне клиента как реализацию локальных правил, но не как wire-формат схемы.
- Отдельный "error notification" канал в `v1` не вводим:
  - уже существующий `ui.error` нужно начать отображать как toast;
  - если позже понадобятся уровни `info / warning / error`, тогда можно будет обобщить его до `ui.notification`.

### 5. Состояния и поведение при ошибках

- Базовый lifecycle для live ANT+ адаптера:
  - `disconnected`
  - `connecting`
  - `connected`
  - `disconnecting`
  - `failed`
- Семантика состояний:
  - `connecting` включает открытие stick, scan/select и ожидание первого валидного пакета;
  - `connected` означает, что выбранный сенсор реально даёт данные;
  - `failed` используем для ошибок USB, прав, `libusb`, конфигурации и несовместимого железа;
  - пропуски пакетов по `event_count` не считаем fatal-ошибкой, а обрабатываем как диагностику worker'а.
- Для Moxy `connect` в UI работает через двухшаговый flow:
  - кнопка подключения сначала отправляет `adapter.scan.request`;
  - адаптер выставляет отдельный scanning-state, чтобы UI мог показать "идёт поиск";
  - по завершении scan адаптер возвращает список кандидатов;
  - UI открывает локальный `modalForm` c выбором устройства;
  - submit формы отправляет уже существующий `adapter.connect.request` с параметрами выбранного устройства.
- Отдельный `adapter.connection.request` не вводим:
  - это дублировало бы смысл уже существующего `adapter.connect.request`;
  - различать нужно не "connect" и "connection", а этапы `scan` и `connect`.
- При отсутствии stick или ошибке scan/connect пользователь должен видеть toast:
  - в `v1` это делаем через материализацию ошибки в `ui.error`;
  - сообщение должно быть достаточно конкретным, например: stick не найден, нет прав доступа, scan завершился ошибкой.

### 6. Профиль `veloerg`

- Первый живой профиль для ANT+ интеграции в UI и runtime называем `veloerg`.
- `veloerg` — это профиль приложения, а не ANT+ профиль устройства.
- В `v1` он должен как минимум включать:
  - `ant-plus-adapter` с поддержкой `Muscle Oxygen`;
  - `ui-gateway` profile `veloerg`;
  - при необходимости recorder.
- Первый layout профиля `veloerg` держим минимальным:
  - одна основная страница;
  - блок controls/status;
  - график `moxy.smo2`;
  - график `moxy.thb`;
  - telemetry;
  - дальше расширяем профиль по мере подключения остальных live-источников.

### 7. Стратегия по ОС

- Цель интеграции остаётся кроссплатформенной: минимум macOS и Windows.
- Практический порядок работ:
  - сначала поднимаем и стабилизируем интеграцию на текущей машине разработки;
  - затем отдельно проверяем Windows и фиксируем platform-specific проблемы.
- Важно не строить ложное ожидание, что USB/libusb-путь автоматически одинаков на всех ОС:
  - ANT+ профиль действительно общий;
  - но driver stack, права доступа, установка `libusb` и упаковка приложения зависят от ОС.
- Следствие:
  - в коде стараемся держать платформенную специфику только в тонком transport/bootstrap слое;
  - в плане и документации сразу считаем Windows отдельной вехой валидации, а не "должно заработать само".

## Предлагаемый контракт `v1`

### 1. Новые `EventTypes`

Предлагаемые добавления в [packages/core/src/event-types.ts](../packages/core/src/event-types.ts):

```ts
export const EventTypes = {
  // ...
  adapterScanRequest: 'adapter.scan.request',
  adapterScanStateChanged: 'adapter.scan.state.changed',
  adapterScanCandidates: 'adapter.scan.candidates',
} as const;
```

Минимальный набор именно такой:

- `adapter.scan.request` — входная команда на поиск устройств;
- `adapter.scan.state.changed` — системный факт для `scanning=true/false`;
- `adapter.scan.candidates` — отдельный факт со списком найденных кандидатов.

В `v1` специально не добавляем:

- `adapter.scan.cancel.request`
- `adapter.scan.progress`
- `adapter.scan.failed`

Ошибки поиска пока идут через уже существующий `ui.error`, а не через отдельную scan-state machine.

### 2. Payload-интерфейсы runtime-событий

Предлагаемые добавления в [packages/core/src/events.ts](../packages/core/src/events.ts):

```ts
export interface AdapterScanRequestPayload {
  adapterId: string;
  requestId?: string;
  timeoutMs?: number;
  formData?: Record<string, unknown>;
}

export interface AdapterScanStateChangedPayload {
  adapterId: string;
  scanning: boolean;
  requestId?: string;
  scanId?: string;
  message?: string;
}

export type AdapterScanCandidateDetailValue = string | number | boolean | null;

export interface AdapterScanCandidate {
  candidateId: string;
  title: string;
  subtitle?: string;
  details?: Record<string, AdapterScanCandidateDetailValue>;
  connectFormData: Record<string, unknown>;
}

export interface AdapterScanCandidatesPayload {
  adapterId: string;
  requestId?: string;
  scanId: string;
  candidates: AdapterScanCandidate[];
}
```

Практические правила:

- `adapter.scan.request`
  - общий контракт для ANT+, BLE и других device-oriented adapter'ов;
  - `formData` оставляем как escape hatch для adapter-specific параметров поиска.
- `scanId`
  - создаётся адаптером;
  - живёт только в рамках одного scan;
  - нужен, чтобы связать список кандидатов и последующий `connect`.
- `connectFormData`
  - уже готовый payload-фрагмент для `adapter.connect.request.formData`;
  - UI не должен сам собирать низкоуровневый descriptor устройства из кусочков.

### 3. Как выглядит scan/connect flow

Предлагаемая семантика:

1. UI отправляет `adapter.scan.request`.
2. Адаптер публикует `adapter.scan.state.changed` с `scanning=true`.
3. Адаптер завершает поиск и публикует `adapter.scan.candidates`.
4. Адаптер публикует `adapter.scan.state.changed` с `scanning=false`.
5. UI открывает локальный `modalForm` и показывает список найденных кандидатов.
6. Submit формы отправляет обычный `adapter.connect.request`.

Пример `adapter.scan.request`:

```ts
{
  adapterId: 'ant-plus',
  requestId: 'req-123',
  timeoutMs: 5000,
  formData: {
    profile: 'muscle-oxygen',
  },
}
```

Пример `adapter.scan.candidates` для Moxy:

```ts
{
  adapterId: 'ant-plus',
  requestId: 'req-123',
  scanId: 'scan-456',
  candidates: [
    {
      candidateId: 'moxy:12345:31:1',
      title: 'Moxy 12345',
      subtitle: 'Muscle Oxygen',
      details: {
        deviceId: 12345,
        transmissionType: 1,
      },
      connectFormData: {
        scanId: 'scan-456',
        candidateId: 'moxy:12345:31:1',
      },
    },
  ],
}
```

Пример последующего `adapter.connect.request`:

```ts
{
  adapterId: 'ant-plus',
  requestId: 'req-789',
  formData: {
    profile: 'muscle-oxygen',
    scanId: 'scan-456',
    candidateId: 'moxy:12345:31:1',
  },
}
```

### 4. Минимальное расширение `ui.ts` для `modalForm`

Для `modalForm` не нужна отдельная "вторая схема", но текущего `UiControlAction` уже недостаточно.

Предлагаемый минимальный шаг:

```ts
export interface UiModalForm {
  id: string;
  title: string;
  submitLabel?: string;
  submitEventType: string;
  submitPayload?: Record<string, unknown>;
  fields: UiModalFormNode[];
}

export type UiModalFormNode =
  | UiModalFormRow
  | UiModalFormColumn
  | UiModalFormTextInput
  | UiModalFormNumberInput
  | UiModalFormDecimalInput
  | UiModalFormFileInput
  | UiModalFormSelect;

export interface UiModalFormRow {
  kind: 'row';
  children: UiModalFormNode[];
}

export interface UiModalFormColumn {
  kind: 'column';
  children: UiModalFormNode[];
}

export interface UiModalFormTextInput {
  kind: 'textInput';
  fieldId: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
}

export interface UiModalFormNumberInput {
  kind: 'numberInput';
  fieldId: string;
  label: string;
  required?: boolean;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface UiModalFormDecimalInput {
  kind: 'decimalInput';
  fieldId: string;
  label: string;
  required?: boolean;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface UiModalFormFileInput {
  kind: 'fileInput';
  fieldId: string;
  label: string;
  required?: boolean;
  mode: 'existing-file' | 'existing-directory';
}

export interface UiModalFormSelect {
  kind: 'select';
  fieldId: string;
  label: string;
  required?: boolean;
  sourceId: string;
  mergeSelectedOptionPayload?: boolean;
}
```

Именно `select` нужно добавить сразу, даже если в первом наброске его не было:

- без `select` нельзя нормально выбрать один из найденных scan-кандидатов;
- `textInput` здесь был бы искусственным и хрупким обходом.

Расширение `UiControlAction`:

```ts
export interface UiControlAction {
  id: string;
  // ...
  modalForm?: UiModalForm;
  kind: 'button';
}
```

Семантика:

- если у action есть `commandType`, клик сразу отправляет команду;
- если у action есть `modalForm`, клик локально открывает форму;
- runtime не получает событие "форма открыта" или "форма закрыта".

### 5. Dynamic options для локальных форм

Для списка найденных устройств нужен отдельный `UiControlMessage`, потому что:

- candidates — это runtime-данные;
- форма живёт локально;
- flags для списка объектов слишком примитивны.

Предлагаемое расширение [packages/core/src/ui.ts](../packages/core/src/ui.ts):

```ts
export interface UiFormOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  payload?: Record<string, unknown>;
}

export type UiControlMessage =
  | // ...
  | {
      type: 'ui.form.options.patch';
      sourceId: string;
      options: UiFormOption[];
    };
```

Семантика:

- `sourceId` связывает конкретное поле `select` с пришедшими runtime-данными;
- `ui-gateway` materialize'ит `adapter.scan.candidates` в `ui.form.options.patch`;
- клиент обновляет options локальной формы, если она открыта.
- если поле `select` включает `mergeSelectedOptionPayload`, `payload` выбранной option вливается в итоговый `formData`.

### 6. Небольшая правка уже существующих контрактов

Сейчас у нас есть расхождение:

- UI уже генерирует `correlationId`;
- часть payload'ов в `events.ts` требует `requestId`.

Для scan/connect flow это лучше выровнять заранее:

```ts
export interface AdapterConnectRequestPayload {
  adapterId: string;
  formData?: Record<string, unknown>;
  requestId?: string;
}

export interface AdapterDisconnectRequestPayload {
  adapterId: string;
  requestId?: string;
}
```

Практическое правило:

- если `requestId` не пришёл явно, runtime может использовать `correlationId` как fallback для трассировки.

## Проверка без физического stick

Короткий ответ: без stick нельзя проверить сам USB/driver слой, но можно проверить почти всю остальную логику, если transport отделён от worker-логики.

### 1. Что именно нельзя проверить без железа

- реальное открытие USB-устройства;
- реальное поведение `libusb`;
- реальный attach/detach stick;
- реальные platform-specific проблемы macOS и Windows;
- реальную совместимость конкретного донгла с библиотекой.

### 2. Что можно и нужно проверять без stick

- `adapter.scan.request -> scanning=true -> candidates -> scanning=false`;
- отсутствие stick как доменный сценарий ошибки;
- materialization `ui.error` в toast;
- открытие `modalForm` по control action;
- подстановку выбранного кандидата в `adapter.connect.request.formData`;
- дедупликацию по `event_count`;
- обработку gap по `event_count`;
- построение `signal.batch` для `moxy.smo2` и `moxy.thb`;
- привязку первого пакета к `session time`.

### 3. Практичный тестовый контур

Рекомендуемая абстракция:

```ts
interface AntTransport {
  scan(request: AntScanRequest): Promise<AntScanResult>;
  connect(request: AntConnectRequest): Promise<void>;
  disconnect(): Promise<void>;
  onPacket(handler: (packet: AntPacket) => void): void;
}
```

Реализации:

- `RealAntTransport`
  - тонкая обёртка над библиотекой `ant-plus`;
- `FakeAntTransport`
  - тестовый transport для unit/integration сценариев;
- `ReplayAntTransport`
  - воспроизводит заранее сохранённую последовательность scan-result'ов и packet'ов.

### 4. Минимальный набор тестовых сценариев

1. `FakeAntTransport` выбрасывает `stick_not_found`:
   - адаптер публикует `adapter.scan.state.changed(scanning=true)`;
   - затем `adapter.scan.state.changed(scanning=false)`;
   - затем `ui.error` с понятным сообщением для toast.
2. `FakeAntTransport` возвращает несколько кандидатов:
   - адаптер публикует `adapter.scan.candidates`;
   - `ui-gateway` маппит их в `ui.form.options.patch`;
   - клиент открывает `modalForm` и отправляет корректный `adapter.connect.request`.
3. `FakeAntTransport` воспроизводит поток Moxy packet'ов:
   - адаптер дедуплицирует `event_count`;
   - собирает `signal.batch`;
   - публикует только `moxy.smo2` и `moxy.thb`;
   - удерживает временную шкалу в `session time`.
4. `ReplayAntTransport` воспроизводит реальную запись:
   - проверяем не только happy-path, но и packet gaps, reorder и reconnect boundary.

Итог:

- toast "stick не подключен" нужен для UX;
- но как единственная проверка он недостаточен;
- без transport abstraction качественного тестового контура не будет.

## Что ещё открыто

Открытые вопросы после фиксации базовой стратегии:

1. Нужно решить, где именно хранить `UiModalForm`:
   - прямо внутри `UiControlAction.modalForm`;
   - или в общем registry внутри `UiSchema` с ссылкой по `formId`.
2. Нужно решить, как именно `ui-gateway` будет маппить `adapter.scan.candidates` в `ui.form.options.patch`:
   - напрямую в одном месте;
   - или через промежуточный helper/registry по `sourceId`.
3. Нужно решить формат replay-фикстур для `ReplayAntTransport`:
   - JSON со scan-result'ами и пакетами;
   - или отдельный более строгий формат для последующего расширения на BLE.

### Оценка риска

- интеграция в `sensync2`: реалистична;
- риск ниже, чем я ожидал до исследования, потому что muscle oxygen профиль уже реализован;
- основной риск смещается с протокола на USB/driver/runtime packaging.

Итоговая оценка:
- ANT+ в `sensync2` поддержать можно;
- лучший кандидат на сегодня: `ant-plus`;
- для Moxy это хороший и достаточно обоснованный выбор.

## Источники

- [Loghorn/ant-plus](https://github.com/Loghorn/ant-plus)
- [ant-plus на npm](https://www.npmjs.com/package/ant-plus)
- [muscle-oxygen-sensors.ts](https://github.com/Loghorn/ant-plus/blob/master/src/muscle-oxygen-sensors.ts)
- [sample/muscle-oxygen.js](https://github.com/Loghorn/ant-plus/blob/master/sample/muscle-oxygen.js)
- Текущая реализация в `sensync`: `../sensync/drivers/moxy/driver.py`
