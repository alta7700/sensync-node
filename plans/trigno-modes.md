# План: полная поддержка режимов Delsys Trigno Avanti

Дата: 15 марта 2026 года.

## Цель

Вынести поддержку режимов `Delsys Trigno Avanti` в отдельный трек и довести драйвер до profile-driven поведения:

- драйвер умеет читать все режимы семейства `Avanti`, а не только частный случай `mode 7`;
- runtime-профиль задаёт, какие режимы допустимы и как сырьевые каналы превращаются в логические `streamId`;
- расчёт ожидаемых частот и timeline опирается на реальный layout устройства и корректно учитывает `BACKWARDS COMPATIBILITY` и `UPSAMPLE`.

## Почему это отдельная задача

Сейчас код в `packages/plugins-trigno` остаётся в промежуточном состоянии:

- transport уже умеет читать `MODE?`, `CHANNELCOUNT?`, `AUXCHANNELCOUNT?`, `CHANNEL n RATE?`, `CHANNEL n SAMPLES?`, `CHANNEL n UNITS?`, `CHANNEL n GAIN?`;
- но data-path по-прежнему жёстко завязан на layout `mode 7`: `1 EMG + 3 gyro`;
- live-замер показал, что второй датчик в `slot 2` реально работает как `mode 66`, то есть `1 EMG + 4 orientation channels`, и текущий parser для него уже неверен;
- простое "подкручивание частот" здесь не решает проблему, потому что ошибка не только во временной шкале, а в неправильной интерпретации layout.

Поэтому задачу нужно делать отдельно, без смешивания с текущими доработками `adapter-kit` и demo-профилей.

## Что уже подтверждено

### По живому железу

- `slot 1`:
  - `mode = 7`
  - `channelCount = 4`
  - `emg = 1925.9259 Hz`
  - `gyro = 148.1481 Hz`
- `slot 2`:
  - `mode = 66`
  - `channelCount = 5`
  - `emg = 1777.7778 Hz`
  - `orientation = 74.0741 Hz`
  - `units = Q`

### По официальной документации

- у `Avanti` действительно есть большая таблица режимов;
- `mode 7` официально описан как `EMG plus Gyroscope (+/- 2000dps)`;
- `mode 66` официально описан как `EMG (1778Hz) plus Orientation (74Hz, 16bits)`;
- `BACKWARDS COMPATIBILITY` и `UPSAMPLE` меняют частотную схему **портов SDK**, а не только "добавляют флажок в snapshot".

## Куда смотреть в документации

### 1. Список режимов Avanti

Главный источник:

- [Delsys Trigno SDK User Guide](https://www.delsys.com/downloads/USERSGUIDE/trigno/sdk.pdf)

Для реализации режимов смотреть:

- раздел `7.1 Trigno Avanti/Avanti Snap/Avanti Spring/Avanti EKG/Avanti Mini Sensor Details`
- страницы `16-19` PDF
- в web-извлечении это видно здесь:
  - [стр. 15, modes 0-39](https://www.delsys.com/downloads/USERSGUIDE/trigno/sdk.pdf)
  - [стр. 16, modes 40-67](https://www.delsys.com/downloads/USERSGUIDE/trigno/sdk.pdf)
  - [стр. 16-17, modes 68-133](https://www.delsys.com/downloads/USERSGUIDE/trigno/sdk.pdf)
  - [стр. 17-18, modes 134-170](https://www.delsys.com/downloads/USERSGUIDE/trigno/sdk.pdf)

Практически это те же таблицы, которые уже подтверждают:

- `mode 7` как `EMG + Gyroscope`
- `mode 39/66/67/134/169/170` как orientation-варианты
- семейства `50-65`, `68-83`, `86-133`, `153-168` как многоосевые IMU/RMS режимы с разными частотами

Важно:

- для первого этапа задачи считать scope именно **семейство Avanti из раздела 7.1**;
- секции `7.2+` (`Galileo`, `Quattro`, `Duo`, `FSR Adapter`, `Load Cell`, `Goniometer`, `Analog Adapter`) не подмешивать в эту задачу, потому что это уже другие устройства и другой channel topology.

### 2. Как правильно считать частоты с учётом `BACKWARDS COMPATIBILITY` и `UPSAMPLE`

Главный источник тот же:

- [Delsys Trigno SDK User Guide](https://www.delsys.com/downloads/USERSGUIDE/trigno/sdk.pdf)

Для расчёта частот и expected timeline смотреть **три места**:

1. `6.1.2 Sampling Rates & Backwards Compatibility`, страница `9` PDF.
   Это главный раздел про то, как частота **порта** вычисляется из `Samples per frame / Frame interval`, и как она меняется при `BC ON/OFF`.

2. `6.3.3 Backwards Compatibility`, страница `12` PDF.
   Здесь описано правило:
   - при `BC=OFF` частоты EMG/AUX портов масштабируются до наибольшей нативной частоты на порту;
   - при `BC=ON` порты фиксируются в lock-step режимах `2000 / 1925.9259 / 1111.111 / 148.148`.

3. `6.3.4 Upsampling`, страница `12` PDF.
   Здесь описано правило:
   - `UPSAMPLE` влияет на sample rate только когда `BC=ON`;
   - при `BC=OFF` флаг `UPSAMPLE` не должен менять расчёт частоты.

Дополнительно для реализации смотреть:

- `6.3.5 Max Samples EMG`
- `6.3.6 Max Samples AUX`
- `6.3.7 Frame Interval`
- `6.3.18 Sensor Samples`
- `6.3.19 Sensor Rate`

Ключевой вывод для реализации:

- **источником истины для runtime timeline должен быть живой snapshot устройства**;
- документация по `BC/UPSAMPLE` нужна не для подмены live `rateHz`, а для:
  - валидации профиля;
  - понимания resampling на уровне порта;
  - unit/integration тестов на expected layout.

## Архитектурные принципы

1. Драйвер не должен угадывать семантику каналов только по `units`.
2. Transport не должен знать про `gyro.x/y/z`, `orientation.qw/qx/qy/qz` или другие доменные имена.
3. Transport обязан уметь вернуть сырой layout:
   - `mode`
   - `channelCount`
   - `emgChannelCount`
   - `auxChannelCount`
   - `startIndex`
   - `channels[]` со всеми `rateHz/samplesPerFrame/units/gain`
4. Профиль обязан задавать mapping:
   - какие режимы допустимы;
   - как сырьевые каналы превращаются в логические `streamId`;
   - какие units и названия считаются корректными для этого layout.
5. Если профиль не может корректно описать найденный режим, драйвер должен падать явно, а не "пытаться читать как mode 7".

## Граница первой реализации

В первой полной реализации этой задачи:

- поддержать **все режимы Avanti из раздела 7.1**;
- не трогать устройства из разделов `7.2+`;
- не пытаться нормализовать всё к одному набору выходов вроде `emg + gyro`, потому что orientation/IMU/RMS режимы этому противоречат;
- не завязывать transport на текущий demo-профиль `veloerg`.

## Этапы

### 1. Зафиксировать каталог режимов Avanti

Что сделать:

- собрать в коде полный каталог режимов из раздела `7.1`;
- выделить семейства режимов:
  - `classic-like` (`0-23`, `39`)
  - `avanti-only low-bandwidth` (`40-84`)
  - `high-density / slot occupancy 2` (`86-170`)
- для каждого mode хранить минимальное описание:
  - `mode`
  - `channelCount`
  - `emgChannelCount`
  - `auxChannelCount`
  - тип выходов (`emg`, `acc`, `gyro`, `imu`, `orientation`, `rms`)
  - ожидаемые нативные частоты/`samplesPerFrame`
  - `slotOccupancy`

Критерии приёмки:

- каталог лежит в коде как отдельный модуль;
- есть unit-тесты на конкретные известные mode entries: `7`, `39`, `66`, `67`, `84`, `134`, `169`, `170`;
- документация в `packages/plugins-trigno/CONTRACTS.md` ссылается на этот каталог как на локальную реализацию таблицы SDK.

### 2. Разделить сырой boundary и логический профиль

Что сделать:

- перестроить `trigno-boundary.ts`, чтобы snapshot возвращал полный `channels[]`, а не "готовые emg/gyro";
- сохранить поверх этого удобные view-хелперы, но только как derived-слой;
- вынести понятие `TrignoRawLayout` отдельно от `TrignoProfileLayout`.

Критерии приёмки:

- transport умеет сообщить layout любого Avanti mode из раздела `7.1`;
- код больше не предполагает, что AUX всегда равен трем gyro-осям;
- тесты проходят на `mode 7` и `mode 66`.

### 3. Ввести profile-driven layout mapping

Что сделать:

- добавить в config профиля явный layout preset или layout description;
- поддержать два пути:
  - `strict`: профиль ожидает конкретный набор modes;
  - `adaptive`: профиль разрешает несколько modes и подбирает mapping по фактическому snapshot.

Критерии приёмки:

- профиль может явно разрешить `mode 7` и запретить `mode 66`;
- профиль может разрешить оба режима и описать два разных набора output stream'ов;
- mismatch даёт явную ошибку подключения.

### 4. Переписать transport на mode-aware data parsing

Что сделать:

- убрать жёсткую модель `sliceGyroSamplesFromPacket()`;
- парсить AUX как набор каналов по текущему raw layout;
- сохранить EMG/AUX как портовые потоки, но не навязывать им доменную семантику;
- учесть `startIndex` и channel allocation для случаев, когда layout становится плотнее.

Критерии приёмки:

- для `mode 66` четвёртый orientation channel больше не теряется;
- для `mode 7` поведение не меняется;
- parser работает на representative fixture'ах для нескольких mode families.

### 5. Перенести расчёт частот на snapshot-first модель

Что сделать:

- убрать хардкод ожидаемых EMG/AUX rate из стартовой логики;
- timeline и `dtMs` строить от реальных `CHANNEL n RATE?` и `CHANNEL n SAMPLES?`;
- использовать `6.1.2`, `6.3.3`, `6.3.4` только для проверки целостности snapshot и для тестов.

Критерии приёмки:

- для `BC=OFF` никакие локальные константы не подменяют live `rateHz`;
- для `BC=ON` драйвер умеет объяснимо валидировать lock-step частоты портов;
- нет дрейфа в десятки секунд между каналами при 5-10 минутных замерах на поддерживаемых режимах.

### 6. Сделать mode-aware emit path в адаптере

Что сделать:

- заменить жёсткий emit `emg + gyro.x/y/z` на profile-driven mapping;
- output stream'ы объявлять из layout preset;
- интегрировать это с `adapter-kit output-map`, но не тащить device semantics в transport.

Критерии приёмки:

- `mode 7` продолжает эмитить `emg` и `gyro.x/y/z`;
- `mode 66` эмитит `emg` и `orientation.*`;
- IMU-режимы (`10 channels`, `7 channels`) можно описать без переписывания transport.

### 7. Добавить сырой диагностический инструмент

Что сделать:

- завести скрипт в `scripts/`, который:
  - подключается по TCP;
  - не меняет mode без явного флага;
  - снимает `snapshot`;
  - по желанию пишет короткий raw capture с портов `50043/50044`.

Критерии приёмки:

- инструмент позволяет безопасно проверить новый mode без правки runtime-кода;
- результаты пригодны для добавления новых fixture-тестов.

### 8. Расширить тестовый контур

Что сделать:

- добавить unit-тесты на каталог режимов;
- добавить unit-тесты на rate resolver для `BC=ON/OFF` и `UPSAMPLE=ON/OFF`;
- добавить fixture-тесты transport/parser для representative modes:
  - `7`
  - `39`
  - `66`
  - `67`
  - один режим из `50-65`
  - один режим из `68-83`
  - один режим из `86-133`
  - один режим из `153-170`
- добавить live-smoke сценарии для минимум двух разных режимов.

Критерии приёмки:

- `npm --workspace @sensync2/plugins-trigno run test` покрывает и layout, и rate policy;
- regression на `mode 7` не ломается;
- `mode 66` получает отдельную проверку на полный набор каналов.

### 9. Аппаратная валидация

Что сделать:

- прогнать по железу минимум:
  - `mode 7`
  - `mode 66`
  - один `7-channel` IMU режим
  - один high-density режим с `slot occupancy = 2`
- для каждого сценария проверить:
  - `MODE?`
  - `CHANNELCOUNT?`
  - `AUXCHANNELCOUNT?`
  - `CHANNEL n RATE?`
  - фактический rate по `performance.now()`
  - отсутствие накопления заметного drift между потоками

Критерии приёмки:

- расхождение между snapshot и фактическим приходом данных остаётся в пределах малого системного шума;
- драйвер больше не "читает orientation как gyro".

## Риски

1. Таблица режимов большая, и ручная ошибка при переносе mode entries очень вероятна.
2. `slot occupancy = 2` может влиять на ожидания профиля и channel allocation сильнее, чем сейчас предполагает код.
3. Orientation-режимы требуют аккуратно выбрать naming scheme для `streamId`, иначе потом придётся ломать публичный контракт.
4. Нельзя использовать текущий parser как источник истины для новых modes: сначала raw layout, потом логический mapping.

## Что не делать в этой задаче

- Не добавлять поддержку `Galileo`, `Quattro`, `Duo`, `FSR`, `Load Cell`, `Goniometer`, `Analog Adapter`.
- Не завязывать transport на конкретную UI-схему `veloerg`.
- Не подменять live `CHANNEL RATE?` локальными константами "по памяти".
- Не пытаться "автоматически догадаться", что означает канал, только по units без profile mapping.

## Итоговое ожидаемое состояние

После завершения задачи:

- `Trigno` в `sensync2` корректно работает со всеми режимами `Avanti` из раздела `7.1`;
- профиль управляет допустимыми режимами и формой выходных потоков;
- `BC/UPSAMPLE` корректно учитываются в expected sampling policy;
- драйвер не ломает данные при переключении с `mode 7` на `mode 66` и другие layout'ы;
- появление нового Avanti mode сводится к добавлению записи в каталог и профильного mapping, а не к переписыванию transport.
