# apps/client/src

Исходники renderer-приложения.

## Для чего

- Здесь собран schema-driven UI, который умеет:
  - подключаться к runtime;
  - декодировать control/data поток;
  - рендерить виджеты из схемы.

## Как работает

- `main.tsx` монтирует React-приложение.
- `App.tsx` содержит runtime singleton, рекурсивный renderer `row/column/widget`, локальные modal forms, профильный inline-блок `veloerg` для мощности, summary-строку перед графиками, toast-уведомления и ECharts/canvas графики, включая history-режим с data-zoom для viewer-профилей; submit-валидация не пропускает мощность `>= 1000`.
- `ui-schema-runtime.ts` — pure helper-слой для schema-driven форм и control payload: парсинг `timelineTimeInput`, локальные decimal/`mm:ss` formatter'ы и client-side bindings вроде `power +30`.
- `electronTransport.ts` адаптирует IPC bridge Electron к интерфейсу `ClientTransport`.
- TS-файлы являются источником истины; соседние `.js` и `.d.ts` артефакты редактировать вручную не нужно.

## Взаимодействие

- Опирается на `window.sensyncBridge`, который публикуется из `apps/desktop/src/preload.cjs`.
- Читает контракты UI и wire-формат из `packages/core`.
- Данные графиков получает через `packages/client-runtime`.
