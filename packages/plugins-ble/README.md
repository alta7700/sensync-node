# packages/plugins-ble

BLE worker-плагины и внутренний transport-слой для BLE-устройств.

## Для чего

- Содержит runtime-плагины для BLE-устройств.
- Держит boundary к `@abandonware/noble` отдельно от UI, runtime host и shared-контрактов.
- Начинает с `Zephyr BioHarness 3`, но оставляет внутри пакета переиспользуемый слой для следующих BLE-адаптеров.

## Как работает

- В `v1` пакет экспортирует plugin-specific event-контракты и первый entrypoint `zephyr-bioharness-3-adapter`.
- Внутри пакета transport разложен на:
  - `ble-boundary.ts` для env/config и lazy-load `noble`;
  - `ble-central.ts` для `real`/`fake` BLE central lifecycle;
  - `zephyr-protocol.ts` для UUID, handshake и разбора пакетов Zephyr.
- Адаптер работает через shared `adapter.scan.*`, `adapter.state.changed` и `signal.batch`, не вводя отдельный BLE bus-слой.
- Lifecycle, scan cache, reconnect timer и irregular emit адаптера теперь собраны на `@sensync2/adapter-kit`.
- В real scan `v1` пакет больше не режет список только по `localName`: в UI попадают все найденные BLE-кандидаты, а Zephyr-похожие устройства поднимаются выше по score.
- Для Zephyr `RR` публикуется как отдельный поток `zephyr.rr`, поэтому его можно сразу рисовать в общих live-графиках и писать дальше в downstream pipeline.

## Взаимодействие

- Использует `@sensync2/adapter-kit`, `@sensync2/core`, `@sensync2/plugin-sdk` и `@abandonware/noble`.
- Поднимается из `apps/runtime` как обычный worker-плагин рядом с ANT+ адаптером в профиле `veloerg`.
- UI-flow materialize'ит `packages/plugins-ui-gateway`.

Полезные env-переменные:

- `SENSYNC2_ZEPHYR_BIOHARNESS_MODE=fake` — переключает адаптер в fake transport.
- `SENSYNC2_ZEPHYR_BIOHARNESS_SCAN_TIMEOUT_MS=5000` — меняет длительность BLE scan.
- `SENSYNC2_ZEPHYR_BIOHARNESS_AUTO_RECONNECT=0` — отключает автоматическое переподключение.
- `SENSYNC2_ZEPHYR_BIOHARNESS_RECONNECT_RETRY_DELAY_MS=1500` — меняет паузу между попытками reconnect.
- `SENSYNC2_ZEPHYR_BIOHARNESS_LOG_BLE=1` — включает подробные debug-логи scan/connect/GATT discovery и BLE notifications.
