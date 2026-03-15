# packages/plugins-ble/src

Исходники BLE worker-плагинов.

## Для чего

- Здесь живут BLE-адаптеры, transport-обёртки и device-specific protocol-слой.

## Как работает

- `zephyr-bioharness-3-adapter.ts`:
  - реализует scan/connect/disconnect lifecycle;
  - держит opaque `candidateId` cache, state holder, reconnect timer и irregular emit через `adapter-kit`;
  - управляет reconnect и watchdog по тишине notifications;
  - публикует shared adapter-события, `signal.batch` для `zephyr.rr` и telemetry.
- `ble-boundary.ts` изолирует внешний boundary:
  - env overrides;
  - formData -> transport requests;
  - lazy-load `@abandonware/noble`;
  - нормализацию BLE/OS ошибок;
  - score/diagnostic mapping advertisement данных в scan candidates;
  - debug helper'ы для подробного логирования BLE discovery и packet preview.
- `ble-central.ts` держит `real`/`fake` BLE central transport.
- `zephyr-protocol.ts` фиксирует UUID, команды и парсинг Zephyr-пакетов.
- `event-contracts.ts` описывает plugin-specific тик polling/watchdog.

## Взаимодействие

- На runtime event-уровне пакет опирается на `packages/core`.
- Подключается в launch profiles из `apps/runtime/src/default-plugins.ts`.
- Для отладки real BLE path поддерживает `SENSYNC2_ZEPHYR_BIOHARNESS_LOG_BLE=1`, чтобы печатать discovery/connect и packet debug-логи.
