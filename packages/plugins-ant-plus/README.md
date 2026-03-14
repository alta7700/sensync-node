# packages/plugins-ant-plus

ANT+ plugin worker'ы и transport-обёртки.

## Для чего

- Содержит runtime-плагины для ANT+ устройств.
- Держит transport boundary к USB stick отдельно от UI и core-контрактов.
- Начинает с `Muscle Oxygen`/Moxy сценария, но архитектурно готов к другим ANT+ профилям.

## Как работает

- В `v1` пакет экспортирует `ant-plus-adapter`.
- Внутри адаптера есть transport-абстракция:
  - `real` transport поверх библиотеки `ant-plus` для USB ANT+ stick;
  - `fake` transport для scan/connect/data flow без железа.
- Внешние ingress-границы вынесены в `src/ant-plus-boundary.ts`, чтобы env/formData/raw driver packets нормализовались до входа в runtime-логику адаптера.
- В live-режиме таймлайн Moxy строится от первого пакета по реальной межпакетной дельте хоста.
- Для `real` transport callback-очередь вычитывается коротким poll-интервалом, чтобы не собирать burst'ы по UI.
- `measurementInterval` из ANT+ профиля сохраняется как диагностический сигнал и не считается надёжным источником времени для графика.
- Адаптер публикует plugin metrics по качеству ANT+ канала: broadcast delta, gap count, max gap и diagnostic profile field.
- Внутренний poll-тик адаптера зарегистрирован рядом в `src/event-contracts.ts`.
- Диагностика gap'ов опирается на наблюдаемый cadence broadcast, а не на фиксированное предположение о частоте ANT+ кадров.
- При разрыве адаптер использует гибридную стратегию: сигнал `detached` из библиотеки плюс watchdog по тишине пакетов.
- Watchdog сейчас использует простую эвристику `10n + 5s`, где `n` — оценка обычного broadcast cadence.
- Адаптер публикует:
  - `adapter.scan.*`;
  - `adapter.state.changed`;
  - `signal.batch` для `moxy.smo2` и `moxy.thb`.

## Взаимодействие

- Использует только `@sensync2/core` и `@sensync2/plugin-sdk`.
- Поднимается из `apps/runtime` как обычный worker-плагин.
- UI-сценарий materialize'ит `packages/plugins-ui-gateway`.

Полезные dev-переменные:

- `SENSYNC2_ANT_PLUS_MODE=fake` — переключает адаптер в fake transport.
- `SENSYNC2_ANT_PLUS_STICK_PRESENT=0` — в fake mode эмулирует отсутствие stick и даёт проверить toast/error flow.
- `SENSYNC2_ANT_PLUS_SCAN_DELAY_MS=1500` — замедляет fake scan, чтобы проверить loading-state.
- `SENSYNC2_ANT_PLUS_MEASUREMENT_INTERVAL_MS=500` — меняет интервал fake пакетов Moxy.
- `SENSYNC2_ANT_PLUS_AUTO_RECONNECT=0` — отключает автоматическое переподключение.
- `SENSYNC2_ANT_PLUS_RECONNECT_RETRY_DELAY_MS=1500` — меняет паузу между попытками reconnect.
- `SENSYNC2_ANT_PLUS_RECONNECT_SILENCE_MULTIPLIER=10` — множитель в watchdog-формуле `10n + 5s`.
- `SENSYNC2_ANT_PLUS_RECONNECT_MIN_SILENCE_MS=5000` — постоянная добавка в watchdog-формуле.
- `SENSYNC2_ANT_PLUS_LOG_PACKET_TIMING=0` — отключает подробный лог по каждой межпакетной дельте.
