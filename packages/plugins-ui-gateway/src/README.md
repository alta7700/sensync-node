# packages/plugins-ui-gateway/src

Исходники `ui-gateway` плагина.

## Для чего

- Реализуют профильные demo-схемы UI и поток для renderer.

## Как работает

- `ui-gateway-plugin.ts`:
  - получает готовую `UiSchema` из launch profile;
  - следит за stream registry и numeric IDs;
  - обновляет flags, включая declarative `derivedFlags` из `UiSchema`;
  - materialize'ит file-level viewer metadata из `viewer.state.changed` в обычные `viewer.<adapterId>.metadata.*` flags;
  - materialize'ит dynamic options для локальных форм;
  - переводит shared `command.rejected` в `ui.warning`;
  - кодирует `signal.batch` в binary UI frames;
  - отправляет `ui.init`, patch-сообщения и telemetry;
  - при `recording.state.changed` пишет короткий диагностический лог в stdout, чтобы можно было сопоставить stop-flow и применённый `ui.flags.patch`;
  - для replay умеет локально делать `ui.timeline.reset` по `recordingStartSessionMs`, не трогая данные потока.
  - для viewer умеет локально сбрасывать timeline/buffers при подключении и отключении файла, чтобы history-данные не смешивались между сессиями просмотра.
- `profile-schemas.ts`:
  - хранит concrete demo-схемы `fake`, `fake-hdf5-simulation`, `veloerg`, `veloerg-replay`, `veloerg-viewer`, `veloerg-final-viewer` и `pedaling-emg-*`;
  - экспортирует schema builders, которые вызывают runtime profile-модули.
- ANT+ часть схемы теперь описывает профильный connect flow:
  - `muscle-oxygen`;
  - `train.red`;
  - оба варианта используют одинаковые графики и raw streamId, но разные scan/connect entry point'ы и подписи.
- Control schema может задавать `commandVersion` / `submitEventVersion`; если они не указаны, renderer использует `v=1`.
- Control schema теперь также может задавать `payloadBindings`, а modal forms — `submitTarget` и `timelineTimeInput`, чтобы собирать top-level payload без runtime-specific UI-хаков.
- Для `fake-hdf5-simulation` схема отдельная: по графикам она совместима с fake-демо, но управляющие кнопки уже относятся к simulation-источнику.
- Для `fake` схема больше не рисует connect/disconnect для `fake-signal-adapter`: live source поднимается автоматически, manual-control остаётся только у `shapes`.
- Interval toggle в `fake` теперь отправляет generic `label.mark.request`, а не interval-specific команды.
- Для `veloerg` схема composite: отдельный Trigno control-блок с парной формой `host + vlSensorSlot + rfSensorSlot`, отдельный блок `power`, summary-строка с живыми метриками, четыре raw-графика `VL/RF EMG/Gyroscope`, ступенчатый `Power` и scan/connect/disconnect для Moxy и Zephyr.
- Для `veloerg-replay` схема повторяет графики `veloerg`, но заменяет live-control блоки одним replay-control виджетом `HDF5 replay` и исходит из строгого набора потоков `trigno.vl.avanti*` / `trigno.rf.avanti*`.
- Для `veloerg-final-viewer` схема тоже повторяет `veloerg-replay`, но убирает старый `moxy.thb`, добавляет отдельный статус-блок с metadata файла, отдельный статус-блок `LT2`, один filtered-график `train.red.smo2 + train.red.hbdiff`, отдельный график для всех `*.unfiltered` stream'ов и новый график `lactate`.
- Для `veloerg-final-viewer` все графики также получают два vertical marker'а: stop-line по `viewer.<adapterId>.metadata.stop_time_sec` с подписью из `stop_time` и `LT2`-line по `viewer.<adapterId>.metadata.lt2_refined_time_sec`.
- Для viewer-профилей схема использует те же наборы графиков, но ставит `viewportMode = history`, чтобы renderer включал data-zoom и панорамирование.

## Взаимодействие

- Получает события из runtime как обычный плагин.
- Отдаёт наружу только UI-формат, а не внутренние runtime-события.
- Concrete-схемы текущих профилей описаны в [packages/plugins-ui-gateway/SCHEMA.md](../SCHEMA.md), а в runtime подключаются через `apps/runtime/src/profiles/README.md`.
