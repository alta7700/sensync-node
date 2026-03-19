# packages/plugins-processor-dfa-a1/python_worker

Python compute-worker для `dfa-a1`.

## Для чего

- Папка держит Python entrypoint и локальные generated protobuf-модули для DFA-a1.

## Как работает

- `main.py` импортирует shared runtime из `plugin-kit/python-runtime`.
- Worker регистрирует только один метод `dfa.a1.from_rr`.
- Логи пишет в `stderr`, а `stdout` оставляет только под транспортные frame'ы.

## Взаимодействие

- Запускается через `uv run --project packages/plugin-kit/python-runtime python ...`.
- Получает protobuf request, считает DFA-a1 и возвращает protobuf response.
