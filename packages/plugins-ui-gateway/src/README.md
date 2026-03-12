# packages/plugins-ui-gateway/src

Исходники `ui-gateway` плагина.

## Для чего

- Реализуют профильные demo-схемы UI и поток для renderer.

## Как работает

- `ui-gateway-plugin.ts`:
  - выбирает concrete `UiSchema` по профилю запуска;
  - следит за stream registry и numeric IDs;
  - обновляет flags;
  - materialize'ит dynamic options для локальных форм;
  - кодирует `signal.batch` в binary UI frames;
  - отправляет `ui.init`, patch-сообщения и telemetry.
- Для `fake-hdf5-simulation` схема отдельная: по графикам она совместима с fake-демо, но управляющие кнопки уже относятся к simulation-источнику.
- Для `veloerg` схема минимальна: scan/connect/disconnect Moxy, live charts и toast/error flow.

## Взаимодействие

- Получает события из runtime как обычный плагин.
- Отдаёт наружу только UI-формат, а не внутренние runtime-события.
- Concrete-схемы текущих профилей описаны в [packages/plugins-ui-gateway/SCHEMA.md](../SCHEMA.md).
