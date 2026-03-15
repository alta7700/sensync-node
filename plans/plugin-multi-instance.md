# ТЗ: поддержка нескольких инстансов одного plugin-модуля

Дата: 15 марта 2026 года.

## Цель

Добавить в `sensync2` штатную поддержку нескольких инстансов одного и того же plugin-модуля в одном runtime.

Примеры целевых кейсов:

- два одинаковых adapter-plugin с разными `adapterId` и разным конфигом;
- два processor-plugin одного типа, но с разными входами и параметрами;
- несколько recorder/plugin gateway инстансов одного и того же кода.

## Что мешает сейчас

Текущий runtime смешивает два разных понятия в одно поле `id`:

- тип плагина;
- идентификатор конкретного экземпляра.

Это видно по коду:

- [../apps/runtime/src/types.ts](../apps/runtime/src/types.ts)
- [../apps/runtime/src/plugin-host.ts](../apps/runtime/src/plugin-host.ts)
- [../apps/runtime/src/runtime-host.ts](../apps/runtime/src/runtime-host.ts)
- [../apps/runtime/src/subscription-index.ts](../apps/runtime/src/subscription-index.ts)
- [../packages/plugin-sdk/src/worker.ts](../packages/plugin-sdk/src/worker.ts)

Сейчас действуют два жёстких ограничения:

1. `PluginDescriptor.id` должен совпадать с `manifest.id`.
2. Внутренние реестры runtime key'ятся по этому же значению.

Из этого следует:

- два инстанса с одинаковым `id` перетрут друг друга в `Map<string, PluginHost>`;
- два инстанса с разными `descriptor.id` не запустятся, если модуль возвращает фиксированный `manifest.id`.

## Правильная модель

Нужно развести:

- `pluginType` — идентификатор типа плагина или кода модуля;
- `instanceId` — идентификатор конкретного экземпляра в текущем runtime.

Пример:

- `pluginType = "zephyr-bioharness-3-adapter"`
- `instanceId = "zephyr-left"`
- `instanceId = "zephyr-right"`

Именно `instanceId` должен стать ключом runtime-инстанса.

## Целевая модель идентичности

### Plugin descriptor

Вместо текущей модели:

```ts
{ id, modulePath, config }
```

нужна модель вроде:

```ts
{
  instanceId: string,
  modulePath: string,
  config?: unknown,
}
```

### Plugin manifest

В манифесте должен остаться идентификатор типа, а не экземпляра.

Например:

```ts
{
  pluginType: 'zephyr-bioharness-3-adapter',
  version: '0.1.0',
  ...
}
```

Если сохранять поле `id` ради совместимости, его смысл нужно поменять: это должен быть именно `pluginType`, а не runtime-instance id.

## Что должно перейти на `instanceId`

Ниже перечислены места, которые нельзя оставить на старой модели.

### Runtime host

Перевести на `instanceId`:

- `pluginHosts`
- routing callback'и `onReady/onEmit/onError/onMetric`
- список runtime plugins
- warning/error fallback attribution
- telemetry registry
- `sourcePluginId` в event envelope

### Plugin host

Перевести на `instanceId`:

- telemetry `pluginId`
- сравнение identity между runtime и worker
- lifecycle/error messages

При этом worker должен знать и `instanceId`, и `pluginType`.

### Subscription index

Подписки надо хранить по `instanceId`, а не по `manifest.id`.

Важно:

- два инстанса одного pluginType с одинаковыми subscriptions должны оба получать одно и то же событие;
- следовательно, индекс не должен схлопывать их в один key.

### Worker context

`PluginContext.pluginId` должен стать `instanceId`.

Это важно, потому что:

- именно он попадает в `sourcePluginId`;
- именно по нему UI и telemetry должны различать инстансы.

## Совместимость с event contracts

Для event registry это изменение допустимо.

Причина:

- registry и так работает по `(type, v)` и `manifest.emits/subscriptions`;
- ему не нужен уникальный `pluginType` на весь runtime;
- ему нужен уникальный `instanceId` на время жизни процесса.

Единственное, что надо отдельно проверить:

- `isEventAllowedForPlugin(...)` и related проверки должны работать по манифесту конкретного инстанса, а не по глобальному имени типа.

## Совместимость с adapter semantics

У adapter-plugin уже есть отдельное понятие `adapterId` в config.

Это полезно и должно сохраниться.

Получается три уровня идентичности:

1. `pluginType`
   - тип кода или логического плагина;
2. `instanceId`
   - runtime-экземпляр worker'а;
3. `adapterId`
   - доменный идентификатор устройства/источника данных во внешней системе.

Пример:

- `pluginType = "zephyr-bioharness-3-adapter"`
- `instanceId = "zephyr-left-worker"`
- `adapterId = "zephyr-left"`

Именно это позволяет иметь два одинаковых модуля без путаницы в UI и data-path.

## Целевая миграция

### Этап 1. Runtime identity refactor

Сделать минимальную архитектурную переделку:

- `PluginDescriptor.id` заменить на `instanceId`;
- `PluginManifest.id` трактовать как `pluginType` или ввести новое поле;
- все runtime map/index key'ить по `instanceId`.

### Этап 2. Worker protocol

Передавать в worker:

- `pluginInstanceId`;
- `pluginModulePath`;
- `pluginConfig`.

`PluginContext.pluginId` должен стать instance-level identity.

### Этап 3. Launch profiles

После runtime refactor можно описывать в профилях несколько инстансов одного модуля:

```ts
[
  {
    instanceId: 'zephyr-left-worker',
    modulePath: moduleFileUrl('packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts'),
    config: { adapterId: 'zephyr-left', mode: 'real' },
  },
  {
    instanceId: 'zephyr-right-worker',
    modulePath: moduleFileUrl('packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts'),
    config: { adapterId: 'zephyr-right', mode: 'real' },
  },
]
```

### Этап 4. Migration smoke

Минимальные smoke-cases:

1. два fake processor инстанса одного модуля;
2. два fake adapter инстанса одного модуля с разными `adapterId`;
3. один recorder module в двух инстансах с разными writer config;
4. только после этого — реальные device adapters.

## Оценка по Zephyr

### Архитектурно

После refactor multi-instance plugin runtime два инстанса `zephyr-bioharness-3-adapter` как кода поднять можно.

Причины:

- каждый plugin worker живёт в отдельном потоке;
- module-level state у Zephyr-плагина не разделяется между worker'ами;
- `adapterId` уже configurable в `ble-boundary.ts`.

### Практически для fake mode

Два fake Zephyr после multi-instance refactor выглядят реалистично и должны работать без принципиальных проблем.

### Практически для real mode

Здесь риск высокий.

Сейчас каждый Zephyr plugin-инстанс поднимает свой собственный `BleTransport`, а `RealBleTransport` внутри использует `@abandonware/noble` и сам управляет:

- scan lifecycle;
- connect/disconnect конкретного peripheral;
- discover listeners;
- stopScanning/startScanning.

Это видно в:

- [../packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts](../packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts)
- [../packages/plugins-ble/src/ble-central.ts](../packages/plugins-ble/src/ble-central.ts)
- [../packages/plugins-ble/src/ble-boundary.ts](../packages/plugins-ble/src/ble-boundary.ts)

Проблема в том, что два реальных Zephyr-инстанса на одном хосте будут конкурировать не только логически, но и за один BLE adapter/stack ОС.

Риски:

- параллельный scan из двух worker'ов;
- конкуренция за `startScanning/stopScanning`;
- несколько независимых listener'ов над одним BLE stack;
- гонки reconnect между двумя worker'ами;
- ограничение ОС или `noble` по числу одновременных connect/discover операций.

Итоговая оценка:

- `два fake Zephyr` — да, после runtime multi-instance refactor;
- `два real Zephyr` — не как первый шаг.

Правильный порядок:

1. сначала сделать общий multi-instance runtime;
2. потом проверить два fake Zephyr;
3. для real BLE отдельно решить, нужен ли один общий BLE central на процесс вместо двух независимых `noble`-owner инстансов.

## Оценка по Moxy / ANT+

### Архитектурно

После refactor multi-instance plugin runtime два инстанса `ant-plus-adapter` как кода поднять можно.

Причины:

- каждый plugin worker живёт отдельно;
- module-level state у ANT+ плагина не разделяется между worker'ами;
- `adapterId` уже configurable в `ant-plus-boundary.ts`;
- connect request уже умеет различать устройства по `deviceId` и `candidateId`.

### Практически для fake mode

Два fake Moxy после multi-instance refactor выглядят реалистично и должны работать без принципиальных проблем.

### Практически для real mode

Сейчас это не готовый сценарий.

Причина не в runtime, а в transport ownership:

- каждый `RealAntTransport` сам открывает `GarminStick2/3`;
- каждый инстанс сам создаёт свой `MuscleOxygenScanner` или `MuscleOxygenSensor`;
- каждый инстанс сам владеет lifecycle `stick.open() / stick.close()`.

Это видно в:

- [../packages/plugins-ant-plus/src/ant-plus-adapter.ts](../packages/plugins-ant-plus/src/ant-plus-adapter.ts)
- [../packages/plugins-ant-plus/src/ant-plus-boundary.ts](../packages/plugins-ant-plus/src/ant-plus-boundary.ts)

Из этого следуют риски:

- два plugin-инстанса попробуют независимо открыть один и тот же USB stick;
- второй инстанс может просто не открыть stick;
- scan/connect lifecycle двух worker'ов будет конфликтовать по владению stick;
- reconnect одного инстанса будет неявно мешать другому.

### Правильная целевая модель для Moxy

Для `Moxy` правильная единица масштабирования — не plugin instance, а устройство внутри одного ANT+ transport owner.

То есть целевая модель должна быть такой:

- один plugin `ant-plus-adapter`;
- один physical ANT+ stick owner внутри transport-слоя;
- несколько device sessions внутри этого же plugin;
- отдельный `adapterId` / `deviceId` / output mapping на каждое найденное устройство.

Это важное уточнение:

- multi-instance runtime остаётся полезной общей возможностью системы;
- но конкретно для `нескольких Moxy на одном dongle` использовать два plugin-инстанса было бы неправильной гранулярностью.

### Оценка по реализуемости

Здесь ситуация даже лучше, чем у двух real Zephyr, но только после отдельной транспортной переделки.

Причина:

- ANT+ protocol и hardware-модель естественно допускают несколько сенсоров на одном stick;
- значит правильная архитектура здесь не «два независимых stick-owner plugin-а», а один shared stick owner с несколькими sensor channels внутри одного plugin.

Итоговая оценка:

- `два fake Moxy` — да, после runtime multi-instance refactor;
- `два real Moxy на текущем коде` — нет, почти наверняка будут конфликты за один stick;
- `два real Moxy` как целевой сценарий нужно делать не через два plugin-инстанса, а через один plugin с multi-device transport;
- после такого refactor сценарий выглядит реалистично и, вероятно, даже проще как целевой multi-device path, чем два real Zephyr.

Правильный порядок:

1. сначала сделать общий multi-instance runtime;
2. потом проверить два fake Moxy;
3. потом вынести ANT+ stick ownership в один transport-manager внутри `plugins-ant-plus`;
4. добавить внутри одного `ant-plus-adapter` поддержку нескольких одновременно подключённых Moxy;
5. и только после этого считать multi-device Moxy сценарием первого класса.

## Что не делать

Не надо пытаться решать multi-instance для runtime и multi-device BLE в одном refactor.

Это разные задачи:

- multi-instance runtime — общесистемная идентичность plugin worker'ов;
- multi-device BLE — отдельная транспортная архитектура внутри `plugins-ble`.

Если смешать их, отладка станет непрозрачной.

## Критерии готовности

Поддержка multi-instance может считаться готовой, если выполняются условия:

1. Runtime позволяет зарегистрировать два descriptor'а на один и тот же `modulePath`.
2. Два инстанса одного pluginType не конфликтуют в `pluginHosts`, telemetry и subscriptions.
3. `sourcePluginId` в emitted events различает экземпляры.
4. Два fake-инстанса одного adapter-plugin реально работают в одном runtime.
5. UI warning/error/telemetry различают инстансы, а не только тип плагина.

## Итоговое решение

Поддержка нескольких инстансов одного plugin-модуля для `sensync2` нужна и архитектурно укладывается в текущую модель.

Но её нужно делать через разделение:

- `pluginType`
- `instanceId`
- `adapterId`

После этого multi-instance runtime будет нормальной системной возможностью.

Для `Zephyr` это означает:

- два fake-инстанса выглядят реалистично;
- два real-инстанса требуют отдельной переработки BLE transport-слоя и не должны быть первым целевым кейсом.
