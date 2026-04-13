# packages/plugins-labels/src

Исходники generic label-плагинов.

## Для чего

- Здесь лежат reusable worker-плагины для label-stream'ов и их локальная конфигурация.

## Как работает

- `label-generator-adapter.ts` подписывается на `label.mark.request`, валидирует `labelId` и время метки, а затем эмитит `label-batch`.
- На commit нового `timeline.reset` адаптер сбрасывает локальную монотонность, чтобы повторная отправка с начального времени не считалась stale.
- При мягком reject'е команда не пропадает беззвучно: адаптер публикует `command.rejected`, чтобы UI мог показать warning.
- `index.ts` экспортирует публичные entrypoints пакета.

## Взаимодействие

- Runtime-профили подключают этот пакет через `modulePath`.
- `ui-gateway` и другие потребители видят только обычный `signal.batch`, а не внутренние helper'ы плагина.
