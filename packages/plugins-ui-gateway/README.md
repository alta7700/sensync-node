# packages/plugins-ui-gateway

UI gateway plugin.

## Для чего

- Это отдельный плагин-материализатор, который превращает внутренние runtime-события в UI-ориентированный поток.
- Здесь сосредоточена логика схемы UI, флагов, описания stream'ов и бинарного data wire.

## Как работает

- Плагин подписывается на `signal.batch`, adapter state, recorder state, simulation state, telemetry и другие факты.
- Он собирает `UiSchema`, flags snapshot/patches, dynamic form options и выдаёт binary batches с numeric stream IDs.
- Materialized декларации потоков и live-обновления опираются на канонический `streamId`; для scan-форм select-поля по-прежнему мерджат opaque payload выбранного кандидата.
- В fake-профиле manual connect для `fake-signal-adapter` больше не показывается: источник автостартует сам, а UI управляет только `shapes`, interval и recording.
- При подключении UI-клиента отправляет `ui.init` и текущий снимок состояния.
- `ui.init.clock` теперь несёт `timelineId` и `timelineStartSessionMs`.
- В materialized control-потоке теперь различаются `ui.warning` и `ui.error`.
- Shared fact `command.rejected` materialize'ится в `ui.warning`, чтобы мягкие отказы UI-команд не выглядели как немой no-op.
- Для fake interval control `interval.active` больше не приходит отдельным runtime fact: `ui-gateway` materialize'ит его по declarative `schema.derivedFlags`, а не по жёсткому special-case в коде.
- Во время timeline reset `ui-gateway` выпускает `ui.timeline.reset`, пересобирает derived flags в initial defaults и не рвёт schema/stream registry.
- Concrete `UiSchema` теперь строится вне плагина в runtime launch profile и передаётся в `ui-gateway` уже готовой.
- В `veloerg` схема теперь composite:
  - отдельный control-блок Trigno с modal form `host + sensorSlot`;
  - явный layout с левой колонкой control-виджетов и отдельной правой панелью статуса;
  - live-графики `EMG` и `Gyroscope`;
  - рядом остаются Moxy (`SmO2`, `tHb`) и Zephyr (`RR`).
- `ui.telemetry` теперь несёт не только runtime queue snapshot, но и latest plugin metrics, например качество ANT+ канала и BLE/Zephyr transport.

## Взаимодействие

- Использует только публичные контракты `packages/core` и `packages/plugin-sdk`.
- Его output читает `packages/client-runtime`, а transport до renderer доставляет `apps/desktop`.

Дополнительно:

- Concrete-схемы профилей описаны в [packages/plugins-ui-gateway/SCHEMA.md](SCHEMA.md).
