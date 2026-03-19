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
- `ipc-worker` даёт общий transport/process-management helper для внешних compute-worker'ов:
  - `stdio` + binary framing;
  - protobuf envelope;
  - single-flight/latest-wins orchestration;
  - базовый Python runtime в `python-runtime/`.
- Для timeline-reset `v1` пакет даёт:
  - `createTimelineResetParticipant(...)` для локального lifecycle/resettable resources;
  - `clipSignalBatchToTimelineStart(...)` для clipping первого батча нового timeline.
- Практическое правило выбора reset-helper'ов:
  - processor'ы и derived adapters почти всегда должны быть `active reset participant`;
  - transport adapters с живым сокетом/радиоканалом чаще сохраняют persistent connection и чистят только timeline-local state;
  - если plugin после reset не должен ничего делать специально, это должно быть осознанное решение, а не «просто без hook'ов».
- `clipSignalBatchToTimelineStart(...)` нужен именно там, где transport нельзя безболезненно рвать ради reset:
  - high-rate TCP/BLE/serial streams;
  - raw frame sync, который дорого восстанавливать;
  - первый batch нового timeline может содержать старый prefix, который нужно отбросить без потери соединения.

## Взаимодействие

- Пакет зависит только от `@sensync2/core` и `@sensync2/plugin-sdk`.
- Его используют и adapter-плагины, и processor-плагины из `packages/plugins-*`.
- UI schema, device transport и boundary-валидация остаются вне этого пакета.
- Путь к Python worker или packaged sidecar резолвится вне пакета, через boundary приложения.
