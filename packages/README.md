# packages

Папка содержит переиспользуемые workspace-пакеты.

## Для чего

- Здесь лежат все общие контракты, SDK, runtime-утилиты и плагины, на которых собираются `apps/*`.

## Как работает

- `core` задаёт типы и wire-контракты.
- `plugin-sdk` задаёт модель worker-плагина.
- `plugins-*` реализуют доменную логику поверх этих контрактов.
- `plugins-ant-plus` отвечает за ANT+ scan/connect/data flow и transport boundary к stick.
- `plugins-hdf5` отвечает за запись выбранных сигналов в `HDF5`.
- `client-runtime` материализует UI-поток на стороне renderer.
- `devtools` зарезервирован под bench и инспекторы.

## Взаимодействие

- `apps/runtime` зависит почти от всех пакетов.
- `apps/client` использует `core` и `client-runtime`.
- `apps/desktop` использует `core` и `runtime`.
