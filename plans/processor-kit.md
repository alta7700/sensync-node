# ТЗ: `processor-kit` для декларативных обработчиков сигналов

Дата: 14 марта 2026 года.

## Цель

Добавить в `sensync2` отдельную библиотеку `packages/processor-kit`, которая позволит писать вычислительные worker-плагины без копирования одной и той же инфраструктуры по сбору входных данных.

Библиотека должна решать три практические задачи:

- декларативно описывать, какие сигналы и факты нужны обработчику;
- локально хранить только тот объём данных, который нужен конкретному обработчику;
- запускать обработку по данным, по таймеру или по изменению условий.

Речь не про общий plugin-collector и не про возврат к центральному store. Источник истины по-прежнему остаётся распределённым: каждый processor-plugin хранит свой собственный локальный контекст в своём worker'е.

## Почему это нужно

Сейчас идея системы уже правильная:

- адаптеры публикуют `signal.batch` и доменные факты;
- processor-plugin подписывается на события, хранит нужное окно и публикует результат;
- `ui-gateway` только materialize'ит уже посчитанные данные.

Проблема в другом: если каждый processor будет сам заново реализовывать буферы, отбор каналов, условия запуска и хранение последних состояний, код быстро развалится на десятки несовместимых локальных реализаций.

Нужна библиотека уровня `processor-kit`, а не новый центральный runtime-механизм.

## Архитектурная позиция

Фиксируем жёстко:

- `processor-kit` — это библиотека, а не отдельный runtime-plugin;
- библиотека используется внутри обычного worker-плагина;
- никакого общего хранилища сигналов на уровне runtime не появляется;
- `plugin-sdk` остаётся низкоуровневым и не превращается в DSP-framework;
- `processor-kit` строится поверх текущей модели `runtime -> plugin worker -> event bus`.

Практически это означает:

- каждый processor-plugin по-прежнему имеет свой `manifest` и свой `worker`;
- `processor-kit` помогает собрать `manifest.subscriptions`, локальные буферы и trigger runtime;
- состояние библиотеки живёт только внутри конкретного processor-plugin.

## Что именно должно появиться

Новый пакет:

- `packages/processor-kit`

Роль пакета:

- декларативное описание входов обработчика;
- автоматическая сборка подписок на события;
- хранение окон сигналов и состояний фактов;
- вычисление условий запуска;
- единый runtime-хук, который вызывает пользовательский обработчик.

## Что не делаем

Это важнее, чем список возможностей.

В `v1` сознательно не делаем:

- общий plugin, который собирает данные для всех обработчиков;
- shared-memory store между processor-плагинами;
- привязку к `ui.flags` или любому UI-materialized состоянию;
- автоматическое выравнивание по времени между несколькими каналами;
- встроенный ресемплинг;
- универсальный DSL для любых вычислений;
- скрытую запись или архивирование данных внутри библиотеки.

Если это всё добавить сразу, получится не `processor-kit`, а второй runtime внутри runtime.

## Базовая модель входов

### 1. Сигнальные входы

Обработчик должен уметь декларативно описывать сигнальные входы по `channelId`.

Примерный вид:

```ts
signals: {
  emg: {
    channelId: 'trigno.emg.vastus_lateralis',
    retain: { by: 'durationMs', value: 2000 },
  },
  rr: {
    channelId: 'zephyr.rr',
    retain: { by: 'samples', value: 64 },
  },
}
```

Что фиксируем:

- идентификатором сигнала в `v1` является `channelId`;
- хранение поддерживает как минимум два режима retention:
  - по количеству сэмплов;
  - по длительности окна в `session time`;
- данные внутри хранятся в локальном ring/window store.

### 2. Фактические входы

Кроме `signal.batch`, обработчику нужны доменные факты и состояния.

Пример:

```ts
facts: {
  interval: {
    event: { type: 'interval.state.changed', v: 1 },
    retain: 'latest',
  },
  adapterState: {
    event: { type: 'adapter.state.changed', v: 1 },
    retain: 'latest',
  },
}
```

Что фиксируем:

- `facts` подписываются на обычные runtime-события из общего реестра `(type, v)`;
- в `v1` библиотеке достаточно двух режимов хранения:
  - `latest`;
  - короткая история по `count` или `durationMs`.

### 3. Условия

Нужна система, похожая по смыслу на `flags`, но это не UI-флаги.

Правильная модель:

- condition — это локально materialized состояние processor-plugin;
- condition вычисляется из фактов, label-stream'ов или локальных derived state;
- condition используется для gating и trigger-логики обработчика.

Для `v1` условия надо разделить на два слоя:

- `atomic conditions` — простые булевы или enum-like состояния, которые напрямую получаются из фактов, сигналов или локального счётчика готовности;
- `derived conditions` — составные условия над уже materialized atomic conditions.

Это лучше, чем пытаться держать всю логику только в `when`, потому что:

- составные условия становятся переиспользуемыми;
- их можно использовать не только для gating, но и как источник `condition-changed` trigger;
- обработчик начинает опираться на доменные имена вроде `canProcess`, а не на каждый раз заново разобранное булево выражение.

Примерно так:

```ts
conditions: {
  isIntervalActive: {
    fromFact: 'interval',
    project: (fact) => fact.state === 'active',
    retain: 'latest',
  },
  isAdapterConnected: {
    fromFact: 'adapterState',
    project: (fact) => fact.state === 'connected',
    retain: 'latest',
  },
}

derivedConditions: {
  canProcess: {
    and: [
      { condition: 'isIntervalActive', eq: true },
      { condition: 'isAdapterConnected', eq: true },
    ],
  },
}
```

Принципиально важно:

- condition не приходит из UI;
- condition не хранится в runtime-глобально;
- condition — это удобный локальный слой над доменными входами конкретного processor-plugin.
- `derived condition` тоже живёт только внутри processor-plugin и не превращается в отдельную шину событий.

Ограничение `v1`:

- не поддерживать произвольный граф зависимостей `condition -> condition -> condition -> ...`;
- достаточно одного явного слоя `atomic conditions` и одного слоя `derived conditions`;
- если этого окажется мало, следующий уровень надо добавлять только после реального использования, а не «на всякий случай».

## Триггеры обработки

Обработчик должен запускаться не только по каждому батчу. Нужны как минимум три типа trigger.

### 1. Data trigger

Запуск при поступлении данных по конкретному входу.

Пример:

```ts
triggers: [
  { kind: 'signal', input: 'emg' },
]
```

### 2. Fact/condition trigger

Запуск при изменении факта или condition.

Пример:

```ts
triggers: [
  { kind: 'condition-changed', condition: 'isIntervalActive' },
]
```

Аналогично должен работать trigger и для составного условия:

```ts
triggers: [
  { kind: 'condition-changed', condition: 'canProcess' },
]
```

### 3. Timer trigger

Запуск по таймеру.

Пример:

```ts
triggers: [
  { kind: 'timer', timerId: 'once-per-second', everyMs: 1000 },
]
```

Это покрывает два главных режима:

- реакция на входящие данные;
- периодическая обработка поверх локального окна.

## Условия запуска обработчика

Одних trigger'ов недостаточно. Нужен ещё gating через `when`.

Пример:

```ts
when: {
  and: [
    { condition: 'isAdapterConnected', eq: true },
    { condition: 'isIntervalActive', eq: true },
  ],
}
```

Именно здесь логично переиспользовать уже знакомую пользователю модель `and / or / not`, но не на уровне UI, а на уровне processor runtime.

Но `when` не должен быть единственным местом, где живёт вся логика составных условий.

Правильный порядок такой:

1. библиотека materialize'ит atomic conditions;
2. библиотека вычисляет derived conditions;
3. `when` использует уже готовые conditions для gating пользовательского обработчика.

То есть `when` по смыслу ближе к `can I run now?`, а не к месту, где описана вся локальная state-модель processor-plugin.

Фиксируем для `v1`:

- поддержка `and`;
- поддержка `or`;
- поддержка `not`;
- leaf-условия работают по локальным conditions;
- evaluation выполняется внутри processor-plugin;
- выражение компилируется один раз при `onInit`, а не интерпретируется заново на каждом событии.

Это важный момент: если выражение условий будет разбираться на каждом батче, библиотека начнёт тратить CPU на собственную инфраструктуру.

## API библиотеки: целевая форма `v1`

Рабочая форма должна быть близка к такому виду:

```ts
export const plugin = defineProcessorPlugin({
  manifest: {
    id: 'rolling-min-processor',
    version: '0.1.0',
    required: false,
  },
  inputs: {
    signals: {
      source: {
        channelId: 'fake.a',
        retain: { by: 'durationMs', value: 2000 },
      },
    },
    facts: {
      interval: {
        event: { type: 'interval.state.changed', v: 1 },
        retain: 'latest',
      },
    },
    conditions: {
      intervalActive: {
        fromFact: 'interval',
        project: (payload) => payload.state === 'active',
      },
    },
    derivedConditions: {
      canProcess: {
        condition: 'intervalActive',
        eq: true,
      },
    },
  },
  triggers: [
    { kind: 'timer', timerId: 'emit', everyMs: 1000 },
  ],
  when: {
    condition: 'canProcess',
    eq: true,
  },
  async onTrigger(trigger, ctx) {
    const window = ctx.inputs.signal('source').windowMs(1000);
    const canProcess = ctx.inputs.condition('canProcess').current();

    if (!canProcess || window.values.length === 0) {
      return;
    }

    // Дальше плагин считает свой результат и сам emit'ит нужные события.
  },
});
```

Важно:

- пользователь библиотеки пишет domain logic, а не инфраструктуру окон;
- `manifest.subscriptions` собирается из `inputs` автоматически;
- библиотека не скрывает emit и не ограничивает processor одним типом результата.

## Что библиотека должна делать автоматически

### Автосборка подписок

Из `inputs.signals` и `inputs.facts` библиотека должна уметь собрать:

- `manifest.subscriptions`;
- фильтры по `channelId` там, где это применимо;
- подписки на `(type, v)` для фактов.

### Хранение локальных окон

Для signals:

- кольцевое хранение значений и времени;
- обрезка по `samples` или `durationMs`;
- единый API чтения окна.

Для facts:

- `latest`;
- опционально короткая история.

Для conditions:

- локальное materialized значение;
- запоминание предыдущего значения для `condition-changed` trigger.
- поддержка как atomic, так и derived conditions.

### Trigger runtime

Библиотека должна сама:

- поднимать таймеры;
- вызывать `onTrigger` при signal/fact/condition/timer trigger;
- проверять `when` до вызова пользовательской логики.

## Что должен видеть код обработчика

Нужен минимальный читаемый API.

### Для сигналов

```ts
ctx.inputs.signal('emg').latestSamples(128)
ctx.inputs.signal('emg').windowMs(500)
ctx.inputs.signal('emg').latestBatch()
```

### Для фактов

```ts
ctx.inputs.fact('interval').latest()
ctx.inputs.fact('interval').history()
```

### Для условий

```ts
ctx.inputs.condition('intervalActive').current()
ctx.inputs.condition('intervalActive').previous()
ctx.inputs.condition('canProcess').current()
```

### Для trigger-контекста

```ts
trigger.kind
trigger.input
trigger.timerId
trigger.changedCondition
```

## Ограничения `v1`

Чтобы библиотека не ушла в неверную абстракцию, фиксируем ограничения.

### Нет автоматического выравнивания каналов

Если обработчику нужны синхронные окна двух разных сигналов, `v1` не пытается автоматически их выровнять или ресемплировать.

Правильный практический вывод:

- в `v1` processor сам отвечает за интерпретацию временного несовпадения окон;
- если потребность будет массовой, позже добавляется отдельный слой alignment helpers.

### Нет UI-state внутри processor runtime

Даже если UI где-то отображает `flags`, processor не должен читать их как источник истины.

Processor работает только с:

- `signal.batch`;
- shared или plugin-specific fact events;
- локально materialized conditions.

### Нет общего каталога буферов между processor-plugin'ами

Если двум обработчикам нужен один и тот же сигнал, каждый хранит своё окно сам.

Это не проблема, а осознанное решение. Цена дублирования памяти здесь лучше, чем цена скрытой связанности и общей мутабельной инфраструктуры.

## Место в текущей архитектуре `sensync2`

Новый пакет должен встроиться так:

- `packages/core` — контракты событий и `(type, v)`;
- `packages/plugin-sdk` — базовый bootstrap worker-плагина;
- `packages/processor-kit` — библиотека более высокого уровня для processor-плагинов;
- `packages/plugins-*` — сами вычислительные плагины, написанные через `processor-kit`.

Это важно не смешивать.

Если попытаться засунуть `processor-kit` в `plugin-sdk`, базовый SDK быстро потеряет минимальность и станет тащить в себе уже доменную вычислительную модель.

## Предлагаемая структура пакета

Минимально разумная структура:

- `packages/processor-kit/src/define-processor-plugin.ts`
- `packages/processor-kit/src/signal-store.ts`
- `packages/processor-kit/src/fact-store.ts`
- `packages/processor-kit/src/condition-store.ts`
- `packages/processor-kit/src/condition-expression.ts`
- `packages/processor-kit/src/trigger-runtime.ts`
- `packages/processor-kit/src/types.ts`
- `packages/processor-kit/README.md`

## Первая миграция на библиотеку

Не надо переводить всё сразу.

Первая очередь миграции:

1. `rolling-min-processor`
2. `activity-detector-processor`

Почему именно они:

- уже есть в demo-пайплайне;
- у них простая и понятная window logic;
- на них сразу видно, хватает ли текущей модели signal/fact/condition/trigger.

## Критерии готовности `v1`

`processor-kit` можно считать удачным первым этапом, если выполняются все условия:

1. Processor-plugin можно описать декларативно без ручной сборки буферов в `onEvent`.
2. Библиотека автоматически собирает subscriptions из описания входов.
3. Поддерживаются retention по `samples` и `durationMs`.
4. Поддерживаются `signal`, `condition-changed` и `timer` trigger.
5. `when`-выражения с `and / or / not` компилируются один раз при инициализации.
6. Два существующих demo-processor можно перевести на библиотеку без потери поведения.
7. В runtime не появляется новый общий store сигналов.

## Риски

### Риск 1. Слишком ранний DSL

Если сделать слишком общий DSL, библиотека станет сложнее самих обработчиков.

Снижение риска:

- ограничить `v1` только signals, facts, conditions и простыми trigger'ами;
- не добавлять alignment/resampling раньше реальной потребности.

### Риск 2. Conditions превратятся во второй event bus

Если разрешить условиям всё подряд, получится скрытая система состояний внутри processor-kit.

Снижение риска:

- condition в `v1` только materialized projection над фактами или локальным derived state;
- без отдельного publish/subscribe-механизма внутри библиотеки.
- максимум один слой derived conditions поверх atomic conditions.

### Риск 3. Библиотека начнёт принимать решения за обработчик

Если библиотека станет сама делать агрегацию, ресемплинг и вычисления, processor-plugin потеряет прозрачность.

Снижение риска:

- библиотека решает только сбор и хранение входов;
- вычислительная логика остаётся в самом plugin.

## Следующий этап после `v1`

Если `v1` покажет себя устойчиво, вторым этапом можно рассматривать:

- helpers для временного выравнивания нескольких сигналов;
- простые статистические окна поверх signal-store;
- выделенный пакет `packages/plugins-processors` для набора типовых вычислительных плагинов.

Но это должно идти только после реального использования `rolling-min` и `activity-detector` через новую библиотеку.

## Итоговое решение

Для `sensync2` правильное направление такое:

- не делать центральный сборщик данных;
- не привязывать обработчики к UI-флагам;
- добавить `packages/processor-kit` как библиотеку для локального декларативного сбора сигналов, фактов и условий;
- условия описывать внутри processor-plugin и использовать их для gating и trigger runtime;
- переводить существующие processor-plugin'ы на новую библиотеку постепенно, начиная с самых простых.

Это решение совместимо с текущей plugin-first архитектурой и не возвращает систему к скрытому общему состоянию.
