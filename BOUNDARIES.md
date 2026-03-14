# BOUNDARIES.md

Карта внешних boundary-слоёв `sensync2`.

Этот документ фиксирует, где в систему входят внешние данные, где они валидируются и в какой точке начинаются доверенные runtime-события.

## Для чего

- Не смешивать внешние ingress-слои с доверенной внутренней шиной.
- Явно показать, где нужна runtime-валидация, а где достаточно контрактов `TypeScript`.
- Упростить дальнейшее добавление новых адаптеров, форматов и transport boundary.

## Главный принцип

В `sensync2` есть две зоны:

1. **Boundary zone**
- сюда попадают внешние данные;
- здесь они нормализуются, валидируются и переводятся в внутренние контракты;
- здесь нельзя доверять shape данных "по определению".

2. **Trusted runtime zone**
- начинается с момента, когда данные уже стали зарегистрированным `RuntimeEvent` в общей шине;
- здесь runtime проверяет только:
  - существование `(type, v)` в registry;
  - согласованность `kind`;
  - согласованность `priority`;
  - право emitter'а выпускать событие.

Иначе:

- payload-валидация делается **до шины**;
- шина работает только с уже нормализованными контрактами.

## Карта boundary-слоёв

### 1. UI ingress

Поток:

`Renderer -> UiCommandMessage -> boundary guards -> RuntimeEventInput -> RuntimeHost.publish(...)`

Файлы:

- [packages/core/src/ui-command-boundary.ts](packages/core/src/ui-command-boundary.ts)
- [packages/core/src/ui.ts](packages/core/src/ui.ts)
- [apps/runtime/src/runtime-host.ts](apps/runtime/src/runtime-host.ts)

Что считается boundary:

- `UiCommandMessage` из renderer;
- его `eventType`, `eventVersion` и `payload`.

Что происходит:

- runtime находит guard по `(type, v)`;
- guard проверяет payload;
- только после этого сообщение превращается в внутренний `RuntimeEventInput`.

Что уже trusted:

- `RuntimeEventInput`, прошедший boundary guard;
- дальнейшая маршрутизация в шине.

### 2. Launch profile / env ingress

Поток:

`process.env -> launch-profile-boundary -> PluginDescriptor config -> RuntimeHost`

Файлы:

- [apps/runtime/src/launch-profile-boundary.ts](apps/runtime/src/launch-profile-boundary.ts)
- [apps/runtime/src/default-plugins.ts](apps/runtime/src/default-plugins.ts)

Что считается boundary:

- `SENSYNC2_PROFILE`;
- `SENSYNC2_HDF5_SIMULATION_FILE`;
- остальные env-параметры simulation/profile.

Что происходит:

- env читается и нормализуется отдельно;
- путь к HDF5-файлу валидируется до построения композиции плагинов;
- `default-plugins.ts` работает уже с нормализованными значениями.

Что уже trusted:

- `PluginDescriptor[]`, которые отдаёт profile-builder.

### 3. HDF5 simulation file ingress

Поток:

`HDF5 file -> hdf5-simulation-boundary -> ChannelReaderState/SimulationSessionState -> signal.batch`

Файлы:

- [packages/plugins-hdf5/src/hdf5-simulation-boundary.ts](packages/plugins-hdf5/src/hdf5-simulation-boundary.ts)
- [packages/plugins-hdf5/src/hdf5-simulation-adapter.ts](packages/plugins-hdf5/src/hdf5-simulation-adapter.ts)

Что считается boundary:

- путь к файлу;
- наличие `/channels`;
- attrs каналов;
- dataset shape/type;
- монотонность timestamps;
- фильтрация `channelIds`.

Что происходит:

- boundary открывает файл;
- проверяет структуру нового HDF5-формата;
- строит session/channel reader state;
- читает окна данных и формирует внутренние `signal.batch`.

Что уже trusted:

- `SimulationSessionState`;
- `signal.batch`, собранные из validated datasets.

### 4. ANT+ ingress

Поток:

`env/formData/raw driver packets -> ant-plus-boundary -> transport requests/packets -> ant-plus-adapter -> signal.batch`

Файлы:

- [packages/plugins-ant-plus/src/ant-plus-boundary.ts](packages/plugins-ant-plus/src/ant-plus-boundary.ts)
- [packages/plugins-ant-plus/src/ant-plus-adapter.ts](packages/plugins-ant-plus/src/ant-plus-adapter.ts)

Что считается boundary:

- env overrides для ANT+ режима;
- `formData` из UI-команд scan/connect;
- сырые `Buffer` пакеты и raw profile fields из библиотеки `ant-plus`.

Что происходит:

- env нормализуется в конфиг адаптера;
- `formData` переводится в transport request;
- raw packet/page переводится в `AntTransportPacket`;
- только после этого адаптер применяет runtime-логику lifecycle/reconnect/timestamping.

Что уже trusted:

- `AntTransportScanRequest`;
- `AntTransportConnectRequest`;
- `AntTransportPacket`.

### 5. BLE ingress

Поток:

`env/formData/advertisement + noble transport callbacks -> ble-boundary -> transport requests/notifications -> zephyr-bioharness-3-adapter -> signal.batch/telemetry/adapter state`

Файлы:

- [packages/plugins-ble/src/ble-boundary.ts](packages/plugins-ble/src/ble-boundary.ts)
- [packages/plugins-ble/src/ble-central.ts](packages/plugins-ble/src/ble-central.ts)
- [packages/plugins-ble/src/zephyr-protocol.ts](packages/plugins-ble/src/zephyr-protocol.ts)
- [packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts](packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts)

Что считается boundary:

- env overrides для BLE режима Zephyr;
- env-флаг debug-логирования BLE discovery/connect;
- `formData` из UI-команд scan/connect;
- advertisement/peripheral metadata и `disconnect` callbacks от `noble`;
- сырые `Buffer` notifications от GATT characteristic.

Что происходит:

- env нормализуется в конфиг адаптера;
- `formData` переводится в BLE transport request;
- candidate list от `noble` нормализуется и ранжируется по Zephyr score, но не режется жёстко только по `localName`;
- raw notifications переводятся в уже проверенные Zephyr packets или diagnostic parse-error.

Что уже trusted:

- `BleTransportScanRequest`;
- `BleTransportConnectRequest`;
- `BleTransportNotification`;
- `ZephyrParsedPacket`.

### 6. Recorder write boundary

Поток:

`recording.start payload -> recorder validation -> HDF5 file write`

Файлы:

- [packages/plugins-hdf5/src/hdf5-recorder-plugin.ts](packages/plugins-hdf5/src/hdf5-recorder-plugin.ts)

Что считается boundary:

- user metadata;
- channel config;
- filename template;
- путь вывода на диск.

Что происходит:

- plugin дополнительно валидирует scalar metadata и channel config;
- только потом открывает файл и начинает запись.

Почему это не вынесено в отдельный boundary-модуль:

- текущий объём логики ещё слишком мал;
- отдельный модуль пока не снижает связность так заметно, как для simulation или ANT+.

## Что boundary **не** делает

- Не регистрирует события в workspace registry.
- Не проверяет `manifest.emits`.
- Не выполняет маршрутизацию.
- Не знает про mailboxes и backpressure.

Это уже зона runtime bus.

## Почему здесь нет codegen

Для event registry codegen полезен:

- он собирает exact union типов;
- убирает ручную сборку большого `RuntimeEvent`.

Для boundary-слоёв codegen сейчас невыгоден:

- boundary содержит не только декларации, но и реальную runtime-логику;
- нужно проверять файлы, attrs, env, raw packets, `formData`;
- генератор здесь не убирает существенный объём ручного кода, а только добавляет ещё один слой синхронизации.

Текущий принцип:

- boundary-модули пишутся вручную;
- boundary-модули покрываются точечными тестами;
- codegen не добавляется, пока не появится повторяемый декларативный паттерн.

## Где проходит граница доверия

Если коротко:

- **до** boundary-helper: данные недоверенные;
- **после** boundary-helper и **до** `RuntimeHost.publish(...)`: данные нормализованы;
- **после** `RuntimeHost.publish(...)`: данные считаются trusted runtime-events.

## Что обновлять при изменении boundary

Если меняется любой внешний ingress или trust boundary, нужно обновлять:

- этот файл;
- `README.md` затронутого модуля;
- при необходимости [packages/core/CONTRACTS.md](packages/core/CONTRACTS.md), если меняется общий контракт события или семантика ingress.
