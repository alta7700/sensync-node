# packages/plugins-fake

Synthetic demo-плагины для `v1`.

## Для чего

- Дают тестовую среду для runtime без реального железа.
- Покрывают synthetic fake-сценарий и базовые processor-примеры.

## Как работает

- Плагины запускаются как обычные worker-плагины через `plugin-sdk`.
- Часть плагинов генерирует синтетический поток (`fake`, `shapes`), часть строит derived данные (`rolling-min`, `activity-detector`).
- `fake-signal-adapter` теперь собран на `@sensync2/plugin-kit` и автоматически подключается только после общего runtime-барьера `runtime.started`, когда подписчики уже зарегистрированы.
- `shape-generator-adapter` тоже использует `@sensync2/plugin-kit`, но остаётся manual-адаптером: поток появляется только после `adapter.connect.request`.
- Plugin-specific timer и metric events этого пакета зарегистрированы рядом в `src/event-contracts.ts`.
- Generic label-generator для `interval.label` теперь вынесен в отдельный пакет `@sensync2/plugins-labels` и больше не считается fake-специфичным адаптером.
- В `fake` launch profile этот пакет даёт основной demo-runtime.

## Взаимодействие

- Подключаются через `apps/runtime/src/profiles/*` как часть launch profiles.
- Используют контракты из `packages/core` и `packages/plugin-sdk`.
- Часто используются вместе с `packages/plugins-hdf5` для smoke и demo-записи.
