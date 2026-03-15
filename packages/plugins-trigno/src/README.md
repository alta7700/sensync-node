# packages/plugins-trigno/src

Исходники Trigno worker-плагина и TCP transport.

## Для чего

- Здесь живут boundary, transport и runtime-логика Trigno.

## Как работает

- `trigno-boundary.ts`:
  - нормализует config и `formData`;
  - описывает plugin-specific UI-команды;
  - фиксирует ожидаемый live snapshot для допуска `START`, включая `backwardsCompatibility` и `upsampling`.
- `trigno-transport.ts`:
  - поднимает command/data sockets;
  - умеет читать banner и ASCII-ответы с terminator `\\r\\n\\r\\n`;
  - собирает неполные TCP reads и режет raw потоки по fixed-size step layout;
  - применяет `BACKWARDS COMPATIBILITY` и `UPSAMPLE` из adapter config вместо хардкода.
- `trigno-adapter.ts`:
  - реализует lifecycle `connect / start / stop / disconnect`;
  - держит state holder, reconnect timer и uniform emit через `adapter-kit`;
  - публикует `signal.batch`;
  - держит watchdog и auto-reconnect только для активного сбора;
  - переводит несовпавший start snapshot в состояние `paused`, а не молча в `connected`.
- `event-contracts.ts` описывает shared-команды `start/stop/refresh`, факт `trigno.status.reported` и внутренний тик `trigno.poll`.
- `runtime-event-map.spec.ts` и `generated-runtime-event-map.ts` добавляют exact runtime-event union для Trigno.

## Взаимодействие

- `apps/runtime` использует пакет как обычный worker-plugin.
- `packages/plugins-ui-gateway` использует exact `commandType` и `trigno.status.reported`.
- `apps/runtime/src/default-plugins.ts` для профиля `veloerg` явно фиксирует `BC=OFF` и `UPSAMPLE=OFF`.
