# apps/client/src

Исходники renderer-приложения.

## Для чего

- Здесь собран schema-driven UI, который умеет:
  - подключаться к runtime;
  - декодировать control/data поток;
  - рендерить виджеты из схемы.

## Как работает

- `main.tsx` монтирует React-приложение.
- `App.tsx` содержит runtime singleton, widget renderer и ECharts/canvas графики.
- `App.tsx` содержит runtime singleton, рекурсивный renderer `row/column/widget`, локальные modal forms, toast-уведомления и ECharts/canvas графики.
- `electronTransport.ts` адаптирует IPC bridge Electron к интерфейсу `ClientTransport`.
- TS-файлы являются источником истины; соседние `.js` и `.d.ts` артефакты редактировать вручную не нужно.

## Взаимодействие

- Опирается на `window.sensyncBridge`, который публикуется из `apps/desktop/src/preload.cjs`.
- Читает контракты UI и wire-формат из `packages/core`.
- Данные графиков получает через `packages/client-runtime`.
