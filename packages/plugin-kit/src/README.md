# packages/plugin-kit/src

Исходники helper'ов для plugin-kit.

## Для чего

- Здесь лежат независимые модули, которые worker-плагины могут брать точечно.

## Как работает

- Каждый файл отвечает за один маленький слой: input/output mapping, локальные store, handler composition или adapter lifecycle helper.
- `signal-emit.ts` теперь умеет не только uniform/irregular, но и отдельный label-path для `label-batch`.
- `autoconnect-policy.ts` не должен сам диктовать момент запуска: безопасная точка для автоподключения обычно приходит извне через `runtime.started`.
- Общий `index.ts` только реэкспортирует эти helper'ы и типы.

## Взаимодействие

- Код отсюда подключают worker-плагины, но не UI и не transport boundary.
- Изменения в публичных type/API этого каталога должны сопровождаться обновлением `packages/plugin-kit/README.md`.
