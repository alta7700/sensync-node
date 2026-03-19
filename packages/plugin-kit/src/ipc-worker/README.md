# packages/plugin-kit/src/ipc-worker

Общий IPC helper для внешних compute-worker процессов.

## Для чего

- Папка даёт reusable transport/process-management слой для Python-backed processor'ов.
- Она не знает ничего про `dfa`, `welch` или другие доменные методы.

## Как работает

- Поднимает child process через `stdio`.
- Использует length-prefixed binary frames и protobuf envelope как транспортный контракт.
- Дает TS client, single-flight/latest-wins helper и базовый Python runtime для request/response loop.
- Клиент жёстко проверяет `protocolVersion` из `ready` handshake; несовместимый worker отклоняется до первого request.

## Взаимодействие

- Processor-пакеты используют этот слой для запуска внешнего compute-worker.
- Приложение передаёт сюда уже готовый `command/args/cwd/env` через boundary, а не заставляет `plugin-kit` самому искать бинарник.
