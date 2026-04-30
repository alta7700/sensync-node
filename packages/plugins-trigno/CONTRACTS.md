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

### Connect payload для `adapter.connect.request`

Пакет ожидает два допустимых вида `formData`:

- legacy single-sensor:
  - `host: string`
  - `sensorSlot: number`
- paired mode:
  - `host: string`
  - `vlSensorSlot: number`
  - `rfSensorSlot: number`

Правила:

- все sensor slot должны лежать в диапазоне `1..16`;
- в paired mode `vlSensorSlot !== rfSensorSlot`;
- `pedaling-emg-*` используют legacy single-sensor форму;
- `veloerg` использует только paired форму.

## 3. TrignoStatusSnapshot

`trigno.status.reported` несёт нормализованный snapshot command-layer состояния.

Общие поля верхнего уровня:

- `host`
- `banner`
- `protocolVersion`
- `backwardsCompatibility`
- `upsampling`
- `frameInterval`
- `maxSamplesEmg`
- `maxSamplesAux`

Legacy single-sensor snapshot дополнительно несёт:

- `sensorSlot`
- `paired`
- `mode`
- `startIndex`
- `channelCount`
- `emgChannelCount`
- `auxChannelCount`
- `serial`
- `firmware`
- `emg.{ rateHz, samplesPerFrame, units, gain }`
- `gyro.{ rateHz, samplesPerFrame, units, gain }`

Paired snapshot вместо этого несёт:

- `sensors.vl`
- `sensors.rf`

Каждый sensor snapshot внутри `sensors.<role>` содержит:

- `sensorSlot`
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
- `trigno.stream.start.request` заново читает status snapshot и сравнивает его с ожидаемым режимом профиля;
- в paired mode сравнение выполняется отдельно для `vl` и `rf`, а mismatch-поля префиксуются как `vl.*` и `rf.*`;
- при несовпадении адаптер остаётся в `paused`, а не переходит в `connected`.
- если TCP-сессия рвётся в `paused`, адаптер переходит в `failed` без auto-reconnect, чтобы оператор явно переподключил устройство.

## 5. Sampling policy для `BC / UPSAMPLE`

Практическая политика `v1`:

- профиль `veloerg` запускает Trigno с `backwardsCompatibility = false`;
- профиль `veloerg` запускает Trigno с `upsampling = false`;
- эти два флага входят в ожидаемый `start snapshot` и считаются частью допустимого live-режима.

Причина:

- по `Trigno SDK User Guide` раздел `6.1.2` режим `BACKWARDS COMPATIBILITY = ON` переводит SDK data ports в legacy-совместимую частотную схему;
- разделы `6.3.3` и `6.3.4` описывают, что при `BC=ON` порт `50043` даёт фиксированные `2000 Hz` или `1111.111 Hz` в зависимости от `UPSAMPLE`, а `50044` остаётся на фиксированных частотах AUX-каналов;
- при `BC=OFF` цифровые SDK ports ресемплируются к максимальной нативной частоте на каждом порту.

Следствие для `sensync2`:

- режим `BC=ON` может давать расхождение между command-layer snapshot и фактической частотой EMG data port;
- поэтому текущий live-профиль выбирает `BC=OFF + UPSAMPLE=OFF` как наиболее предсказуемую схему для `EMG + Gyro`.
