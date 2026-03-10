# scripts

Служебные скрипты репозитория.

## Для чего

- Здесь лежат утилиты подготовки данных и вспомогательные преобразования, которые не должны попадать в runtime или UI.

## Как работает

- `convert_h5_to_replay.py` конвертирует HDF5-файл в replay bundle с `manifest.json` и бинарными потоками для `veloerg-h5-replay-adapter`.
- Скрипт не является источником истины для структуры runtime-событий: он только готовит входные данные под уже существующий replay-формат.

## Взаимодействие

- Используется вместе с `packages/plugins-fake`.
- Результат работы скрипта потребляет `apps/runtime` через дефолтный набор плагинов.
- Формат результата описан в [REPLAY_FORMAT.md](/Users/tascan/Documents/sirius/sensync2/packages/plugins-fake/REPLAY_FORMAT.md).
