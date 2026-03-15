# ТЗ: `plugin-kit` для composable helper'ов worker-плагинов

Дата: 15 марта 2026 года.

## Статус плана

Этот план заменяет направление `adapter-kit` + `processor-kit` на единый пакет:

- `packages/plugin-kit`

Старые планы:

- `plans/adapter-kit.md`
- `plans/processor-kit.md`

сохраняются как исторический контекст, но больше не считаются целевой формой архитектуры.

## Цель

Добавить в `sensync2` отдельную библиотеку `packages/plugin-kit`, которая даст переиспользуемые helper'ы для любых worker-plugin'ов поверх `plugin-sdk`.

Пакет должен закрыть две группы задач:

- уже реализованные adapter-oriented helper'ы:
  - output map;
  - `signal.batch` emit;
  - adapter state holder;
  - scan flow;
  - autoconnect / reconnect policy;
- новые processor-oriented helper'ы:
  - input map;
  - сборка manifest fragment для входов;
  - локальные store для signal/fact;
  - локальные состояния поверх latest facts;
  - declarative event handlers поверх runtime-событий и таймеров.

Ключевая идея:

- `plugin-kit` не является новым SDK;
- `plugin-kit` не подменяет `definePlugin(...)`;
- `plugin-kit` не владеет runtime;
- `plugin-kit` разбирает повторяющуюся authoring-логику на маленькие composable винтики.

## Почему объединяем

Разделение на `adapter-kit` и `processor-kit` оказалось искусственным.

На уровне домена роли разные:

- adapter-plugin работает на boundary с внешним устройством или внешним источником;
- processor-plugin работает на внутреннем вычислительном пути поверх уже полученных runtime-событий.

Но на уровне helper-слоя задачи совпадают:

- описать входы или выходы;
- материализовать маленький локальный state;
- унифицировать event creation;
- унифицировать реакцию на события;
- управлять жизненным циклом только тех ресурсов, которые helper сам поднял.

Если держать два отдельных пакета, быстро появятся дубли:

- `output-map` рядом с `input-map`;
- emit helper рядом с window/store helper;
- локальные state helper'ы для adapter и processor в разных местах;
- несколько несовместимых мини-рантаймов поверх одного `plugin-sdk`.

Правильнее иметь один helper-layer для worker-plugin authoring.

## Архитектурная позиция

Фиксируем жёстко:

- `plugin-kit` — библиотека helper'ов поверх `plugin-sdk`;
- `plugin-kit` не экспортирует новый `definePlugin`-заменитель;
- `plugin-kit` не делает обязательный `defineAdapterPlugin(...)` или `defineProcessorPlugin(...)`;
- plugin по-прежнему сам владеет:
  - `manifest`;
  - `onInit`;
  - `onEvent`;
  - `onShutdown`;
  - transport/domain logic;
- helper может помочь собрать куски `manifest`, но не скрывает факт существования `manifest`;
- helper, который сам запускает ресурс, обязан сам уметь его остановить;
- helper не должен завершать то, что не он начал;
- source of truth по runtime-событиям остаётся в runtime bus;
- `plugin-kit` не вводит общий глобальный store сигналов или фактов;
- `plugin-kit` не лезет в UI-materialized состояние.

Практический принцип:

- плагин может использовать только один helper;
- или собрать из helper'ов свой локальный composition layer;
- или вообще не использовать `plugin-kit`.

Пакет не должен навязывать единственный authoring path.

## Базовая терминология

Для shared signal contract используем только:

- `stream`
- `streamId`

Термин `channel` в `v1` для shared signal path не используется.

Для входных runtime-событий используем:

- `signal input` — вход по `signal.batch` + exact `streamId`;
- `fact input` — вход по `(type, v)` обычного runtime-события.

Для локального состояния plugin'а используем:

- `state cell` — локальная ячейка `previous/current`;
- `state expression` — `and/or/not` над именованными `state cell`.

## Что появляется в пакете

Пакет `packages/plugin-kit` делится на два слоя.

### 1. Общий generic helper-layer

Новые или перенесённые generic-модули:

- `src/input-map.ts`
- `src/output-map.ts`
- `src/manifest-fragment.ts`
- `src/signal-emit.ts`
- `src/signal-window.ts`
- `src/fact-store.ts`
- `src/state-cell.ts`
- `src/state-expression.ts`
- `src/input-runtime.ts`
- `src/handlers.ts`
- `src/types.ts`

### 2. Adapter-oriented helper-layer

Переносимые adapter-модули:

- `src/adapter-state-holder.ts`
- `src/autoconnect-policy.ts`
- `src/reconnect-policy.ts`
- `src/scan-flow.ts`

То есть adapter-specific helper'ы остаются в пакете, но пакет больше не называется adapter-only.

## Публичные интерфейсы `v1`

Ниже перечислена целевая форма интерфейсов `v1`.

### 1. `input-map`

`input-map` должен быть симметричен `output-map`.

Минимальные типы:

```ts
export interface SignalInputDescriptor {
  kind: 'signal';
  streamId: string;
  retain: { by: 'samples' | 'durationMs'; value: number };
}

export interface FactInputDescriptor {
  kind: 'fact';
  event: { type: string; v: number };
  retain: 'latest';
}

export type InputDescriptor = SignalInputDescriptor | FactInputDescriptor;
export type InputDescriptorInput = InputDescriptor;

export interface InputMap<TInputKey extends string = string> {
  has(inputKey: TInputKey): boolean;
  get(inputKey: TInputKey): InputDescriptor;
  entries(): Array<[TInputKey, InputDescriptor]>;
  signalEntries(): Array<[TInputKey, SignalInputDescriptor]>;
  factEntries(): Array<[TInputKey, FactInputDescriptor]>;
}

export function signalInput(options: {
  streamId: string;
  retain: { by: 'samples' | 'durationMs'; value: number };
}): SignalInputDescriptor;

export function factInput(options: {
  event: { type: string; v: number };
  retain?: 'latest';
}): FactInputDescriptor;

export function createInputMap<TInputKey extends string>(
  definition: Record<TInputKey, InputDescriptorInput>,
): InputMap<TInputKey>;
```

Правила `v1`:

- signal input по умолчанию всегда exact `streamId`;
- prefix-subscribe в `input-map` не поддерживается;
- `factInput(...).retain` в `v1` только `latest`;
- `createInputMap(...)` валидирует:
  - непустой `streamId`;
  - отсутствие дубликатов signal input по `streamId`;
  - отсутствие дубликатов fact input по `(type, v)`, если ключи разные, но контракт один и тот же.

## 2. `manifest-fragment`

Плагин сам владеет `manifest`, но helper'ы должны помогать собрать и применить куски manifest.

Минимальная форма:

```ts
export interface ManifestFragment {
  subscriptions: EventSubscription[];
  emits: EventRef[];
}

export function createEmptyManifestFragment(): ManifestFragment;

export function mergeManifestFragments(
  ...fragments: ManifestFragment[]
): ManifestFragment;

export function applyManifestFragment(
  manifest: PluginManifest,
  fragment: ManifestFragment,
): void;

export function buildManifestFragmentFromInputs(
  inputs: InputMap,
): ManifestFragment;
```

Семантика:

- signal input даёт подписку:
  - `type = 'signal.batch'`
  - `v = 1`
  - `kind = 'data'`
  - `priority = 'data'`
  - `filter.streamId = descriptor.streamId`
- fact input даёт подписку на указанный `(type, v)`;
- `mergeManifestFragments(...)` дедуплицирует:
  - subscriptions по `(type, v, kind, priority, filter)`;
  - emits по `(type, v)`.

`applyManifestFragment(...)` мутирует `manifest` in place.

Это осознанное решение, потому что текущий worker отправляет `plugin.ready` только после завершения `onInit`, значит config-dependent materialization manifest допустим до момента публикации manifest наружу.

## 3. `output-map` и `signal-emit`

Текущие helper'ы из `adapter-kit` переезжают в `plugin-kit` без смены семантики.

Минимально сохраняем:

```ts
export interface OutputDescriptor {
  streamId: string;
  units?: string;
}

export interface OutputRegistry<TOutputKey extends string = string> {
  has(outputKey: TOutputKey): boolean;
  get(outputKey: TOutputKey): OutputDescriptor;
  entries(): Array<[TOutputKey, OutputDescriptor]>;
}

export function createOutputRegistry<TOutputKey extends string>(
  definition: Record<TOutputKey, string | OutputDescriptor>,
): OutputRegistry<TOutputKey>;

export function createUniformSignalEmitter<TOutputKey extends string>(
  registry: OutputRegistry<TOutputKey>,
): {
  createEvent(...): RuntimeEventInputOf<'signal.batch', 1>;
  emit(...): Promise<void>;
};

export function createIrregularSignalEmitter<TOutputKey extends string>(
  registry: OutputRegistry<TOutputKey>,
): {
  createEvent(...): RuntimeEventInputOf<'signal.batch', 1>;
  emit(...): Promise<void>;
};
```

Эти helper'ы остаются общими и доступны не только adapter-plugin'ам, но и processor-plugin'ам.

## 4. `signal-window`

Для processor logic нужен store локального окна сигнала.

Минимальная форма:

```ts
export interface SignalWindowSlice {
  streamId: string;
  frameKind: FrameKind;
  sampleFormat: SampleFormat;
  sampleCount: number;
  values: SignalValues;
  t0Ms: number;
  t1Ms: number;
  timestampsMs?: Float64Array;
  units?: string;
}

export interface SignalWindowStore {
  descriptor(): SignalInputDescriptor;
  push(event: RuntimeEventOf<'signal.batch', 1>): boolean;
  clear(): void;
  sampleCount(): number;
  latestBatch(): RuntimeEventOf<'signal.batch', 1> | null;
  latestSamples(count: number): SignalWindowSlice | null;
  windowMs(durationMs: number): SignalWindowSlice | null;
}

export function createSignalWindowStore(
  descriptor: SignalInputDescriptor,
): SignalWindowStore;
```

Семантика `push(...)`:

- если `event.payload.streamId !== descriptor.streamId`, helper возвращает `false`;
- если stream совпал, batch сохраняется локально и helper возвращает `true`;
- trimming выполняется сразу после `push(...)`;
- `retain.by = 'samples'` режет по количеству сэмплов;
- `retain.by = 'durationMs'` режет по session-time окна.

Семантика чтения:

- `latestBatch()` возвращает последний полный runtime event;
- `latestSamples(count)` возвращает склеенный slice из последних `count` сэмплов;
- `windowMs(durationMs)` возвращает склеенный slice по временной границе;
- `values` и `timestampsMs` в slice — это новые массивы, а не ссылка на внутреннее хранилище;
- для `uniform-signal-batch` источник истины времени — `t0Ms + dtMs`;
- для `irregular-signal-batch` и `label-batch` источник истины времени — `timestampsMs`;
- `windowMs(durationMs)` для `irregular-signal-batch` и `label-batch` режет окно только по `timestampsMs`, а не реконструирует время из `t0Ms`;
- `t1Ms` для `uniform-signal-batch` вычисляется по последнему сэмплу из равномерной сетки, а для `irregular-signal-batch` и `label-batch` равен последнему значению из `timestampsMs`;
- `push(...)` должен отклонять `irregular-signal-batch` и `label-batch` без валидного `timestampsMs` длины `sampleCount`;
- `v1` предполагает, что в рамках одного `streamId` не скачут `sampleFormat` и `frameKind`; если скачут, helper бросает ошибку.

`v1` сознательно не делает:

- alignment нескольких потоков;
- resampling;
- статистические агрегаты.

## 5. `fact-store`

Для `v1` нужен только latest-store целого runtime event.

Минимальная форма:

```ts
export interface FactStore<TEvent extends RuntimeEvent = RuntimeEvent> {
  descriptor(): FactInputDescriptor;
  push(event: TEvent): boolean;
  clear(): void;
  latest(): TEvent | null;
  latestPayload(): TEvent extends { payload: infer TPayload } ? TPayload | null : null;
}

export function createFactStore<TEvent extends RuntimeEvent = RuntimeEvent>(
  descriptor: FactInputDescriptor,
): FactStore<TEvent>;
```

Семантика:

- helper хранит весь event целиком, а не только `payload`;
- `push(...)` сравнивает `(type, v)` с descriptor;
- на несовпадающем событии возвращает `false`;
- на совпадающем заменяет latest и возвращает `true`.

## 6. `state-cell`

Для локальных состояний нужен отдельный маленький примитив, а не mini-framework.

Минимальная форма:

```ts
export interface StateCell<TValue> {
  current(): TValue | null;
  previous(): TValue | null;
  set(nextValue: TValue): {
    changed: boolean;
    previous: TValue | null;
    current: TValue;
  };
  clear(): void;
}

export function createStateCell<TValue>(
  initialValue?: TValue,
): StateCell<TValue>;
```

Семантика:

- helper хранит `previous/current`;
- `set(...)` определяет `changed` через `Object.is(...)`;
- если значение не изменилось, `previous/current` остаются актуальными, а `changed = false`;
- это generic primitive, он не знает ничего про facts или signals.

## 7. `state-expression`

В `v1` состояния строятся только из latest facts и комбинируются через `and/or/not`.

Минимальная форма:

```ts
export type StateExpression<TStateKey extends string> =
  | { state: TStateKey; eq: unknown }
  | { and: StateExpression<TStateKey>[] }
  | { or: StateExpression<TStateKey>[] }
  | { not: StateExpression<TStateKey> };

export type CompiledStateExpression<TStateKey extends string> =
  (reader: (stateKey: TStateKey) => unknown) => boolean;

export function compileStateExpression<TStateKey extends string>(
  expression: StateExpression<TStateKey>,
): CompiledStateExpression<TStateKey>;
```

Правила:

- expression компилируется один раз;
- evaluation работает по именованным state key;
- `v1` не строит произвольный граф derived-state поверх derived-state;
- если нужен более сложный state flow, plugin пишет его вручную поверх `StateCell`.

## 8. `input-runtime`

Чтобы не дублировать routing к store'ам вручную, нужен helper поверх `input-map`.

Минимальная форма:

```ts
export interface InputRuntime<TInputKey extends string = string> {
  definition(): InputMap<TInputKey>;
  signal(inputKey: TInputKey): SignalWindowStore;
  fact(inputKey: TInputKey): FactStore;
  route(event: RuntimeEvent): TInputKey[];
  clear(): void;
}

export function createInputRuntime<TInputKey extends string>(
  inputs: InputMap<TInputKey>,
): InputRuntime<TInputKey>;
```

Семантика:

- при создании runtime сам поднимает store'ы для каждого input;
- `route(event)`:
  - прогоняет event по relevant store'ам;
  - пушит данные в совпавшие store'ы;
  - возвращает список input key, которые обновились;
- для signal input route работает через `SignalWindowStore.push(...)`;
- для fact input route работает через `FactStore.push(...)`;
- `clear()` чистит все store'ы.

`InputRuntime` не владеет lifecycle plugin'а и не подписывает runtime сам.

## 9. `handlers`

Это основной новый слой `v1`.

`handlers` нужны не как единый hidden runtime, а как набор декларативных реакций, которые можно подписывать и отписывать в любой момент времени.

### Базовый контракт handler'а

```ts
export interface HandlerApi<
  TInputKey extends string = string,
  TStateKey extends string = string,
> {
  inputs: InputRuntime<TInputKey>;
  states: Record<TStateKey, StateCell<unknown>>;
}

export interface PluginHandler<
  TInputKey extends string = string,
  TStateKey extends string = string,
> {
  manifest(): ManifestFragment;
  start(ctx: PluginContext, api: HandlerApi<TInputKey, TStateKey>): Promise<void> | void;
  stop(ctx: PluginContext, api: HandlerApi<TInputKey, TStateKey>): Promise<void> | void;
  handleEvent(
    event: RuntimeEvent,
    ctx: PluginContext,
    api: HandlerApi<TInputKey, TStateKey>,
  ): Promise<void> | void;
}
```

### Группа handler'ов

```ts
export interface HandlerGroup<
  TInputKey extends string = string,
  TStateKey extends string = string,
> {
  manifest(): ManifestFragment;
  start(ctx: PluginContext): Promise<void>;
  stop(ctx: PluginContext): Promise<void>;
  dispatch(event: RuntimeEvent, ctx: PluginContext): Promise<void>;
  add(
    handler: PluginHandler<TInputKey, TStateKey>,
    ctx?: PluginContext,
  ): () => Promise<void>;
}

export function createHandlerGroup<
  TInputKey extends string,
  TStateKey extends string,
>(options: {
  inputs: InputRuntime<TInputKey>;
  states: Record<TStateKey, StateCell<unknown>>;
  handlers: PluginHandler<TInputKey, TStateKey>[];
}): HandlerGroup<TInputKey, TStateKey>;
```

Семантика `HandlerGroup`:

- `manifest()` возвращает merge всех manifest fragment от handler'ов;
- `start(...)` запускает все текущие handler'ы по порядку объявления;
- `dispatch(...)` сначала вызывает `inputs.route(event)`, затем передаёт event всем handler'ам по порядку объявления;
- исполняются все handler'ы, которые совпали по своим правилам;
- `add(...)` позволяет подписать новый handler в runtime;
- если `add(...)` вызван после `start(...)` и передан `ctx`, новый handler стартует сразу;
- функция, возвращённая из `add(...)`, делает unsubscribe и вызывает `stop(...)` у этого handler'а.
- `add(...)` не имеет права расширять runtime contract после `plugin.ready`;
- значит `handler.manifest()` для динамически добавляемого handler'а должен быть пустым или быть подмножеством заранее объявленного superset manifest группы;
- если `handler.manifest()` требует новых `subscriptions` или `emits`, которых нет в заранее materialized `group.manifest()`, `add(...)` обязан бросить ошибку локально;
- dynamic add/remove относится только к локальной orchestration внутри уже объявленного manifest superset.

### Конкретные handler helper'ы `v1`

В `v1` достаточно трёх builder'ов.

#### `createFactStateProjectionHandler(...)`

Проецирует latest fact в локальный `StateCell`.

```ts
export function createFactStateProjectionHandler<
  TInputKey extends string,
  TStateKey extends string,
  TValue,
>(options: {
  input: TInputKey;
  state: TStateKey;
  project: (event: RuntimeEvent) => TValue;
}): PluginHandler<TInputKey, TStateKey>;
```

Семантика:

- на каждом event, который обновил указанный fact input, handler берёт latest event из `api.inputs.fact(...)`;
- прогоняет `project(...)`;
- записывает результат в указанный `StateCell`.

#### `createEveryEventHandler(...)`

Выполняет callback на каждый event выбранного input или event ref.

```ts
export function createEveryEventHandler<
  TInputKey extends string,
  TStateKey extends string,
>(options: {
  selector:
    | { input: TInputKey; event?: never }
    | { event: { type: string; v: number }; input?: never };
  when?: CompiledStateExpression<TStateKey>;
  run: (args: {
    event: RuntimeEvent;
    api: HandlerApi<TInputKey, TStateKey>;
    ctx: PluginContext;
  }) => Promise<void> | void;
}): PluginHandler<TInputKey, TStateKey>;
```

Правило:

- `selector` обязан быть ровно одного вида:
  - либо `input`;
  - либо `event`;
- комбинация `input + event` в одном builder'е в `v1` запрещена;
- если `when` задан и возвращает `false`, callback не вызывается.

#### `createIntervalHandler(...)`

Срабатывает каждые `everyMs`, при этом handler сам стартует и останавливает свой timer.

```ts
export function createIntervalHandler<
  TInputKey extends string,
  TStateKey extends string,
>(options: {
  timerId: string;
  tickEvent: { type: string; v: number };
  everyMs: number;
  when?: CompiledStateExpression<TStateKey>;
  run: (args: {
    api: HandlerApi<TInputKey, TStateKey>;
    ctx: PluginContext;
  }) => Promise<void> | void;
}): PluginHandler<TInputKey, TStateKey>;
```

Семантика:

- `start(...)` вызывает `ctx.setTimer(...)`;
- `stop(...)` вызывает `ctx.clearTimer(...)`;
- timer можно стартовать и останавливать в любое время, жёсткой фиксированной точки старта нет;
- handler сам владеет lifecycle этого timer, потому что сам его поднял;
- `manifest()` этого handler'а добавляет:
  - subscription на `tickEvent`;
  - emit на `tickEvent`;
- сам `tickEvent` должен быть зарегистрирован в plugin-specific event contract того пакета, где живёт конкретный plugin.

Это важное ограничение `v1`:

- generic helper не вводит глобальный shared timer event;
- timer-событие остаётся plugin-specific, но boilerplate по lifecycle и обработке забирает helper.

## 10. Config-dependent materialization

`plugin-kit` должен явно поддерживать config-driven inputs и handler composition.

Под этим понимается сценарий:

- один и тот же plugin module может запускаться с разными `streamId` или другими параметрами из `PluginDescriptor.config`;
- plugin в `onInit(...)` читает config;
- затем строит `InputMap`, `InputRuntime`, `StateCell` и `HandlerGroup`;
- затем materialize'ит manifest fragment;
- только потом публикует готовый manifest через обычный worker lifecycle.

Целевая форма:

```ts
const plugin = definePlugin({
  manifest: {
    id: 'rolling-min-processor',
    version: '0.1.0',
    required: false,
    subscriptions: [],
    mailbox: {
      controlCapacity: 64,
      dataCapacity: 256,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: 'metric.value.changed', v: 1 },
      { type: 'signal.batch', v: 1 },
      { type: 'processor.rolling-min.flush', v: 1 },
    ],
  },
  async onInit(ctx) {
    const cfg = ctx.getConfig<RollingMinConfig>();

    inputs = createInputMap({
      source: signalInput({
        streamId: cfg.sourceStreamId,
        retain: { by: 'durationMs', value: 2000 },
      }),
      interval: factInput({
        event: { type: 'interval.state.changed', v: 1 },
      }),
    });

    inputRuntime = createInputRuntime(inputs);
    states = {
      intervalActive: createStateCell<boolean>(false),
    };

    handlers = createHandlerGroup({
      inputs: inputRuntime,
      states,
      handlers: [
        createFactStateProjectionHandler({
          input: 'interval',
          state: 'intervalActive',
          project: (event) => event.payload.active,
        }),
        createIntervalHandler({
          timerId: 'rolling-min.flush',
          tickEvent: { type: 'processor.rolling-min.flush', v: 1 },
          everyMs: 1000,
          run: async ({ api, ctx }) => {
            const active = api.states.intervalActive.current();
            if (!active) return;
            const window = api.inputs.signal('source').windowMs(1000);
            if (!window || window.sampleCount === 0) return;
            // Дальше processor считает и emit'ит результат сам.
          },
        }),
      ],
    });

    applyManifestFragment(
      plugin.manifest,
      mergeManifestFragments(
        buildManifestFragmentFromInputs(inputs),
        handlers.manifest(),
      ),
    );

    await handlers.start(ctx);
  },
  async onEvent(event, ctx) {
    await handlers.dispatch(event, ctx);
  },
  async onShutdown(ctx) {
    await handlers.stop(ctx);
  },
});
```

Здесь принципиально важно:

- `plugin-kit` помогает materialize state и handlers;
- но `manifest`, `emit` и domain logic всё ещё принадлежат самому plugin.

## 11. Adapter-oriented helper'ы после объединения

Текущий `adapter-kit` после переименования в `plugin-kit` сохраняет существующие helper'ы:

- `createAdapterStateHolder(...)`
- `resolveAutoconnectDecision(...)`
- `runAutoconnect(...)`
- `createReconnectPolicy(...)`
- `createScanFlow(...)`
- `createOutputRegistry(...)`
- `createUniformSignalEmitter(...)`
- `createIrregularSignalEmitter(...)`

Их семантика остаётся прежней.

Новый пакет не переписывает working adapter path, а только расширяет его generic helper'ами.

## Что не делаем в `v1`

Это принципиальный список ограничений.

В `v1` сознательно не делаем:

- `definePlugin`-заменитель;
- общий plugin authoring framework;
- автоматическую генерацию полного manifest без явного участия plugin-кода;
- prefix-input-map для signal path;
- history-store для facts;
- generic rule engine для любых событий;
- batch-count handler'ы;
- автоматическое временное выравнивание signal windows;
- ресемплинг;
- shared event contract для всех interval/timer helper'ов;
- глобальный state graph;
- hidden cleanup чужих ресурсов.

Если добавить это сразу, получится не helper-kit, а ещё один runtime поверх runtime.

## Предлагаемая структура пакета

Минимально разумная структура:

- `packages/plugin-kit/package.json`
- `packages/plugin-kit/README.md`
- `packages/plugin-kit/src/README.md`
- `packages/plugin-kit/src/index.ts`
- `packages/plugin-kit/src/types.ts`
- `packages/plugin-kit/src/manifest-fragment.ts`
- `packages/plugin-kit/src/input-map.ts`
- `packages/plugin-kit/src/output-map.ts`
- `packages/plugin-kit/src/signal-emit.ts`
- `packages/plugin-kit/src/signal-window.ts`
- `packages/plugin-kit/src/fact-store.ts`
- `packages/plugin-kit/src/state-cell.ts`
- `packages/plugin-kit/src/state-expression.ts`
- `packages/plugin-kit/src/input-runtime.ts`
- `packages/plugin-kit/src/handlers.ts`
- `packages/plugin-kit/src/adapter-state-holder.ts`
- `packages/plugin-kit/src/autoconnect-policy.ts`
- `packages/plugin-kit/src/reconnect-policy.ts`
- `packages/plugin-kit/src/scan-flow.ts`

## Первая миграция

Первая стадия должна идти в два шага.

### Шаг 1. Rename и перенос

- переименовать `packages/adapter-kit` в `packages/plugin-kit`;
- обновить imports существующих adapter-plugin'ов;
- обновить `README.md` и package references;
- сохранить поведение adapter helper'ов без semantic changes.

### Шаг 2. Добавление processor helper'ов

Добавить новые generic-модули:

- `input-map`
- `manifest-fragment`
- `signal-window`
- `fact-store`
- `state-cell`
- `state-expression`
- `input-runtime`
- `handlers`

После этого первой очередью мигрировать:

1. `rolling-min-processor`
2. `activity-detector-processor`

Почему именно они:

- уже есть в demo profile;
- у них разный характер логики:
  - timer + signal window;
  - simple signal-derived state;
- на них сразу видно, не превратили ли мы helper-kit в framework.

## Критерии готовности `v1`

`plugin-kit v1` можно считать удачным первым этапом, если выполняются все условия:

1. Существующие adapter helper'ы переехали под новое имя `@sensync2/plugin-kit` без потери поведения.
2. Плагин по-прежнему пишет обычный `definePlugin(...)`, а не проходит через новый framework wrapper.
3. `input-map` симметричен `output-map` и умеет строить manifest fragment для exact `streamId` signal inputs и fact inputs.
4. `InputRuntime` материализует store'ы и роутит события без общего глобального store.
5. `SignalWindowStore` поддерживает retention по `samples` и `durationMs`.
6. `FactStore` хранит весь latest event целиком.
7. `StateCell` даёт `previous/current/changed`.
8. `compileStateExpression(...)` поддерживает `and/or/not`.
9. `HandlerGroup` умеет:
   - запускать и останавливать handler'ы;
   - динамически добавлять и удалять handler'ы;
   - исполнять все совпавшие handler'ы по порядку объявления;
   - запрещать `add(...)`, который требует manifest contract вне заранее объявленного superset.
10. `createEveryEventHandler(...)` принимает ровно один selector и не допускает двусмысленного `input + event`.
11. `createIntervalHandler(...)` сам завершает свои timer'ы и не требует фиксированной точки старта.
12. `SignalWindowStore` явно и корректно работает с `uniform`, `irregular` и `label` временем.
13. `rolling-min-processor` и `activity-detector-processor` можно перевести на helper'ы без потери поведения.

## Риски

### Риск 1. Helper-group разрастётся в скрытый runtime

Снижение риска:

- `HandlerGroup` остаётся опциональным compositional helper;
- plugin сам владеет `manifest` и lifecycle;
- `HandlerGroup` не знает ничего про transport, UI или domain protocol.

### Риск 2. Generic helper'ы смешаются с adapter semantics

Снижение риска:

- отделять generic-модули (`input-map`, `state-cell`, `handlers`) от adapter-oriented (`scan-flow`, `adapter-state-holder`);
- не тянуть device-specific boundary в generic helper'ы.

### Риск 3. Timer helper потребует новый shared event contract

Снижение риска:

- в `v1` interval handler использует plugin-specific tick event;
- helper берёт на себя lifecycle timer'а и manifest fragment, но не навязывает shared timer bus.

### Риск 4. Config-dependent materialization станет неявной магией

Снижение риска:

- `applyManifestFragment(...)` вызывается явно из plugin-кода;
- materialization в `onInit(...)` описана как допустимый и ожидаемый путь.

## Итоговое решение

Для `sensync2` правильное направление такое:

- прекратить развивать `adapter-kit` и `processor-kit` как два разных helper-пакета;
- переименовать helper-layer в `@sensync2/plugin-kit`;
- оставить model `composable helper modules`, а не framework wrapper;
- сохранить существующие adapter helper'ы;
- добавить generic input/store/state/handler helper'ы для processor logic;
- строить manifest fragments явно, а не прятать manifest;
- разрешить dynamic subscribe/unsubscribe локальных handler'ов;
- считать `plugin-kit` общим authoring-layer для любых worker-plugin'ов.

Это решение совместимо с текущей моделью `runtime -> plugin worker -> event bus` и не втаскивает в систему второй скрытый runtime.
