# packages/plugins-trigno

TCP-интеграция с `Delsys Trigno` для live-профиля `veloerg`.

## Для чего

- Пакет добавляет отдельный worker-plugin `trigno-adapter`.
- Он держит boundary к command/data TCP sockets Trigno вне `core`, `runtime` и UI.
- В `v1` пакет публикует только raw `EMG + Gyroscope` для одного выбранного слота датчика.

## Как работает

- Используется только `real` transport поверх `node:net`.
- Connect flow делится на два этапа:
  - `adapter.connect.request` поднимает command socket, применяет фиксированный profile config, читает status snapshot, открывает data sockets и переводит адаптер в `paused`;
  - `trigno.stream.start.request` валидирует live snapshot против ожидаемого режима `veloerg` и только потом отправляет `START`.
- Data path разбирает standard ports:
  - `50043` как фиксированную матрицу `16 x 1 float32`;
  - `50044` как фиксированную матрицу `16 x 9 float32`.
- `STARTINDEX?` используется как единственный источник истины для смещения внутри этих матриц.
- В `v1` публикуются четыре потока:
  - `trigno.avanti`
  - `trigno.avanti.gyro.x`
  - `trigno.avanti.gyro.y`
  - `trigno.avanti.gyro.z`
- Таймлайн после каждого `START` переякоривается к текущему `session time`, а дальше идёт по фиксированному `dtMs`.
- Watchdog следит за тишиной по обоим data ports и в `connected` состоянии запускает auto-reconnect.
- В `paused` состоянии reconnect отключён намеренно: оператор должен явно решить, что делать дальше.

## Взаимодействие

- Использует `@sensync2/core` и `@sensync2/plugin-sdk`.
- Экспортирует plugin-specific runtime contracts и `trignoUiCommandBoundaryGuards`.
- Подключается в `apps/runtime` как часть профиля `veloerg`.
- Concrete UI materialization живёт в `packages/plugins-ui-gateway`.
