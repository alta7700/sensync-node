# packages/plugins-ui-gateway/src

Исходники `ui-gateway` плагина.

## Для чего

- Реализуют профильные demo-схемы UI и поток для renderer.

## Как работает

- `ui-gateway-plugin.ts`:
  - выбирает concrete `UiSchema` по профилю запуска;
  - описывает explicit `UiPage.layout` там, где простых `widgetRows` уже недостаточно;
  - следит за stream registry и numeric IDs;
  - обновляет flags;
  - materialize'ит dynamic options для локальных форм;
  - кодирует `signal.batch` в binary UI frames;
  - отправляет `ui.init`, patch-сообщения и telemetry.
- Control schema может задавать `commandVersion` / `submitEventVersion`; если они не указаны, renderer использует `v=1`.
- Для `fake-hdf5-simulation` схема отдельная: по графикам она совместима с fake-демо, но управляющие кнопки уже относятся к simulation-источнику.
- Для `fake` схема больше не рисует connect/disconnect для `fake-signal-adapter`: live source поднимается автоматически, manual-control остаётся только у `shapes`.
- Для `veloerg` схема composite: отдельный Trigno control-блок и графики `EMG/Gyroscope`, плюс scan/connect/disconnect для Moxy и Zephyr.

## Взаимодействие

- Получает события из runtime как обычный плагин.
- Отдаёт наружу только UI-формат, а не внутренние runtime-события.
- Concrete-схемы текущих профилей описаны в [packages/plugins-ui-gateway/SCHEMA.md](../SCHEMA.md).
