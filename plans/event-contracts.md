# План: контракты событий и registry событий

Дата фиксации: 12 марта 2026 года.

Статус решения на сейчас:
- делаем единый registry событий для shared/public и plugin-specific событий;
- `zod` и другие schema-first библиотеки не используем как базовый путь;
- source of truth по контрактам остаётся в `TypeScript`;
- runtime-проверки payload выполняются на внешних границах системы, а не внутри шины на каждом hop;
- внутри шины событие идентифицируется парой `(type, v)`;
- неизвестные события шиной не исполняются и превращаются в warning;
- для UI нужно добавить отдельный канал `ui.warning`, а не перегружать всё через `ui.error`.

## Проблема

Сейчас в `sensync2` есть две разные реальности:

- на уровне `TypeScript` в `packages/core/src/events.ts` описаны payload-типы для многих общих событий;
- на уровне runtime шина в основном знает только:
  - `type`;
  - `kind`;
  - `priority`;
  - несколько routing-полей из payload (`adapterId`, `streamId`, `channelId`).

Следствие:

- строковый `event.type` сам по себе не является полноценным контрактом;
- `packages/core/src/event-types.ts` сейчас выступает как словарь строк, но не как полноценный registry;
- plugin-specific события вообще не имеют формальной общей модели;
- граница между "известным событием" и "случайной строкой" пока размыта.

Это архитектурный долг. Если система действительно plugin-first, у каждого события в общей runtime-шине должен быть формальный контракт.

## Цель

Сделать систему контрактов событий, в которой:

- каждое событие в общей runtime-шине имеет зарегистрированный контракт;
- registry включает и shared/public, и plugin-specific события;
- базовый identity события задаётся парой `(type, v)`;
- событие без зарегистрированного `(type, v)` не исполняется шиной;
- `EventTypes` перестаёт быть просто набором строк и становится частью event-registry;
- payload-валидация выполняется на boundary-слое до попадания события в шину;
- сама шина остаётся дешёвой и не занимается тяжёлой schema-validation на каждом hop.

## Базовый принцип

Нельзя считать событие "существующим" только потому, что у него есть строковый `type`.

Для события в общей runtime-шине должны существовать одновременно:

1. строковый идентификатор `type`;
2. версия `v`;
3. текстовая семантика;
4. `TypeScript`-тип payload;
5. регистрация в event-registry.

Если один из этих пунктов отсутствует, событие не должно считаться нормальным контрактом системы.

## Что считается событием реестра

В registry должны входить:

- shared/public события из `packages/core`;
- plugin-specific события, если они попадают в общую runtime-шину;
- timer-events, если они реально живут в общей delivery-модели runtime;
- системные события materialization/UI, если они существуют как runtime-event.

Необязательно включать в registry:

- чисто локальные данные внутри функции/класса, которые никогда не становятся runtime-event;
- вспомогательные локальные структуры, не публикуемые в общую шину.

Ключевое правило:

- если объект реально публикуется в общую runtime-шину, у него должен быть контракт в registry.

## Предлагаемая модель

### 1. EventContract

Нужен отдельный слой, например:

- `packages/core/src/event-contracts.ts`

Базовая идея:

```ts
export interface EventContract<
  TType extends string = string,
  TVersion extends number = number,
  TPayload = unknown,
  TKind extends "command" | "fact" | "data" | "system" = "command" | "fact" | "data" | "system",
  TPriority extends "control" | "data" | "system" = "control" | "data" | "system",
> {
  type: TType;
  v: TVersion;
  kind: TKind;
  priority: TPriority;
  visibility: "shared" | "plugin-private";
  payloadDescription?: string;
  description?: string;
}
```

Ключевая мысль:

- контракт в registry описывает compile-time модель и семантику события;
- registry не должен быть завязан на `zod` или другую schema-library;
- внутри шины runtime работает по `(type, v)`, `kind`, `priority`, а не по JSON-schema.

### 2. Event envelope

У события в шине должны быть обязательные поля:

- `type`
- `v`
- `kind`
- `priority`
- `seq`
- `tsMonoMs`
- `sourcePluginId`
- `payload`

Это значит, что `v` нужно добавить в базовый runtime event envelope как first-class поле, а не прятать в payload.

### 3. Shared и plugin-specific события

Нужно формально разделить два класса событий:

- `shared`
  - лежат в `packages/core`;
  - доступны нескольким пакетам;
  - обязаны иметь текстовую спецификацию и контракт.
- `plugin-private`
  - живут рядом с конкретным plugin module;
  - не обязаны жить в `packages/core`;
  - но обязаны регистрироваться, если выходят в общую runtime-шину.

Правило:

- `packages/core` не должен превращаться в свалку всех payload-типов мира;
- но `TypeScript` должен уметь собрать union известных событий из пакетов в единый типовой слой.

## Где происходит payload-валидация

Принятое решение:

- runtime-валидация payload выполняется на внешних границах системы;
- внутри шины повторная полная payload/schema-валидация не делается.

### Boundary-слои

Минимальные boundary-слои:

1. `UiCommandMessage -> RuntimeEvent`
2. env/config -> runtime profile config
3. file reader -> runtime event
4. внешний device driver -> runtime event
5. любой transport ingress, который приносит обычный JS-объект извне

### Что делает сама шина

Шина:

- проверяет, что `(type, v)` зарегистрирован;
- проверяет согласованность `kind` и `priority` с контрактом;
- проверяет, что emitter имеет право выпускать это событие;
- если событие неизвестно, игнорирует его и публикует warning.

Шина не делает:

- полную schema-validation payload на каждом publish/deliver;
- тяжёлую deep-check в hot path.

Это решение допустимо только при важном допущении:

- все boundary-слои обязаны пропускать в шину только уже проверенные объекты.

## Поведение при ошибке

### Неизвестное событие

Если `(type, v)` не найден в registry:

1. событие не исполняется;
2. событие не маршрутизируется подписчикам;
3. runtime публикует warning в telemetry и UI;
4. инкрементируется счётчик unknown/rejected events.

### Неконсистентный registry

Если при startup найдены:

- конфликт по одному `(type, v)`;
- несовместимые `kind`/`priority`;
- неизвестные `subscriptions`/`emits`;

то:

- runtime не стартует;
- это `error`, а не warning.

### Невалидный внешний payload

Если payload не прошёл boundary-валидацию:

- событие не должно попасть в шину;
- boundary-слой должен выпустить warning или error по своей политике.

## UI warnings

Нужно расширить UI control messages:

- добавить `ui.warning`;
- использовать `ui.error` только для реально более тяжёлых ситуаций.

Базовый shape:

```ts
type UiControlMessage =
  | { type: "ui.warning"; code: string; message: string; pluginId?: string }
  | { type: "ui.error"; code: string; message: string; pluginId?: string }
  | ...
```

Смысл:

- unknown event type/version;
- rejected event from boundary;
- мягкие incompatibility warning;
- telemetry-grade проблемы, которые не должны убивать runtime.

## Особый случай: `signal.batch`

Для `signal.batch` нужен отдельный compile-time контракт и отдельная boundary-валидация.

Что обязательно проверять на boundary:

- `streamId: string`
- `channelId: string`
- `sampleFormat` из допустимого набора
- `frameKind` из допустимого набора
- `sampleCount` совпадает с длиной `values`
- тип `values` соответствует `sampleFormat`
- если есть `timestampsMs`, их длина совпадает с `sampleCount`
- если `frameKind = uniform-signal-batch`, согласованы `t0Ms`, `dtMs`, `sampleRateHz`
- если `frameKind = irregular-signal-batch | label-batch`, источником истины считаются `timestampsMs`

Что не нужно делать в hot path:

- побайтную или посэмпловую глубокую проверку содержимого массива.

Итог:

- `signal.batch` должен иметь дешёвую структурную проверку на boundary;
- внутри шины это не должно превращаться в дорогую schema-validation.

## Как это встраивается в plugin API

База:

```ts
export interface PluginModule {
  manifest: PluginManifest;
  contracts?: EventContract[];
  onInit(ctx: PluginContext): Promise<void>;
  onEvent(event: RuntimeEventBase, ctx: PluginContext): Promise<void>;
  onShutdown(ctx: PluginContext): Promise<void>;
}
```

Плюс runtime должен проверять:

- все `manifest.subscriptions[]` ссылаются на зарегистрированные `(type, v)`;
- все `manifest.emits[]` ссылаются на зарегистрированные `(type, v)`;
- если plugin публикует событие, которого нет в registry, событие режется и идёт warning;
- `PluginDescriptor.id` и `manifest.id` остаются согласованными.

## Типовой слой TypeScript

Нужен явный общий union известных событий.

Направление:

```ts
type KnownRuntimeEvent =
  | CoreRuntimeEvent
  | FakePluginRuntimeEvent
  | Hdf5PluginRuntimeEvent
  | UiGatewayRuntimeEvent;
```

Идея:

- каждый пакет экспортирует свой union событий;
- runtime и SDK собирают общий union;
- это даёт compile-time поддержку без центральной свалки payload-типов в одном файле.

Это и есть ответ на требование:

- contracts живут рядом с плагинами;
- но `TypeScript` знает обо всех типах событий через общий union.

## Жизненный цикл registry

### Startup

Runtime собирает registry из:

- shared contracts из `packages/core`;
- plugin-specific contracts из загружаемых plugins.

Проверяет:

- нет конфликтов по одному `(type, v)`;
- `kind`/`priority` у одного `(type, v)` не расходятся;
- `subscriptions` и `emits` не ссылаются на неизвестные контракты.

Если здесь ошибка:

- runtime не стартует.

### Publish внутри шины

При publish runtime:

1. находит контракт по `(type, v)`;
2. проверяет `kind` и `priority`;
3. проверяет право emitter публиковать это событие;
4. только после этого назначает событию normal publish flow.

Полная payload-валидация здесь не делается, если событие уже пришло из trusted boundary.

## Что делать с текущим `EventTypes`

На первом этапе:

- оставить `packages/core/src/event-types.ts`;
- но перестать считать его самодостаточным источником истины;
- добавить правило: новый shared `EventTypes.*` запрещён без `EventContract`.

На втором этапе можно решить, стоит ли:

- генерировать `EventTypes` из контрактов;
- или оставить дублирование, но с тестом на синхронность.

## Конкретный технический дизайн

### 1. Новые и изменённые файлы

Нужны следующие точки:

- `packages/core/src/event-contracts.ts`
  - базовые типы `EventRef`, `EventContract`, `defineEventContract`
- `packages/core/src/events.ts`
  - добавление поля `v` в `RuntimeEventBase`
- `packages/core/src/plugin.ts`
  - `manifest.subscriptions` и `manifest.emits` переводятся на `(type, v)`
- `packages/core/src/ui.ts`
  - добавляется `ui.warning`
  - `UiCommandMessage` получает `v`
- `apps/runtime/src/workspace-event-registry.ts`
  - central barrel для contracts и union событий workspace
- `apps/runtime/src/runtime-host.ts`
  - enforcement по `(type, v)`
  - публикация `ui.warning`
- `apps/runtime/src/subscription-index.ts`
  - matching по `(type, v)`
- `packages/*/src/*event-contracts*.ts`
  - contracts рядом с конкретными пакетами/плагинами

### 2. Envelope события

Базовый runtime-event должен стать таким:

```ts
export interface RuntimeEventBase<
  TType extends string = string,
  TVersion extends number = number,
> {
  seq: bigint;
  type: TType;
  v: TVersion;
  tsMonoMs: number;
  sourcePluginId: string | "runtime" | "external-ui";
  correlationId?: string;
  causationSeq?: bigint;
  priority: "control" | "data" | "system";
  kind: "command" | "fact" | "data" | "system";
}
```

Это критично:

- версия становится частью envelope;
- шина умеет различать не просто `type`, а именно `(type, v)`.

### 3. EventRef и Contract

Минимальная модель:

```ts
export interface EventRef<TType extends string = string, TVersion extends number = number> {
  type: TType;
  v: TVersion;
}

export interface EventContract<
  TType extends string = string,
  TVersion extends number = number,
  TPayload = unknown,
  TKind extends "command" | "fact" | "data" | "system" = "command" | "fact" | "data" | "system",
  TPriority extends "control" | "data" | "system" = "control" | "data" | "system",
> extends EventRef<TType, TVersion> {
  kind: TKind;
  priority: TPriority;
  visibility: "shared" | "plugin-private";
  payloadDescription?: string;
  description?: string;
}
```

Плюс helper:

```ts
export function defineEventContract<const T extends EventContract>(contract: T): T {
  return contract;
}
```

### 4. Boundary-helper `isPayload`

`isPayload` в целевой схеме не должен быть обязательной частью registry.

Правильнее сделать так:

```ts
export interface BoundaryPayloadGuard<TPayload> {
  isPayload(input: unknown): input is TPayload;
}
```

И использовать его рядом с событием как companion helper:

```ts
export const recordingStartContract = defineEventContract({
  type: "recording.start",
  v: 1,
  kind: "command",
  priority: "control",
  visibility: "shared",
});

export const recordingStartBoundaryGuard: BoundaryPayloadGuard<RecordingStartPayload> = {
  isPayload(input): input is RecordingStartPayload {
    // ручная проверка boundary-объекта
  },
};
```

Смысл:

- `contract` регистрируется в шине;
- `isPayload` не является обязательным полем registry;
- boundary-слои могут использовать guard из того же модуля;
- сама шина на `isPayload` не опирается в hot path.

### 5. Manifest

`PluginManifest` должен ссылаться на версии событий явно.

Направление:

```ts
export interface EventSubscription extends EventRef {
  kind?: "command" | "fact" | "data" | "system";
  priority?: "control" | "data" | "system";
  filter?: {
    channelIdPrefix?: string;
    adapterId?: string;
    streamId?: string;
  };
}

export interface PluginManifest {
  id: string;
  version: string;
  required: boolean;
  subscriptions: EventSubscription[];
  emits?: EventRef[];
  ...
}
```

Правило:

- plugin не должен emit событие, которого нет в `manifest.emits`;
- runtime должен это проверять на startup и на publish.

### 6. UI contract

`UiCommandMessage` должен нести версию:

```ts
export interface UiCommandMessage {
  type: "ui.command";
  eventType: string;
  v: number;
  payload?: Record<string, unknown>;
  correlationId?: string;
}
```

`UiControlMessage` нужно расширить:

```ts
type UiControlMessage =
  | { type: "ui.warning"; code: string; message: string; pluginId?: string }
  | { type: "ui.error"; code: string; message: string; pluginId?: string }
  | ...
```

### 7. Workspace registry

Так как contracts живут рядом с пакетами, нужен central barrel на уровне workspace.

Направление:

```ts
// apps/runtime/src/workspace-event-registry.ts
import { coreContracts, type CoreRuntimeEvent } from "@sensync2/core";
import { fakeContracts, type FakePluginRuntimeEvent } from "@sensync2/plugins-fake";
import { hdf5Contracts, type Hdf5PluginRuntimeEvent } from "@sensync2/plugins-hdf5";
import { uiGatewayContracts, type UiGatewayRuntimeEvent } from "@sensync2/plugins-ui-gateway";

export const workspaceEventContracts = [
  ...coreContracts,
  ...fakeContracts,
  ...hdf5Contracts,
  ...uiGatewayContracts,
] as const;

export type WorkspaceRuntimeEvent =
  | CoreRuntimeEvent
  | FakePluginRuntimeEvent
  | Hdf5PluginRuntimeEvent
  | UiGatewayRuntimeEvent;
```

Это первый практичный вариант без кодогенерации.

### 8. Поведение RuntimeHost

При publish внутри шины `RuntimeHost` должен:

1. построить ключ `(type, v)`;
2. найти contract в registry;
3. если contract не найден:
   - не dispatch
   - emit `ui.warning`
4. если `kind`/`priority` не совпадают:
   - не dispatch
   - emit `ui.warning`
5. если emitter не имеет права emit этот event:
   - не dispatch
   - emit `ui.warning`
6. если всё совпало:
   - обычный publish flow

### 9. Поведение SubscriptionIndex

`SubscriptionIndex` должен матчить не только `type`, но и `(type, v)`.

То есть:

- подписка на `recording.start v1` не означает автоматическую подписку на `recording.start v2`;
- это и есть ожидаемая изоляция версий.

### 10. Versioning policy

На текущем курсе:

- breaking change не обязан менять строку `type`;
- можно выпускать новый контракт с тем же `type`, но с другим `v`.

Это значит:

- подписки и emits всегда должны указывать версию явно;
- runtime никогда не должен silently match только по `type`.

## Предлагаемый план внедрения

### Этап 1. Инвентаризация

- выписать все shared event types из `packages/core/src/event-types.ts`;
- разделить их на:
  - `command`
  - `fact`
  - `data`
  - `system`
- отметить, какие payload-типы уже описаны;
- отметить plugin-specific события, которые реально выходят в общую шину.

Результат:

- таблица `type -> v -> payload type -> owners -> subscribers`.

### Этап 2. Contract registry

- добавить `EventContract`;
- завести shared registry в `packages/core`;
- покрыть контрактами уже существующие shared events;
- дать плагинам способ экспортировать свои contracts рядом с модулем.

Результат:

- runtime умеет получить контракт по `(type, v)`.

### Этап 3. Boundary validation

- валидировать внешние входы до попадания в шину;
- формировать typed runtime-event только после проверки;
- явно отделить boundary-слой от внутренней шины.

Результат:

- невалидный внешний event больше не идёт в dispatch.

### Этап 4. Manifest cross-check

- runtime на startup проверяет:
  - все `subscriptions`;
  - все `emits`;
  - конфликты между contracts.

Результат:

- ошибка несовместимости ловится до реального прогона.

### Этап 5. Telemetry и warnings

- добавить счётчики:
  - `unknown_event_type_total`
  - `unknown_event_version_total`
  - `boundary_validation_failed_total`
  - `registry_conflicts_total`
- добавить `ui.warning` в UI control messages;
- показывать через него:
  - unknown event warnings
  - boundary validation rejects
  - мягкие incompatibility warning

### Этап 6. Ужесточение политики

- запретить добавление новых shared `EventTypes` без контракта;
- постепенно перевести plugin-specific события на ту же модель;
- решить, нужен ли runtime mode `strict`/`compat`.

## Что фиксируем уже сейчас

1. Любой event в общей шине должен иметь зарегистрированный `(type, v)` контракт.
2. Registry должен включать shared/public и plugin-specific события.
3. Неизвестное событие шиной не исполняется и превращается в warning.
4. `ui.warning` нужен как отдельный UI-канал.
5. `manifest.subscriptions` и `manifest.emits` должны ссылаться только на зарегистрированные контракты.
6. `EventTypes` без `EventContract` — это ошибка архитектуры.
7. Внешняя payload-валидация делается до шины, а не внутри неё на каждом hop.

## Открытые вопросы

### 1. Как технически собирать общий union событий?

Нужен механизм сборки известного union из пакетов:

- явный central barrel;
- кодогенерация registry index;
- ручной runtime import list.

### 2. Должна ли шина принимать plugin-specific события, не перечисленные в `manifest.emits`?

Моя рекомендация:

- нет;
- `manifest.emits` должен быть обязательной декларацией всех событий, которые plugin выпускает в общую шину.

### 3. Какую политику делать для warning?

Нужно зафиксировать:

- warning только в telemetry;
- или ещё и видимый UI feed;
- и нужна ли дедупликация одинаковых warning за окно времени.

Моя рекомендация:

- `ui.warning` нужен;
- одинаковые warning стоит дедуплицировать, иначе UI легко заспамить.

### 4. Что считать trusted boundary?

Это важно, потому что именно туда переезжает payload-валидация.

Минимальный набор boundary-слоёв:

- `UiCommandMessage -> RuntimeEvent`
- env/config -> runtime profile config
- file reader -> runtime event
- внешний device driver -> runtime event

Отдельно нужно зафиксировать, считаем ли `plugin.emit(...)` trusted path или тоже boundary.

Текущий разумный дефолт:

- plugin `emit` внутри runtime считать trusted path, если plugin скомпилирован в нашем workspace и его contracts зарегистрированы.

## Вывод

Текущая модель с `EventTypes` без обязательного registry-контракта действительно слабая.

Целевая модель должна быть такой:

- event `(type, v)` без контракта не существует;
- неизвестное событие не исполняется и идёт в warning;
- shared contracts централизованы;
- plugin-specific contracts тоже регистрируются;
- payload-валидация выполняется на boundary-слое;
- шина не занимается тяжёлой schema-validation каждого hop, но проверяет registry identity и envelope-consistency.
