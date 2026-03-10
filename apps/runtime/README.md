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
- `default-plugins.ts` задаёт demo-конфигурацию, которая сейчас строится вокруг replay bundle и `ui-gateway`.

## Взаимодействие

- Использует `@sensync2/core`, `@sensync2/plugin-sdk`, `@sensync2/plugins-fake`, `@sensync2/plugins-ui-gateway`.
- Может стартовать отдельно для отладки или через `apps/desktop`.
