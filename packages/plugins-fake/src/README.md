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
- `veloerg-h5-replay-adapter.ts` — воспроизведение данных из replay bundle в хронологии записи.
- `helpers.ts` — общие функции для событий адаптеров и signal batch.

## Взаимодействие

- Все плагины описываются через `definePlugin`.
- Сигналы этих плагинов дальше материализуются в UI через `packages/plugins-ui-gateway`.
- Формат replay bundle для `veloerg-h5-replay-adapter.ts` описан в [packages/plugins-fake/REPLAY_FORMAT.md](../REPLAY_FORMAT.md).
