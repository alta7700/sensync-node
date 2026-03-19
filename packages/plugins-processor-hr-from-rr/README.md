# packages/plugins-processor-hr-from-rr

Generic processor для расчёта HR из RR-потока.

## Для чего

- Пакет публикует worker-плагин `hr-from-rr-processor`, который не привязан к конкретному устройству.
- Он превращает любой совместимый RR stream в derived HR stream.

## Как работает

- Processor подписывается на exact `sourceStreamId`.
- Внутри держит короткий estimator `median + EMA` по RR и на каждый валидный RR публикует HR.
- Пакет использует `@sensync2/plugin-kit` для input runtime, emit path и timeline-reset lifecycle.

## Взаимодействие

- Профили runtime подключают processor как обычный worker-плагин.
- Вход и выход задаются конфигом `sourceStreamId` и `outputStreamId`.
- Сам пакет не знает ничего про `Zephyr` или другой transport.
