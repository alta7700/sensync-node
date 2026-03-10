# sensync2

`sensync2` — новая кодовая база для event-driven обработки физиологических данных. Текущий `v1` собран вокруг Electron-приложения, в котором Node runtime, plugin workers и React renderer живут в одном desktop-процессе, но остаются разделёнными по контрактам.

## Что здесь есть

- `apps/runtime` — минимальное ядро: маршрутизация событий, очереди, plugin workers, lifecycle и telemetry.
- `apps/desktop` — Electron main process и IPC bridge между runtime и renderer.
- `apps/client` — schema-driven React UI, который получает control-сообщения и binary batches.
- `packages/core` — типы runtime-событий, plugin manifest, UI schema и binary UI wire.
- `packages/plugin-sdk` — API для plugin worker'ов.
- `packages/plugins-fake` — demo/replay плагины и процессоры.
- `packages/plugins-ui-gateway` — материализация runtime-событий в UI schema/control/binary поток.
- `packages/client-runtime` — буферы и browser-side runtime для графиков и флагов.

## Как запускать

```bash
npm install
npm run dev
```

Полезные команды:

- `npm run dev` — Vite renderer + Electron desktop.
- `npm run dev:runtime` — runtime отдельно, без desktop shell.
- `npm run build` — сборка всех workspace-пакетов.
- `npm run test` — тесты по workspace'ам.

## Как устроена документация

- У каждого рабочего модуля есть свой `README.md`.
- Перед работой в подпапке нужно читать ближайший `README.md`.
- Если поведение папки меняется, её `README.md` должен меняться вместе с кодом.

Индекс модулей:

- [apps/README.md](/Users/tascan/Documents/sirius/sensync2/apps/README.md)
- [packages/README.md](/Users/tascan/Documents/sirius/sensync2/packages/README.md)
- [scripts/README.md](/Users/tascan/Documents/sirius/sensync2/scripts/README.md)

Ключевые спецификации:

- [packages/core/CONTRACTS.md](/Users/tascan/Documents/sirius/sensync2/packages/core/CONTRACTS.md)
- [packages/plugins-ui-gateway/SCHEMA.md](/Users/tascan/Documents/sirius/sensync2/packages/plugins-ui-gateway/SCHEMA.md)
- [packages/plugins-fake/REPLAY_FORMAT.md](/Users/tascan/Documents/sirius/sensync2/packages/plugins-fake/REPLAY_FORMAT.md)

## Текущий статус `v1`

- В качестве demo-источника используется replay bundle из `test.h5`, сконвертированный в `test.replay/`.
- Дефолтный runtime поднимает replay-адаптер и `ui-gateway`.
- UI пока строится не из shared memory, а из `JSON control + binary frames` поверх Electron IPC.
- Система уже опирается на относительное время сессии (`session time`), а не на wall-clock как источник истины для data-path.
