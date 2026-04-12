# apps/desktop/src

Исходники Electron main/preload.

## Для чего

- Реализуют desktop bootstrap и IPC transport.

## Как работает

- `main.ts`:
  - стартует runtime;
  - держит таблицу подключённых UI-клиентов;
  - бродкастит control/binary payload в renderer;
  - пробрасывает команды обратно в runtime;
  - задаёт минимальный размер окна Electron для стабильной раскладки renderer.
- `preload.cjs`:
  - публикует транспортные методы и минимальный file/directory picker для `modalForm`;
  - не даёт renderer прямого доступа к Node API.
- Для диагностики stop-flow `main.ts` и `preload.cjs` могут печатать короткие логи на `ui.flags.patch` с `recording.*`, чтобы можно было разделить runtime, desktop bridge и renderer.

## Взаимодействие

- `main.ts` зависит от `apps/runtime`.
- `preload.cjs` формирует контракт, который использует `apps/client/src/electronTransport.ts`.
