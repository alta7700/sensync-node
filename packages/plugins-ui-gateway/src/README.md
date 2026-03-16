# packages/plugins-ui-gateway/src

Исходники `ui-gateway` плагина.

## Для чего

- Реализуют профильные demo-схемы UI и поток для renderer.

## Как работает

- `ui-gateway-plugin.ts`:
  - получает готовую `UiSchema` из launch profile;
  - следит за stream registry и numeric IDs;
  - обновляет flags, включая declarative `derivedFlags` из `UiSchema`;
  - materialize'ит dynamic options для локальных форм;
  - переводит shared `command.rejected` в `ui.warning`;
  - кодирует `signal.batch` в binary UI frames;
  - отправляет `ui.init`, patch-сообщения и telemetry.
- `profile-schemas.ts`:
  - хранит concrete demo-схемы `fake`, `fake-hdf5-simulation` и `veloerg`;
  - экспортирует schema builders, которые вызывают runtime profile-модули.
- Control schema может задавать `commandVersion` / `submitEventVersion`; если они не указаны, renderer использует `v=1`.
- Для `fake-hdf5-simulation` схема отдельная: по графикам она совместима с fake-демо, но управляющие кнопки уже относятся к simulation-источнику.
- Для `fake` схема больше не рисует connect/disconnect для `fake-signal-adapter`: live source поднимается автоматически, manual-control остаётся только у `shapes`.
- Interval toggle в `fake` теперь отправляет generic `label.mark.request`, а не interval-specific команды.
- Для `veloerg` схема composite: отдельный Trigno control-блок и графики `EMG/Gyroscope`, плюс scan/connect/disconnect для Moxy и Zephyr.

## Взаимодействие

- Получает события из runtime как обычный плагин.
- Отдаёт наружу только UI-формат, а не внутренние runtime-события.
- Concrete-схемы текущих профилей описаны в [packages/plugins-ui-gateway/SCHEMA.md](../SCHEMA.md), а в runtime подключаются через `apps/runtime/src/profiles/README.md`.
