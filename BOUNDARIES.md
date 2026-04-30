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
- [apps/runtime/src/workspace-ui-command-boundary.ts](apps/runtime/src/workspace-ui-command-boundary.ts)

Что считается boundary:

- `UiCommandMessage` из renderer;
- его `eventType`, `eventVersion` и `payload`.

Что происходит:

- runtime находит guard по `(type, v)` уже не только среди shared-команд `core`, но и в workspace-агрегате plugin-specific guards;
- guard проверяет payload;
- shared-команда `label.mark.request` проходит этот же ingress как обычная UI-команда, а не как особый shortcut для interval-сценария;
- shared-команда `timeline.reset.request` тоже валидируется тем же boundary, но затем перехватывается `RuntimeHost` до обычного `publish()` и уходит в special reset coordinator;
- только после этого сообщение превращается в внутренний `RuntimeEventInput`.

Что уже trusted:

- `RuntimeEventInput`, прошедший boundary guard;
- дальнейшая маршрутизация в шине.

Отдельная оговорка:

- `timeline reset` не является "обычным runtime event flow" даже после boundary-валидации;
- worker-side запрос reset проходит через специальное сообщение `plugin.timeline-reset.request`, а не через `ctx.emit(...)`.

### 2. Launch profile / env ingress

Поток:

`process.env -> launch-profile-boundary -> PluginDescriptor config -> RuntimeHost`

Файлы:

- [apps/runtime/src/launch-profile-boundary.ts](apps/runtime/src/launch-profile-boundary.ts)
- [apps/runtime/src/profiles/index.ts](apps/runtime/src/profiles/index.ts)
- [apps/runtime/src/profiles/README.md](apps/runtime/src/profiles/README.md)

Что считается boundary:

- `SENSYNC2_PROFILE`;
- `SENSYNC2_HDF5_SIMULATION_FILE`;
- остальные env-параметры simulation/profile.

Что происходит:

- env читается и нормализуется отдельно;
- путь к HDF5-файлу валидируется до построения композиции плагинов;
- profile-модули в `apps/runtime/src/profiles/*` работают уже с нормализованными значениями.

Оговорка:

- не все replay-профили обязаны задавать HDF5-файл через env;
- profile может разрешить отложенный выбор файла через UI `adapter.connect.request.formData.filePath`, если сам data-source boundary умеет такой режим.

Что уже trusted:

- `PluginDescriptor[]`, которые отдаёт profile-builder.

### 3. HDF5 simulation/viewer file ingress

Поток:

`env/filePath formData/HDF5 file -> hdf5-simulation-boundary -> ChannelReaderState/SimulationSessionState -> signal.batch`

Файлы:

- [packages/plugins-hdf5/src/hdf5-simulation-boundary.ts](packages/plugins-hdf5/src/hdf5-simulation-boundary.ts)
- [packages/plugins-hdf5/src/hdf5-simulation-adapter.ts](packages/plugins-hdf5/src/hdf5-simulation-adapter.ts)
- [packages/plugins-hdf5/src/hdf5-viewer-adapter.ts](packages/plugins-hdf5/src/hdf5-viewer-adapter.ts)

Что считается boundary:

- путь к файлу;
- `formData.filePath` из `adapter.connect.request`, если profile включает delayed file selection;
- наличие `/channels`;
- attrs каналов;
- dataset shape/type;
- монотонность timestamps;
- фильтрация `streamIds`.

Что происходит:

- boundary открывает файл;
- при delayed file selection boundary сначала нормализует `formData.filePath`, а уже потом открывает файл;
- проверяет структуру нового HDF5-формата;
- строит session/channel reader state;
- для replay читает окна данных и формирует внутренние `signal.batch`;
- для viewer читает те же validated datasets целиком и отдает history snapshot без фонового timer-cadence.

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
- RR timestamps не берутся напрямую из внешнего packet time: после `reset/reconnect/sequence gap` первый пакет якорится к локальному времени runtime, ранние точки режутся по `timelineStartSessionMs`, а дальше адаптер снова живёт по доверенной device-базе.

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

### 7. Trigno TCP ingress

Поток:

`formData/command TCP/data TCP -> trigno-boundary + trigno-transport -> trigno-adapter -> signal.batch / trigno.status.reported / adapter.state.changed`

Файлы:

- [packages/plugins-trigno/src/trigno-boundary.ts](packages/plugins-trigno/src/trigno-boundary.ts)
- [packages/plugins-trigno/src/trigno-transport.ts](packages/plugins-trigno/src/trigno-transport.ts)
- [packages/plugins-trigno/src/trigno-adapter.ts](packages/plugins-trigno/src/trigno-adapter.ts)

Что считается boundary:

- `formData.host`, `formData.sensorSlot`, `formData.vlSensorSlot`, `formData.rfSensorSlot` из UI;
- TCP banner и ASCII-ответы command socket;
- бинарные data sockets `50043/50044`;
- live status snapshot устройства перед `START`.

Что происходит:

- `formData` нормализуется до `TrignoConnectRequest` в одном из двух режимов:
  - legacy single-sensor `host + sensorSlot`;
  - paired `host + vlSensorSlot + rfSensorSlot`;
- command-layer ответы валидируются и переводятся в `TrignoStatusSnapshot`, который тоже может быть single-sensor или paired с `sensors.vl` / `sensors.rf`;
- бинарные data sockets режутся по fixed step layout протокола;
- в paired mode один и тот же пакет режется по `startIndex` обоих датчиков;
- только потом адаптер публикует `signal.batch` и runtime state.

Что уже trusted:

- `TrignoConnectRequest`;
- `TrignoStatusSnapshot`;
- extracted raw batches:
  - legacy `trigno.avanti` и `trigno.avanti.gyro.{x,y,z}`;
  - paired `trigno.vl.avanti*` и `trigno.rf.avanti*`.

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
