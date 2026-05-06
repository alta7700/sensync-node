# packages/plugins-ui-gateway

UI gateway plugin.

## Для чего

- Это отдельный плагин-материализатор, который превращает внутренние runtime-события в UI-ориентированный поток.
- Здесь сосредоточена логика схемы UI, флагов, описания stream'ов и бинарного data wire.

## Как работает

- Плагин подписывается на `signal.batch`, adapter state, recorder state, simulation state, telemetry и другие факты.
- Он собирает `UiSchema`, flags snapshot/patches, dynamic form options и выдаёт binary batches с numeric stream IDs.
- Materialized декларации потоков и live-обновления опираются на канонический `streamId`; для scan-форм select-поля по-прежнему мерджат opaque payload выбранного кандидата.
- При изменении состояния записи `ui-gateway` пишет короткий диагностический лог в stdout, чтобы можно было сопоставить `recording.*` события и `ui.flags.patch`.
- В fake-профиле manual connect для `fake-signal-adapter` больше не показывается: источник автостартует сам, а UI управляет только `shapes`, interval и recording.
- При подключении UI-клиента отправляет `ui.init` и текущий снимок состояния.
- `ui.init.clock` теперь несёт `timelineId` и `timelineStartSessionMs`.
- В materialized control-потоке теперь различаются `ui.warning` и `ui.error`.
- Shared fact `command.rejected` materialize'ится в `ui.warning`, чтобы мягкие отказы UI-команд не выглядели как немой no-op.
- Для fake interval control `interval.active` больше не приходит отдельным runtime fact: `ui-gateway` materialize'ит его по declarative `schema.derivedFlags`, а не по жёсткому special-case в коде.
- Во время timeline reset `ui-gateway` выпускает `ui.timeline.reset`, пересобирает derived flags в initial defaults и не рвёт schema/stream registry.
- Для HDF5 replay `ui-gateway` также умеет локально сдвигать UI timeline origin по `simulation.state.changed.recordingStartSessionMs`, не переписывая stream timestamps.
- Для HDF5 viewer `ui-gateway` тоже умеет локально сбрасывать UI timeline/buffers по `viewer.state.changed`, чтобы новый файл целиком заменял предыдущую историю.
- Viewer metadata из `viewer.state.changed.metadata` `ui-gateway` materialize'ит в обычные flags `viewer.<adapterId>.metadata.*`, чтобы schema могла использовать их без отдельного special-case в renderer.
- Concrete `UiSchema` теперь строится вне плагина в runtime launch profile и передаётся в `ui-gateway` уже готовой.
- В `veloerg` схема теперь composite:
  - отдельный control-блок Trigno с modal form `host + vlSensorSlot + rfSensorSlot`;
  - явный layout с левой колонкой control-виджетов и отдельной правой панелью статуса;
  - отдельный control-блок для `power`;
  - summary-строка между controls и графиками с текущим временем теста и живыми метриками;
  - четыре raw-графика `VL EMG`, `VL Gyroscope`, `RF EMG`, `RF Gyroscope` без pedaling-derived overlays;
  - ступенчатый график `Power`;
  - рядом остаются Moxy (`SmO2`, `tHb`) и Zephyr (`RR`).
- ANT+ блок уже разбит на профильный connect flow: `muscle-oxygen` и `train.red` используют один raw decode и те же streamId, но различаются на уровне scan/connect entry point и UI-подписи.
- В `veloerg-replay` схема использует те же графики `veloerg`, но вместо live transport/recording controls даёт один replay-control блок для выбора HDF5, pause/resume и смены скорости; старые single-sensor `veloerg`-файлы под эту схему больше не подходят.
- В `veloerg-viewer`, `veloerg-final-viewer` и `pedaling-emg-viewer` схема использует те же графики соответствующих replay/live профилей, но переводит их в history-режим для интерактивного pan/zoom без simulation cadence.
- В `veloerg-final-viewer` старый `moxy.thb` намеренно отсутствует: вместо него схема показывает отдельный status-блок с metadata файла, отдельный status-блок `LT2`, filtered-график `train.red.smo2 + train.red.hbdiff`, второй график со всеми `train.red.*.unfiltered`, график `lactate` и две пунктирные vertical-линии на всех chart-виджетах: stop-line по `stop_time_sec` и `LT2`-line по `lt2_refined_time_sec`.
- `ui.telemetry` теперь несёт не только runtime queue snapshot, но и latest plugin metrics, например качество ANT+ канала и BLE/Zephyr transport.

## Взаимодействие

- Использует только публичные контракты `packages/core` и `packages/plugin-sdk`.
- Его output читает `packages/client-runtime`, а transport до renderer доставляет `apps/desktop`.

Дополнительно:

- Concrete-схемы профилей описаны в [packages/plugins-ui-gateway/SCHEMA.md](SCHEMA.md).
