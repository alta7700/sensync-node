# apps/runtime

Node runtime и хост plugin worker'ов.

## Для чего

- Это минимальное ядро системы:
  - назначает глобальные `seq`;
  - маршрутизирует события по подпискам;
  - держит очереди плагинов;
  - собирает telemetry;
  - управляет lifecycle worker'ов.

## Как работает

- `RuntimeHost` поднимает плагины из `PluginDescriptor[]`.
- Каждый плагин живёт в отдельном `worker_threads` worker'е через `PluginHost`.
- В `v1` fan-out `signal.batch` при необходимости копирует буферы, а не использует shared memory внутри runtime.
- Перед публикацией событие проходит через workspace event registry:
  - `(type, v)` должен быть зарегистрирован;
  - `kind/priority` должны совпадать с контрактом;
  - plugin `emit` должен быть объявлен в `manifest.emits`.
- Неизвестные или запрещённые события не маршрутизируются и materialize'ятся в `ui.warning`.
- UI ingress сначала проходит через exact typed `UiCommandMessage` + boundary guards, а затем через helper `uiCommandMessageToRuntimeEventInput(...)` превращается во внутренний `RuntimeEventInput`.
- `timeline.reset.request` — исключение: команда валидируется тем же ingress, но перехватывается `RuntimeHost` до `publish()` и запускает двухфазный reset coordinator.
- Env/file boundary launch profiles теперь вынесен в `apps/runtime/src/launch-profile-boundary.ts`, а source of truth по профилям лежит в `apps/runtime/src/profiles/README.md` и соседних profile-модулях.
- Если adapter-worker падает, а в `PluginDescriptor.config` есть `adapterId`, runtime синтетически публикует `adapter.state.changed = failed`, чтобы UI не оставался с устаревшим состоянием подключения.
- `apps/runtime/src/profiles/README.md` и отдельные profile-модули задают launch profiles:
  - `fake`;
  - `fake-hdf5-simulation`;
  - `veloerg`;
  - `veloerg-replay`;
  - `pedaling-emg-test`;
  - `pedaling-emg-replay`.
- Профиль выбирается через `SENSYNC2_PROFILE`; если значение не задано, runtime поднимает `fake`.
- В `fake`-профиле `fake-signal-adapter` сам переходит в `connected` только после общего system-event `runtime.started`, `shape-generator-adapter` остаётся manual, а `interval.label` теперь публикует generic `label-generator-adapter`.
- В `fake`-профиле также включён profile-level `timeline reset` без reconnect transport'ов: coordinator синхронизирует новый `timelineId` на все worker'ы, а profile `participants` задают subset плагинов, для которых профиль явно описывает reset-lifecycle/policy.
- Профиль `fake-hdf5-simulation` требует `SENSYNC2_HDF5_SIMULATION_FILE`; путь валидируется до старта worker'ов.
- Профиль `pedaling-emg-test` поднимает только `Trigno EMG + Gyroscope`, `pedaling-emg-processor`, recorder и UI для отдельного цикла записи сырых данных.
- Профиль `pedaling-emg-replay` поднимает HDF5 replay того же сырого `Trigno EMG + Gyroscope` набора; файл выбирается через `adapter.connect.request.formData.filePath`, а не через env.
- Профиль `veloerg-replay` поднимает HDF5 replay записей `veloerg`; файл тоже выбирается через `adapter.connect.request.formData.filePath`, а не через env.
- Профиль `veloerg` поднимает `ant-plus-adapter`, `zephyr-bioharness-3-adapter`, generic `hr-from-rr-processor`, `dfa-a1-from-rr-processor`, generic `label-generator-adapter`, `trigno-adapter` и `hdf5-recorder` в real mode по умолчанию.
- `hr-from-rr-processor` и `dfa-a1-from-rr-processor` не знают про Zephyr как устройство: профиль только связывает `zephyr.rr` как вход и derived output streams.
- `pedaling-emg-processor` пока исключён именно из `veloerg`, потому что при live-нагрузке он переполнял mailbox; сам пакет остаётся для специализированных профилей `pedaling-emg-test` и `pedaling-emg-replay`.
- Для Trigno в `veloerg` runtime явно задаёт `BACKWARDS COMPATIBILITY = OFF` и `UPSAMPLE = OFF`, чтобы live `EMG` не уходил в legacy-совместимую частотную схему SDK ports.
- В `veloerg` timeline reset теперь recorder-driven:
  - requester только `hdf5-recorder`;
  - `recording.start` сначала делает runtime preflight, затем при необходимости инициирует reset и открывает файл только после глобального success-result этого reset;
  - `recording.stop` закрывает файл сразу и затем один раз пытается выполнить best-effort reset;
  - любой активный writer блокирует ручной/внешний reset.
- Для Trigno runtime агрегирует plugin-specific UI boundary guards отдельно от shared `core`, чтобы `START/STOP/refresh` проходили тот же exact-typed ingress, что и shared команды.
- Fake transport остаётся fallback только у ANT+ и BLE; Trigno в `v1` работает как real-only интеграция.
- Если путь относительный, runtime резолвит его от корня репозитория `sensync2`.

## Взаимодействие

- Использует `@sensync2/core`, `@sensync2/plugin-sdk`, `@sensync2/plugins-ant-plus`, `@sensync2/plugins-ble`, `@sensync2/plugins-trigno`, `@sensync2/plugins-fake`, `@sensync2/plugins-hdf5`, `@sensync2/plugins-labels`, `@sensync2/plugins-processor-hr-from-rr`, `@sensync2/plugins-processor-dfa-a1`, `@sensync2/plugins-processor-pedaling-emg`, `@sensync2/plugins-ui-gateway`.
- В `fake`-профиле поднимает recorder, в `fake-hdf5-simulation` — HDF5-источник с fake-каналами, в `pedaling-emg-test` — live `Trigno EMG + Gyroscope` с записью raw-каналов, в `pedaling-emg-replay` — replay тех же raw-каналов из HDF5, в `veloerg-replay` — replay composite `veloerg` записи, а в `veloerg` — live-сценарий ANT+/Moxy, BLE/Zephyr, derived HR-from-RR, sparse `lactate/power` и TCP/Trigno.
- Для live записи `veloerg` пишет HDF5 в repo-relative `recordings/veloerg`.
- Может стартовать отдельно для отладки или через `apps/desktop`.
