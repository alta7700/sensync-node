# packages/plugins-fake

Synthetic demo-плагины для `v1`.

## Для чего

- Дают тестовую среду для runtime без реального железа.
- Покрывают synthetic fake-сценарий и базовые processor-примеры.

## Как работает

- Плагины запускаются как обычные worker-плагины через `plugin-sdk`.
- Часть плагинов генерирует синтетический поток (`fake`, `shapes`, `interval`), часть строит derived данные (`rolling-min`, `activity-detector`).
- Plugin-specific timer и metric events этого пакета зарегистрированы рядом в `src/event-contracts.ts`.
- В `fake` launch profile этот пакет даёт основной demo-runtime.

## Взаимодействие

- Подключаются через `apps/runtime/src/default-plugins.ts` как часть launch profiles.
- Используют контракты из `packages/core` и `packages/plugin-sdk`.
- Часто используются вместе с `packages/plugins-hdf5` для smoke и demo-записи.
