# apps

Папка содержит исполняемые приложения workspace.

## Для чего

- Здесь находятся точки входа системы:
  - `client` — renderer UI;
  - `desktop` — Electron shell;
  - `runtime` — Node runtime/host для plugin worker'ов.

## Как работает

- `desktop` поднимает `runtime`, создаёт окно Electron и пробрасывает UI-транспорт через IPC.
- `client` не общается с runtime напрямую по сети: он использует bridge из preload.
- `runtime` может запускаться отдельно для отладки, но в обычном сценарии стартует из `desktop`.

## Взаимодействие

- Использует общие пакеты из [packages/README.md](../packages/README.md).
- Корневой сценарий запуска описан в [README.md](../README.md).
