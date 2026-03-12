# apps/runtime

Node runtime и хост plugin worker'ов.

## Для чего

- Это минимальное ядро системы:
  - назначает глобальные `seq`;
  - маршрутизирует события по подпискам;
  - держит очереди плагинов;
  - собирает telemetry;
  - управляет lifecycle worker'ов.

## Как работает

- `RuntimeHost` поднимает плагины из `PluginDescriptor[]`.
- Каждый плагин живёт в отдельном `worker_threads` worker'е через `PluginHost`.
- В `v1` fan-out `signal.batch` при необходимости копирует буферы, а не использует shared memory внутри runtime.
- `default-plugins.ts` задаёт launch profiles:
  - `fake`;
  - `fake-hdf5-simulation`;
  - `veloerg`.
- Профиль выбирается через `SENSYNC2_PROFILE`; если значение не задано, runtime поднимает `fake`.
- Профиль `fake-hdf5-simulation` требует `SENSYNC2_HDF5_SIMULATION_FILE`; путь валидируется до старта worker'ов.
- Профиль `veloerg` поднимает `ant-plus-adapter` в real mode поверх `ant-plus`, а fake transport остаётся только как fallback для локальной отладки.
- Если путь относительный, runtime резолвит его от корня репозитория `sensync2`.

## Взаимодействие

- Использует `@sensync2/core`, `@sensync2/plugin-sdk`, `@sensync2/plugins-ant-plus`, `@sensync2/plugins-fake`, `@sensync2/plugins-hdf5`, `@sensync2/plugins-ui-gateway`.
- В `fake`-профиле поднимает recorder, в `fake-hdf5-simulation` — HDF5-источник с fake-каналами, а в `veloerg` — ANT+/Moxy сценарий.
- Может стартовать отдельно для отладки или через `apps/desktop`.
