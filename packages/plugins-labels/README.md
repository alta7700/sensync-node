# packages/plugins-labels

Generic label-плагины поверх `@sensync2/plugin-kit`.

## Для чего

- Здесь живут worker-плагины, которые публикуют label-stream'ы и не должны считаться fake-специфичными.
- Пакет даёт общий `label-generator-adapter`, который один раз поднимается в профиле и обслуживает несколько configured `labelId`.

## Как работает

- Плагин принимает shared-команду `label.mark.request`.
- Команда адресует внутренний `labelId`, а пакет сам мапит его в конкретный `streamId` через конфиг.
- На каждый mark plugin публикует single-sample `label-batch` и следит за монотонностью времени отдельно для каждого `labelId`.
- После `timeline.reset` на commit пакет сбрасывает локальную монотонность, чтобы новый timeline можно было начинать с той же стартовой отметки.
- Если команда отвергнута мягко (неизвестный `labelId`, stale timestamp, неверный `sampleFormat`), пакет публикует shared fact `command.rejected`, а не ограничивается внутренней telemetry.

## Взаимодействие

- Использует `@sensync2/core`, `@sensync2/plugin-kit` и `@sensync2/plugin-sdk`.
- Подключается в launch profile как обычный worker-plugin.
- UI и profile-схемы могут использовать его для interval/lactate и других label-сценариев без fake-специфичных адаптеров.
