# План: поддержка BLE-устройств

Дата исследования: 10 марта 2026 года.

## Цель

Понять, можно ли в `sensync2` поддержать BLE-устройства в Electron/Node-модели, и есть ли для этого библиотека, которая достаточно жива и подходит для plugin-first runtime.

## Что уже делает текущий `sensync`

Проверено по `../sensync/drivers/zephyr/driver.py`.

Текущий BLE-драйвер:
- сканирует устройства;
- выбирает нужное устройство по advertisement/local name;
- подключается по GATT;
- подписывается на notifications;
- пишет управляющие команды в characteristic;
- разбирает проприетарные пакеты Zephyr.

Ключевой вывод:
- самая сложная часть тут не сам BLE transport, а корректная модель соединения, reconnect и разбор полезной нагрузки конкретного устройства;
- сам API для `scan/connect/read/write/notify` должен быть библиотечным, а не самописным.

## Готовые библиотеки

### Кандидат 1: `@abandonware/noble`

- Репозиторий: [abandonware/noble](https://github.com/abandonware/noble)
- npm: [@abandonware/noble](https://www.npmjs.com/package/@abandonware/noble)
- Активность:
  - `591` stars
  - последний push: `2025-02-09`
  - npm latest: `1.9.2-26`, опубликован `2025-02-09`
- Популярность:
  - около `5989` загрузок npm за неделю `2026-03-03..2026-03-09`

Что важно:
- библиотека прямо ориентирована на Node BLE central;
- поддерживает `macOS`, `Linux`, `FreeBSD`, `Windows`;
- даёт доступ к scanning, connect/disconnect, services/characteristics, notifications;
- для desktop/Electron это практически стандартный кандидат.

Минусы:
- есть нативные и системные зависимости;
- BLE на desktop в любом случае остаётся платформенно-капризной областью;
- часть проблем будет не в коде плагина, а в драйверах ОС и адаптере Bluetooth.

### Кандидат 2: `node-ble`

- Репозиторий: [chrvadala/node-ble](https://github.com/chrvadala/node-ble)
- npm: [node-ble](https://www.npmjs.com/package/node-ble)
- Активность:
  - `344` stars
  - последний push: `2025-01-19`
  - npm latest: `1.13.0`, опубликован `2025-01-19`
- Популярность:
  - около `723` загрузок npm за неделю `2026-03-03..2026-03-09`

Что важно:
- это чистый Node.js без native bindings;
- API аккуратный и современный.

Критичный минус:
- библиотека работает только на Linux через BlueZ/DBus;
- `Windows` и `macOS` официально не поддерживаются.

Вывод:
- это хороший Linux-only вариант, но плохой дефолт для `sensync2`, если desktop должен жить на macOS.

## Если делать без библиотек

Самостоятельно реализовывать BLE transport нельзя считать разумным вариантом.

Оценка:
- сложность: очень высокая;
- риск ошибки: очень высокий;
- область риска: HCI/OS integration, discovery, pairing/permissions, reconnect, notifications, platform-specific behavior.

Иными словами, здесь не надо писать "свой BLE". Нужно выбрать transport-библиотеку и поверх неё реализовать device-specific плагины.

## Рекомендация для `sensync2`

Рекомендую следующую схему:

1. Базовый BLE transport для `sensync2` делать на `@abandonware/noble`.
2. Поверх него писать отдельные device-плагины:
   - `zephyr-ble-adapter`;
   - далее другие BLE-адаптеры по мере надобности.
3. Не смешивать transport-логику и разбор протокола устройства:
   - scanning/connect/notify/write остаются общими;
   - парсинг пакетов и команды живут в plugin worker конкретного устройства.
4. Для Linux-only сценариев можно держать `node-ble` как альтернативный backend, но не как основной путь.

### Оценка риска

- транспорт BLE в `sensync2`: реалистично;
- перенос Zephyr-подобного устройства: средний риск;
- главный риск: не кодовая сложность, а поведение BLE на разных ОС и стабильность reconnect.

## Источники

- [abandonware/noble](https://github.com/abandonware/noble)
- [@abandonware/noble на npm](https://www.npmjs.com/package/@abandonware/noble)
- [chrvadala/node-ble](https://github.com/chrvadala/node-ble)
- [node-ble на npm](https://www.npmjs.com/package/node-ble)
- Текущая реализация в `sensync`: `../sensync/drivers/zephyr/driver.py`
