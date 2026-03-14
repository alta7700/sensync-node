# packages/plugins-fake/src

Исходники demo-плагинов.

## Для чего

- Здесь лежит доменная логика тестовых источников и простых процессоров.

## Как работает

- `fake-signal-adapter.ts` — синтетические каналы `fake.*`.
- `shape-generator-adapter.ts` — генерация управляемых форм `shapes.signal`.
- `interval-label-adapter.ts` — метки интервалов.
- `rolling-min-processor.ts` — пример таймерного процессора.
- `activity-detector-processor.ts` — пример derived state/plugin processor.
- `event-contracts.ts` — plugin-specific события пакета (`fake.scheduler.tick`, `shape.scheduler.tick`, `processor.rolling-min.flush`, `metric.value.changed`).
- `helpers.ts` — общие функции для событий адаптеров и signal batch.

## Взаимодействие

- Все плагины описываются через `definePlugin`.
- Сигналы этих плагинов дальше материализуются в UI через `packages/plugins-ui-gateway`.
- `fake-*`, `shape-*`, `interval-*` и процессоры входят в launch profile `fake`.
