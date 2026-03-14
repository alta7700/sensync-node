# packages/plugins-trigno/CONTRACTS.md

Контракты Trigno-пакета поверх shared runtime-шины.

## 1. Runtime events

### Shared command events

- `trigno.stream.start.request@1`
  - `kind = command`
  - `priority = control`
  - payload:
    - `adapterId: string`
    - `requestId?: string`
- `trigno.stream.stop.request@1`
  - тот же payload
- `trigno.status.refresh.request@1`
  - тот же payload

### Shared fact events

- `trigno.status.reported@1`
  - `kind = fact`
  - `priority = system`
  - payload:
    - `adapterId: string`
    - `requestId?: string`
    - `status: TrignoStatusSnapshot`

### Plugin-private fact event

- `trigno.poll@1`
  - `kind = fact`
  - `priority = system`
  - visibility: `plugin-private`
  - payload: пустой объект

## 2. UI command boundary

`packages/plugins-trigno` расширяет `@sensync2/core` через `UiCommandBoundaryEventMap`.

Это значит:

- `commandType` в schema может быть exact-литералом `trigno.stream.start.request`, `trigno.stream.stop.request` или `trigno.status.refresh.request`;
- runtime принимает эти команды через тот же boundary-путь, что и shared `adapter.connect.request`.

## 3. TrignoStatusSnapshot

`trigno.status.reported` несёт нормализованный snapshot command-layer состояния:

- `host`
- `sensorSlot`
- `banner`
- `protocolVersion`
- `paired`
- `mode`
- `startIndex`
- `channelCount`
- `emgChannelCount`
- `auxChannelCount`
- `backwardsCompatibility`
- `upsampling`
- `frameInterval`
- `maxSamplesEmg`
- `maxSamplesAux`
- `serial`
- `firmware`
- `emg.{ rateHz, samplesPerFrame, units, gain }`
- `gyro.{ rateHz, samplesPerFrame, units, gain }`

## 4. Start gate

Ожидаемый live snapshot проверяется не при `connect`, а при `START`.

Семантика:

- `adapter.connect.request` поднимает TCP-сессию, применяет profile config, читает status snapshot и оставляет адаптер в `paused`;
- `trigno.stream.start.request` заново читает status snapshot и сравнивает его с ожидаемым режимом `veloerg`;
- при несовпадении адаптер остаётся в `paused`, а не переходит в `connected`.
- если TCP-сессия рвётся в `paused`, адаптер переходит в `failed` без auto-reconnect, чтобы оператор явно переподключил устройство.
