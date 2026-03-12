# packages/client-runtime/src

Исходники client-side runtime.

## Для чего

- Содержат минимальный state/materialization слой между transport и React.

## Как работает

- `client-runtime.ts` — подключение, обработка control/binary сообщений, form options, UI-уведомления, снапшоты и подписки.
- `ring-buffer-store.ts` — `TypedArray`-based хранение потоков и выборка видимого окна.
- `types.ts` — transport/buffer store интерфейсы и shape снапшота.

## Взаимодействие

- Ожидает `UiControlMessage` и binary frames от `packages/plugins-ui-gateway`.
- Используется в `apps/client/src/App.tsx`.
