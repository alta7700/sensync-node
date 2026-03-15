# packages

Папка содержит переиспользуемые workspace-пакеты.

## Для чего

- Здесь лежат все общие контракты, SDK, runtime-утилиты и плагины, на которых собираются `apps/*`.

## Как работает

- `core` задаёт типы и wire-контракты.
- `plugin-kit` даёт переиспользуемые helper'ы для adapter и processor authoring поверх `core` и `plugin-sdk`.
- `plugin-sdk` задаёт модель worker-плагина.
- `plugins-*` реализуют доменную логику поверх этих контрактов.
- `plugins-ant-plus` отвечает за ANT+ scan/connect/data flow и transport boundary к stick.
- `plugins-ble` отвечает за BLE scan/connect/notify/write flow и boundary к `noble`.
- `plugins-trigno` отвечает за TCP connect/start/stop/status flow и boundary к `Delsys Trigno`.
- `plugins-hdf5` отвечает за запись выбранных сигналов в `HDF5`.
- `client-runtime` материализует UI-поток на стороне renderer.
- `devtools` зарезервирован под bench и инспекторы.

## Взаимодействие

- `apps/runtime` зависит почти от всех пакетов.
- `apps/client` использует `core` и `client-runtime`.
- `apps/desktop` использует `core` и `runtime`.
