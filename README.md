# sensync2

`sensync2` — новая кодовая база для event-driven обработки физиологических данных. Текущий `v1` собран вокруг Electron-приложения, в котором Node runtime, plugin workers и React renderer живут в одном desktop-процессе, но остаются разделёнными по контрактам.

## Что здесь есть

- `apps/runtime` — минимальное ядро: маршрутизация событий, очереди, plugin workers, lifecycle и telemetry.
- `apps/desktop` — Electron main process и IPC bridge между runtime и renderer.
- `apps/client` — schema-driven React UI, который получает control-сообщения и binary batches.
- `packages/core` — типы runtime-событий, plugin manifest, UI schema и binary UI wire.
- `packages/plugin-kit` — composable helper'ы для adapter и processor plugin'ов: lifecycle, input/output map, signal emit, scan flow, локальные store и handler composition.
- `packages/plugin-sdk` — API для plugin worker'ов.
- `packages/plugins-ant-plus` — ANT+ адаптеры и transport boundary для Moxy и будущих ANT+ профилей.
- `packages/plugins-ble` — BLE transport boundary и Zephyr BioHarness 3 адаптер.
- `packages/plugins-trigno` — TCP transport boundary и live-адаптер `Delsys Trigno`.
- `packages/plugins-fake` — synthetic demo-плагины и процессоры.
- `packages/plugins-labels` — generic label-generator плагины для interval/lactate и похожих сценариев.
- `packages/plugins-hdf5` — recorder-плагин и прямой simulation-адаптер для нового HDF5 формата.
- `packages/plugins-ui-gateway` — материализация runtime-событий в UI schema/control/binary поток.
- `packages/client-runtime` — буферы и browser-side runtime для графиков и флагов.

## Как запускать

```bash
npm install
npm run dev
```

Полезные команды:

- `npm run dev` — запускает desktop c профилем `fake`.
- `npm run dev:fake` — явный запуск fake-профиля.
- `npm run dev:fake-hdf5-simulation` — переходный профиль: fake-UI поверх `hdf5-simulation` источника.
- `npm run dev:pedaling-emg-test` — live-профиль для отдельного теста `Trigno EMG + Gyro` с записью raw-каналов в HDF5.
- `npm run dev:pedaling-emg-replay` — replay-профиль для HDF5-файла с raw `Trigno EMG + Gyro`; файл выбирается через UI при `connect`.
- `npm run dev:pedaling-emg-viewer` — viewer-профиль для интерактивного просмотра HDF5-файла с raw `Trigno EMG + Gyro`; файл выбирается через UI, данные загружаются целиком для панорамирования/зума графиков.
- `npm run dev:veloerg` — composite dev-профиль `veloerg` для ANT+/Moxy и BLE/Zephyr.
- `npm run dev:veloerg-replay` — replay-профиль для HDF5-файла из `veloerg`; файл выбирается через UI при `connect`.
- `npm run dev:veloerg-viewer` — viewer-профиль для интерактивного просмотра HDF5-файла из `veloerg`; файл выбирается через UI, графики открываются в history-режиме.
- `npm run dev:runtime` — runtime отдельно, по умолчанию в профиле `fake`.
- `npm run dev:runtime:fake-hdf5-simulation` — standalone runtime для fake simulation из HDF5.
- `npm run dev:runtime:pedaling-emg-test` — standalone runtime для отдельного live `EMG + Gyro` теста.
- `npm run dev:runtime:pedaling-emg-replay` — standalone runtime для replay raw `EMG + Gyro`.
- `npm run dev:runtime:pedaling-emg-viewer` — standalone runtime для интерактивного просмотра raw `EMG + Gyro`.
- `npm run dev:runtime:veloerg` — standalone runtime для composite `veloerg` профиля.
- `npm run dev:runtime:veloerg-replay` — standalone runtime для replay `veloerg` записи.
- `npm run dev:runtime:veloerg-viewer` — standalone runtime для интерактивного просмотра `veloerg` записи.
- `npm run build` — сборка всех workspace-пакетов.
- `npm run lint` — единый ESLint-прогон по monorepo.
- `npm run lint:fix` — автоисправления ESLint там, где они безопасны.
- `npm run test` — тесты по workspace'ам.
- `npm run coverage` — V8 coverage по workspace'ам. Отчёты пишутся в `coverage/` внутри каждого пакета.
- `npm run smoke` — все текущие smoke-сценарии одной командой.
- `npm run smoke:fake-profile` — smoke launch profile `fake`.
- `npm run smoke:hdf5-recorder` — smoke без UI для recorder-плагина.
- `npm run smoke:fake-hdf5-simulation` — smoke без UI для fake-ориентированной HDF5 simulation.
- `npm run verify` — полный верхнеуровневый прогон: `lint + test + build + smoke`.

## Launch profiles

Сейчас есть восемь штатных профиля запуска:

- `fake`
  - synthetic fake adapter с автостартом `fake-signal` после общего runtime-барьера `runtime.started`;
  - shape generator;
  - generic label generator c `interval.label`;
  - demo processors;
  - `hdf5-recorder`;
  - `ui-gateway` с fake-схемой.
- `fake-hdf5-simulation`
  - `hdf5-simulation-adapter`, но только для fake-каналов;
  - `ui-gateway` с отдельной fake-oriented simulation-схемой.
- `veloerg`
  - `ant-plus-adapter` по умолчанию идёт через real transport поверх `ant-plus`;
  - `zephyr-bioharness-3-adapter` по умолчанию идёт через real transport поверх `@abandonware/noble`;
  - `trigno-adapter` по умолчанию идёт через real TCP transport поверх `node:net`;
  - для `Trigno` профиль сейчас фиксирует `BACKWARDS COMPATIBILITY = OFF` и `UPSAMPLE = OFF`, чтобы live `EMG` и `Gyro` шли в нативной для SDK ports схеме;
  - Moxy публикует `moxy.smo2` и `moxy.thb`, Zephyr даёт live `RR`, Trigno в `v1` публикует raw `EMG + Gyroscope`, а generic `label-generator` добавляет sparse-stream'ы `lactate.label` и `power.label`;
  - `pedaling-emg-processor` сейчас намеренно отключён именно в этом профиле из-за live `mailbox_overflow`; для него остаются отдельные профили `pedaling-emg-test` и `pedaling-emg-replay`;
  - `ui-gateway` поднимает composite-схему live-подключения Moxy, Zephyr и Trigno;
  - fake transport остаётся доступен для локальной отладки.
- `veloerg-replay`
  - `hdf5-simulation-adapter` читает HDF5 файл, выбранный через UI при `connect`;
  - replay ограничен stream'ами `moxy.*`, `zephyr.*`, raw `trigno.*` и sparse `lactate/power`, чтобы повторять контракт записи `veloerg`;
  - `ui-gateway` поднимает отдельную replay-схему без live connect/recording controls.
- `veloerg-viewer`
  - `hdf5-viewer-adapter` читает HDF5 файл, выбранный через UI при `connect`;
  - viewer загружает историю целиком, а не воспроизводит её по таймеру;
  - `ui-gateway` поднимает схему, где те же графики работают в интерактивном history-режиме.
- `pedaling-emg-test`
  - отдельный live-профиль только для `Trigno`;
  - поднимает raw `EMG + Gyroscope`, `pedaling-emg-processor`, recorder и UI;
  - запись пишет только raw `Trigno`-каналы в `recordings/pedaling-emg-test`.
- `pedaling-emg-replay`
  - replay-профиль для тех же raw `Trigno`-каналов из HDF5;
  - файл выбирается через UI при `adapter.connect.request`, а не через env;
  - поднимает `hdf5-simulation-adapter`, `pedaling-emg-processor` и отдельную replay-схему UI.
- `pedaling-emg-viewer`
  - viewer-профиль для тех же raw `Trigno`-каналов из HDF5;
  - файл выбирается через UI при `adapter.connect.request`, а не через env;
  - поднимает `hdf5-viewer-adapter`, `pedaling-emg-processor` и отдельную viewer-схему UI.

Профиль выбирается через `SENSYNC2_PROFILE`, а npm-скрипты просто подставляют это значение явно.

Для `fake-hdf5-simulation` нужно отдельно задать путь к файлу:

```bash
SENSYNC2_HDF5_SIMULATION_FILE=/absolute/path/to/file.h5 npm run dev:fake-hdf5-simulation
```

Допускается и относительный путь: он будет резолвиться от корня репозитория `sensync2`, а не от `apps/desktop`.

Это осознанно: профиль не должен подменять реальный источник скрытым demo-файлом.

Для `pedaling-emg-replay` отдельный env не нужен: после запуска профиля файл выбирается в UI через кнопку подключения replay.

Для `veloerg-replay` отдельный env тоже не нужен: после запуска профиля файл выбирается в UI через кнопку подключения replay.

Для `pedaling-emg-viewer` и `veloerg-viewer` отдельный env тоже не нужен: после запуска профиля файл выбирается в UI через кнопку открытия viewer.

Для `veloerg` можно отдельно включить fake transport и проверить UX ветку "stick не найден":

```bash
SENSYNC2_ANT_PLUS_MODE=fake SENSYNC2_ANT_PLUS_STICK_PRESENT=0 npm run dev:veloerg
```

Для Zephyr в том же профиле можно отдельно включить fake BLE transport:

```bash
SENSYNC2_ZEPHYR_BIOHARNESS_MODE=fake npm run dev:veloerg
```

Для Trigno host/slot задаются уже из modal form в UI, а не через launch profile.

## Как устроена документация

- У каждого рабочего модуля есть свой `README.md`.
- Перед работой в подпапке нужно читать ближайший `README.md`.
- Если поведение папки меняется, её `README.md` должен меняться вместе с кодом.

Индекс модулей:

- [apps/README.md](apps/README.md)
- [packages/README.md](packages/README.md)
- [scripts/README.md](scripts/README.md)

Ключевые спецификации:

- [packages/core/CONTRACTS.md](packages/core/CONTRACTS.md)
- [BOUNDARIES.md](BOUNDARIES.md)
- [packages/plugins-hdf5/HDF5_FORMAT.md](packages/plugins-hdf5/HDF5_FORMAT.md)
- [packages/plugins-ui-gateway/SCHEMA.md](packages/plugins-ui-gateway/SCHEMA.md)

## Текущий статус `v1`

- Дефолтный dev-профиль — `fake`, потому что он быстрее проверяет runtime, UI и recorder без привязки к конкретному тестовому файлу.
- Отдельный профиль `fake-hdf5-simulation` проигрывает уже записанные fake-каналы напрямую из нового HDF5 формата и не использует replay bundle.
- Профиль `veloerg` уже пытается работать с реальным ANT+ stick и BLE Zephyr, а fake mode остаётся только как диагностический fallback для каждого transport-слоя.
- UI пока строится не из shared memory, а из `JSON control + binary frames` поверх Electron IPC.
- Система уже опирается на относительное время сессии (`session time`), а не на wall-clock как источник истины для data-path.
