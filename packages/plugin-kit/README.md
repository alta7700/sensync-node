# packages/plugin-kit

Переиспользуемые helper'ы для runtime-адаптеров.

## Для чего

- Пакет даёт composable helper'ы для worker-плагинов поверх `@sensync2/plugin-sdk`.
- Он закрывает повторяющуюся authoring-логику для adapter и processor plugin'ов: input/output mapping, signal emit, локальные store, state, handler composition и adapter lifecycle helper'ы.
- Для signal emit пакет теперь различает uniform, irregular и отдельный `label-batch` path.
- Пакет не превращается в новый runtime или framework-обёртку и не заменяет transport/boundary код конкретных plugin-пакетов.

## Как работает

- `adapter-state-holder`, `autoconnect-policy`, `reconnect-policy`, `scan-flow`, `output-map` и `signal-emit` сохраняют рабочий adapter-oriented слой.
- `input-map`, `manifest-fragment`, `signal-window`, `fact-store`, `state-cell`, `state-expression`, `input-runtime` и `handlers` дают generic helper-layer для processor logic.
- `autoconnect-policy` только принимает и исполняет решение автоподключения; сам запуск нужно привязывать к безопасной lifecycle-точке, обычно к `runtime.started`, а не к `onInit()`.
- `handlers` не расширяет runtime contract после `plugin.ready`: динамическое добавление разрешено только внутри заранее объявленного manifest superset.
- Для timeline-reset `v1` пакет даёт:
  - `createTimelineResetParticipant(...)` для локального lifecycle/resettable resources;
  - `clipSignalBatchToTimelineStart(...)` для clipping первого батча нового timeline.

## Взаимодействие

- Пакет зависит только от `@sensync2/core` и `@sensync2/plugin-sdk`.
- Его используют и adapter-плагины, и processor-плагины из `packages/plugins-*`.
- UI schema, device transport и boundary-валидация остаются вне этого пакета.
