# packages/plugins-ant-plus/src

Исходники ANT+ worker-плагинов.

## Для чего

- Здесь живут адаптеры и transport-слой для ANT+ интеграций.

## Как работает

- `ant-plus-adapter.ts`:
  - реализует scan/connect/disconnect lifecycle;
  - держит scan cache, state holder, reconnect timer и uniform emit через `plugin-kit`;
  - поднимает transport;
  - преобразует profile packets в `signal.batch`;
  - для live Moxy считает timestamps по реальной межпакетной дельте, а не по `measurementInterval` профиля;
  - публикует latest telemetry по качеству ANT+ канала для UI;
  - оценивает baseline cadence broadcast по живому потоку, чтобы не считать нормальные кадры пропусками;
  - автоматически переподключается по `detached` сигналу библиотеки и по watchdog'у тишины пакетов;
  - умеет `real` transport для Moxy через `ant-plus` и `fake` transport для локальной отладки.
- `ant-plus-profiles.ts`:
  - хранит профильный registry `muscle-oxygen` и `train-red`;
  - выбирает профиль по `formData.profile`, `candidateId` или `deviceType`;
  - описывает UI-метаданные scan-кандидатов и helper'ы для connect payload.
- `ant-plus-transport.ts`:
  - держит generic stick helpers;
  - изолирует ожидание `startup`/`shutdown` и безопасное закрытие stick;
  - не знает о streamId и профильном decode.
- `ant-plus-boundary.ts` изолирует внешний boundary:
  - env overrides;
  - formData -> transport requests;
  - raw driver state/page -> `AntTransportPacket`.
- `ant-plus-boundary.test.ts` отдельно проверяет эту нормализацию без поднятия runtime-плагина.
- `event-contracts.ts` описывает plugin-specific тик `ant-plus.packet.poll`.
- `index.ts` экспортирует plugin entrypoint.

## Взаимодействие

- На runtime event-уровне опирается на `packages/core`.
- Подключается в launch profiles из `apps/runtime/src/profiles/*`.
