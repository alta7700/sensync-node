# packages/plugins-processor-dfa-a1/proto

Локальные `.proto` контракты для `dfa-a1` processor'а.

## Для чего

- Папка фиксирует payload request/response для метода расчёта DFA-a1.

## Как работает

- Контракт импортирует shared `numeric_array.proto` из `plugin-kit/ipc-worker`.
- TS и Python codegen используют этот файл как source of truth.

## Взаимодействие

- Генерация артефактов идёт через общий скрипт в `scripts/`.
- Python worker и TS processor не держат параллельных ручных схем.
