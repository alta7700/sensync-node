# packages/plugins-processors

Набор generic processor-плагинов поверх `@sensync2/plugin-kit`.

## Для чего

- Здесь живут domain-обработчики сигналов, которые не должны принадлежать transport-адаптерам.
- Пакет собирает reusable processor-plugin'ы, которые можно подключать в launch profiles как обычные worker-плагины.

## Как работает

- Каждый processor остаётся отдельным `PluginModule`.
- Общий lifecycle, exact input subscription и emit логика собираются через `@sensync2/plugin-kit`.
- Алгоритмы обработки сигнала держатся рядом с processor-файлами, чтобы не смешивать их с device boundary.

## Взаимодействие

- Использует `@sensync2/core`, `@sensync2/plugin-sdk` и `@sensync2/plugin-kit`.
- Подключается в `apps/runtime/src/profiles/*` как обычный plugin descriptor.
- Может обрабатывать потоки от любых adapter-плагинов, если те публикуют совместимый `signal.batch`.
