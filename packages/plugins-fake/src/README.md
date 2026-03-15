# packages/plugins-fake/src

Исходники demo-плагинов.

## Для чего

- Здесь лежит доменная логика тестовых источников и простых процессоров.

## Как работает

- `fake-signal-adapter.ts` — синтетические каналы `fake.*`, собранные через `adapter-kit` и запускаемые по `auto-on-init`, но только после общего runtime-барьера `runtime.started`.
- `shape-generator-adapter.ts` — генерация управляемых форм `shapes.signal`; подключение остаётся manual.
- `interval-label-adapter.ts` — метки интервалов.
- `rolling-min-processor.ts` — пример таймерного процессора.
- `activity-detector-processor.ts` — пример derived state/plugin processor.
- `event-contracts.ts` — plugin-specific события пакета (`fake.scheduler.tick`, `shape.scheduler.tick`, `processor.rolling-min.flush`, `metric.value.changed`).
- `helpers.ts` — локальные helper'ы для оставшихся простых адаптеров и процессоров; базовый lifecycle/uniform emit уехал в `@sensync2/adapter-kit`.

## Взаимодействие

- Все плагины описываются через `definePlugin`.
- Сигналы этих плагинов дальше материализуются в UI через `packages/plugins-ui-gateway`.
- `fake-*`, `shape-*`, `interval-*` и процессоры входят в launch profile `fake`.
