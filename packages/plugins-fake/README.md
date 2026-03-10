# packages/plugins-fake

Demo и replay-плагины для `v1`.

## Для чего

- Дают тестовую среду для runtime без реального железа.
- Покрывают адаптеры, процессоры и replay-сценарий для veloerg HDF5.

## Как работает

- Плагины запускаются как обычные worker-плагины через `plugin-sdk`.
- Часть плагинов генерирует синтетический поток (`fake`, `shapes`, `interval`), часть строит derived данные (`rolling-min`, `activity-detector`), а `veloerg-h5-replay-adapter` проигрывает подготовленный bundle.

## Взаимодействие

- Подключаются в `apps/runtime/src/default-plugins.ts`.
- Используют контракты из `packages/core` и `packages/plugin-sdk`.
- Для replay зависят от результата `scripts/convert_h5_to_replay.py`.

Дополнительно:

- Формат replay bundle описан в [REPLAY_FORMAT.md](/Users/tascan/Documents/sirius/sensync2/packages/plugins-fake/REPLAY_FORMAT.md).
