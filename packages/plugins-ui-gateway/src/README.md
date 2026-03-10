# packages/plugins-ui-gateway/src

Исходники `ui-gateway` плагина.

## Для чего

- Реализуют текущую схему demo-UI и поток для renderer.

## Как работает

- `ui-gateway-plugin.ts`:
  - объявляет базовую `UiSchema`;
  - следит за stream registry и numeric IDs;
  - обновляет flags;
  - кодирует `signal.batch` в binary UI frames;
  - отправляет `ui.init`, patch-сообщения и telemetry.

## Взаимодействие

- Получает события из runtime как обычный плагин.
- Отдаёт наружу только UI-формат, а не внутренние runtime-события.
- Concrete-схема текущего demo UI описана в [packages/plugins-ui-gateway/SCHEMA.md](../SCHEMA.md).
