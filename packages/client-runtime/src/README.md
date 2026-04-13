# packages/client-runtime/src

Исходники client-side runtime.

## Для чего

- Содержат минимальный state/materialization слой между transport и React.

## Как работает

- `client-runtime.ts` — подключение, обработка control/binary сообщений, form options, UI-уведомления, снапшоты и подписки.
- `client-runtime.ts` также отвечает за отправку `UiCommandMessage`, который теперь завязан на exact union UI-команд из `packages/core/src/ui-command-boundary.ts`.
- При schema-driven вызове `sendCommand(...)` runtime использует централизованный helper `createUiCommandMessage(...)`, потому что payload приходит из динамической схемы.
- `client-runtime.ts` также отдаёт renderer'у последние session/value/timestamp-срезы через `getLatestSessionMs()`, `getLatestValue(...)`, `getLatestValues(...)` и `getLatestEntries(...)`, чтобы профильные summary-строки не тянули данные из React state.
- Для диагностики stop-flow `client-runtime.ts` пишет в stdout короткие логи на `ui.flags.patch` с recording-флагами и на `ui.timeline.reset`.
- `ring-buffer-store.ts` — `TypedArray`-based хранение потоков и выборка видимого окна, включая optional lookback-точку перед началом окна для ступенчатых графиков.
- `ring-buffer-store.ts` также умеет расширять буфер под крупный viewer-snapshot, если stream пришёл одним history-batch.
- `types.ts` — transport/buffer store интерфейсы и shape снапшота.

## Взаимодействие

- Ожидает `UiControlMessage` и binary frames от `packages/plugins-ui-gateway`.
- Используется в `apps/client/src/App.tsx`.
