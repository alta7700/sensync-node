# План: поддержка ANT+ датчиков

Дата исследования: 10 марта 2026 года.

## Цель

Понять, можно ли в `sensync2` поддержать ANT+ датчики, включая кейс Moxy, без возврата к Python `openant`.

## Что уже делает текущий `sensync`

Проверено по `../sensync/drivers/moxy/driver.py`.

Текущий драйвер:
- работает через USB ANT+ stick;
- использует `openant`;
- настраивает канал под `Muscle Oxygen` profile (`device type 31`);
- обрабатывает broadcast пакеты;
- дедуплицирует данные по `event_count`;
- держит работу node в отдельном потоке.

Вывод:
- текущий use case не абстрактный ANT+, а вполне конкретный профиль `Muscle Oxygen`;
- если Node-библиотека закрывает именно этот профиль, перенос сильно упрощается.

## Готовые библиотеки

### Кандидат 1: `ant-plus`

- Репозиторий: [Loghorn/ant-plus](https://github.com/Loghorn/ant-plus)
- npm: [ant-plus](https://www.npmjs.com/package/ant-plus)
- Активность:
  - `147` stars
  - последний push: `2026-02-26`
  - npm latest: `0.2.0`, опубликован `2026-02-26`
- Популярность:
  - около `30` загрузок npm за неделю `2026-03-03..2026-03-09`

Что важно:
- библиотека живая, обновлялась совсем недавно;
- работает через USB stick и `libusb`;
- README описывает `GarminStick2` / `GarminStick3`, attach/scan lifecycle и требования по ОС;
- в репозитории есть явная поддержка muscle oxygen:
  - [src/muscle-oxygen-sensors.ts](https://github.com/Loghorn/ant-plus/blob/master/src/muscle-oxygen-sensors.ts)
  - [sample/muscle-oxygen.js](https://github.com/Loghorn/ant-plus/blob/master/sample/muscle-oxygen.js)

Это очень сильный сигнал. Для нашего кейса это не "может быть когда-нибудь подойдёт", а библиотека, в которой профиль уже существует.

### Альтернативы

По Node-экосистеме заметного второго кандидата такого же уровня я не нашёл.

Это нормально: рынок ANT+ маленький, и в нём важнее активность репозитория и наличие именно нужного профиля, чем абсолютные числа по stars и downloads.

## Если делать без библиотеки

Самостоятельная реализация здесь уже ощутимо опаснее, чем Trigno TCP.

Оценка:
- сложность: средняя или высокая;
- риск ошибки: высокий.

Где основные риски:
- работа с USB stick и драйверами на разных ОС;
- инициализация канала и жизненный цикл устройства;
- ANT+ profile parsing;
- особенности конкретных сенсоров;
- упаковка под Electron.

То есть без библиотеки пришлось бы реализовывать не только прикладной профиль, но и большую часть transport/device слоя.

## Рекомендация для `sensync2`

Рекомендую принять `ant-plus` как основной путь для ANT+ интеграции.

Практичный план:

1. Сделать отдельный `ant-plus-adapter` plugin worker.
2. Сначала закрыть именно сценарий Moxy:
   - USB stick;
   - attach/scan;
   - `Muscle Oxygen` packets;
   - дедупликация по `event_count`, как сейчас.
3. Вынести OS-specific требования в отдельную документацию запуска:
   - `libusb`;
   - драйверы;
   - ограничения на параллельный доступ к stick.
4. На раннем этапе обязательно протестировать на целевых ОС, а не считать, что Node-библиотека снимает все риски.

### Оценка риска

- интеграция в `sensync2`: реалистична;
- риск ниже, чем я ожидал до исследования, потому что muscle oxygen профиль уже реализован;
- основной риск смещается с протокола на USB/driver/runtime packaging.

Итоговая оценка:
- ANT+ в `sensync2` поддержать можно;
- лучший кандидат на сегодня: `ant-plus`;
- для Moxy это хороший и достаточно обоснованный выбор.

## Источники

- [Loghorn/ant-plus](https://github.com/Loghorn/ant-plus)
- [ant-plus на npm](https://www.npmjs.com/package/ant-plus)
- [muscle-oxygen-sensors.ts](https://github.com/Loghorn/ant-plus/blob/master/src/muscle-oxygen-sensors.ts)
- [sample/muscle-oxygen.js](https://github.com/Loghorn/ant-plus/blob/master/sample/muscle-oxygen.js)
- Текущая реализация в `sensync`: `../sensync/drivers/moxy/driver.py`
