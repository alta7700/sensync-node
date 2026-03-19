# packages

Папка содержит переиспользуемые workspace-пакеты.

## Для чего

- Здесь лежат все общие контракты, SDK, runtime-утилиты и плагины, на которых собираются `apps/*`.

## Как работает

- `core` задаёт типы и wire-контракты.
- `plugin-kit` даёт переиспользуемые helper'ы для adapter и processor authoring поверх `core` и `plugin-sdk`, включая общий `ipc-worker` transport для внешних compute-процессов.
- `plugin-sdk` задаёт модель worker-плагина.
- `plugins-*` реализуют доменную логику поверх этих контрактов.
- `plugins-processor-*` собирают live/generic processor'ы по одному пакету на processor, чтобы не смешивать их зависимости, `.proto` и Python compute-side.
- Среди `plugins-processor-*` теперь есть и mixed TS/Python processor'ы, где потоковая логика живёт в worker-плагине, а плотная численная обработка уходит во внешний compute-worker через `plugin-kit/ipc-worker`.
- `plugins-labels` собирает generic label-generator плагины, которые не должны считаться fake-специфичными.
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
