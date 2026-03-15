# packages/adapter-kit/src

Исходники helper'ов для adapter-kit.

## Для чего

- Здесь лежат независимые модули, которые адаптеры могут брать точечно.

## Как работает

- Каждый файл отвечает за один маленький слой: state holder, output registry, signal emit, autoconnect, scan или reconnect.
- `autoconnect-policy.ts` не должен сам диктовать момент запуска: безопасная точка для автоподключения обычно приходит извне через `runtime.started`.
- Общий `index.ts` только реэкспортирует эти helper'ы и типы.

## Взаимодействие

- Код отсюда подключают runtime-адаптеры, но не UI и не transport boundary.
- Изменения в публичных type/API этого каталога должны сопровождаться обновлением `packages/adapter-kit/README.md`.
