# packages/plugin-kit/python-runtime

Shared Python runtime для `@sensync2/plugin-kit/ipc-worker`.

## Для чего

- Папка держит локальное Python-окружение и базовую transport/runtime обвязку для compute-worker'ов.
- Общие зависимости `protobuf`, `numpy`, `scipy` живут здесь, а не размазываются по каждому processor-пакету.

## Как работает

- `pyproject.toml` описывает локальное окружение, которое запускается через `uv run --project ...`.
- `src/sensync2_plugin_kit/ipc_worker` содержит базовый transport loop, framing и сгенерированные shared protobuf-модули.
- Конкретные compute-worker'ы из processor-пакетов импортируют этот runtime и только регистрируют свои методы.

## Взаимодействие

- Runtime boundary резолвит dev-команду через `uv run --project`.
- Processor-пакеты не управляют Python-зависимостями напрямую, а переиспользуют это общее окружение.
