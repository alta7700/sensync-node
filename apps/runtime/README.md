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
- Env/file boundary launch profiles теперь вынесен в `apps/runtime/src/launch-profile-boundary.ts`, а source of truth по профилям лежит в `apps/runtime/src/profiles/README.md` и соседних profile-модулях.
- Если adapter-worker падает, а в `PluginDescriptor.config` есть `adapterId`, runtime синтетически публикует `adapter.state.changed = failed`, чтобы UI не оставался с устаревшим состоянием подключения.
- `apps/runtime/src/profiles/README.md` и отдельные profile-модули задают launch profiles:
  - `fake`;
  - `fake-hdf5-simulation`;
  - `veloerg`.
- Профиль выбирается через `SENSYNC2_PROFILE`; если значение не задано, runtime поднимает `fake`.
- В `fake`-профиле `fake-signal-adapter` сам переходит в `connected` только после общего system-event `runtime.started`, а `shape-generator-adapter` остаётся manual.
- Профиль `fake-hdf5-simulation` требует `SENSYNC2_HDF5_SIMULATION_FILE`; путь валидируется до старта worker'ов.
- Профиль `veloerg` поднимает `ant-plus-adapter`, `zephyr-bioharness-3-adapter` и `trigno-adapter` в real mode по умолчанию.
- Для Trigno в `veloerg` runtime явно задаёт `BACKWARDS COMPATIBILITY = OFF` и `UPSAMPLE = OFF`, чтобы live `EMG` не уходил в legacy-совместимую частотную схему SDK ports.
- Для Trigno runtime агрегирует plugin-specific UI boundary guards отдельно от shared `core`, чтобы `START/STOP/refresh` проходили тот же exact-typed ingress, что и shared команды.
- Fake transport остаётся fallback только у ANT+ и BLE; Trigno в `v1` работает как real-only интеграция.
- Если путь относительный, runtime резолвит его от корня репозитория `sensync2`.

## Взаимодействие

- Использует `@sensync2/core`, `@sensync2/plugin-sdk`, `@sensync2/plugins-ant-plus`, `@sensync2/plugins-ble`, `@sensync2/plugins-trigno`, `@sensync2/plugins-fake`, `@sensync2/plugins-hdf5`, `@sensync2/plugins-ui-gateway`.
- В `fake`-профиле поднимает recorder, в `fake-hdf5-simulation` — HDF5-источник с fake-каналами, а в `veloerg` — composite-сценарий ANT+/Moxy, BLE/Zephyr и TCP/Trigno.
- Может стартовать отдельно для отладки или через `apps/desktop`.
