# apps/desktop/src

Исходники Electron main/preload.

## Для чего

- Реализуют desktop bootstrap и IPC transport.

## Как работает

- `main.ts`:
  - стартует runtime;
  - держит таблицу подключённых UI-клиентов;
  - бродкастит control/binary payload в renderer;
  - пробрасывает команды обратно в runtime.
- `preload.cjs`:
  - публикует только транспортные методы;
  - не даёт renderer прямого доступа к Node API.

## Взаимодействие

- `main.ts` зависит от `apps/runtime`.
- `preload.cjs` формирует контракт, который использует `apps/client/src/electronTransport.ts`.
