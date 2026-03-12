# sensync2

`sensync2` — новая кодовая база для event-driven обработки физиологических данных. Текущий `v1` собран вокруг Electron-приложения, в котором Node runtime, plugin workers и React renderer живут в одном desktop-процессе, но остаются разделёнными по контрактам.

## Что здесь есть

- `apps/runtime` — минимальное ядро: маршрутизация событий, очереди, plugin workers, lifecycle и telemetry.
- `apps/desktop` — Electron main process и IPC bridge между runtime и renderer.
- `apps/client` — schema-driven React UI, который получает control-сообщения и binary batches.
- `packages/core` — типы runtime-событий, plugin manifest, UI schema и binary UI wire.
- `packages/plugin-sdk` — API для plugin worker'ов.
- `packages/plugins-fake` — synthetic demo-плагины и процессоры.
- `packages/plugins-hdf5` — recorder-плагин и прямой simulation-адаптер для нового HDF5 формата.
- `packages/plugins-ui-gateway` — материализация runtime-событий в UI schema/control/binary поток.
- `packages/client-runtime` — буферы и browser-side runtime для графиков и флагов.

## Как запускать

```bash
npm install
npm run dev
```

Полезные команды:

- `npm run dev` — запускает desktop c профилем `fake`.
- `npm run dev:fake` — явный запуск fake-профиля.
- `npm run dev:fake-hdf5-simulation` — переходный профиль: fake-UI поверх `hdf5-simulation` источника.
- `npm run dev:runtime` — runtime отдельно, по умолчанию в профиле `fake`.
- `npm run dev:runtime:fake-hdf5-simulation` — standalone runtime для fake simulation из HDF5.
- `npm run build` — сборка всех workspace-пакетов.
- `npm run test` — тесты по workspace'ам.
- `npm run smoke:hdf5-recorder` — smoke без UI для recorder-плагина.
- `npm run smoke:fake-hdf5-simulation` — smoke без UI для fake-ориентированной HDF5 simulation.

## Launch profiles

Сейчас есть два штатных профиля запуска:

- `fake`
  - synthetic fake adapter;
  - shape generator;
  - interval labels;
  - demo processors;
  - `hdf5-recorder`;
  - `ui-gateway` с fake-схемой.
- `fake-hdf5-simulation`
  - `hdf5-simulation-adapter`, но только для fake-каналов;
  - `ui-gateway` с отдельной fake-oriented simulation-схемой.

Профиль выбирается через `SENSYNC2_PROFILE`, а npm-скрипты просто подставляют это значение явно.

Для `fake-hdf5-simulation` нужно отдельно задать путь к файлу:

```bash
SENSYNC2_HDF5_SIMULATION_FILE=/absolute/path/to/file.h5 npm run dev:fake-hdf5-simulation
```

Допускается и относительный путь: он будет резолвиться от корня репозитория `sensync2`, а не от `apps/desktop`.

Это осознанно: профиль не должен подменять реальный источник скрытым demo-файлом.

## Как устроена документация

- У каждого рабочего модуля есть свой `README.md`.
- Перед работой в подпапке нужно читать ближайший `README.md`.
- Если поведение папки меняется, её `README.md` должен меняться вместе с кодом.

Индекс модулей:

- [apps/README.md](apps/README.md)
- [packages/README.md](packages/README.md)
- [scripts/README.md](scripts/README.md)

Ключевые спецификации:

- [packages/core/CONTRACTS.md](packages/core/CONTRACTS.md)
- [packages/plugins-hdf5/HDF5_FORMAT.md](packages/plugins-hdf5/HDF5_FORMAT.md)
- [packages/plugins-ui-gateway/SCHEMA.md](packages/plugins-ui-gateway/SCHEMA.md)

## Текущий статус `v1`

- Дефолтный dev-профиль — `fake`, потому что он быстрее проверяет runtime, UI и recorder без привязки к конкретному тестовому файлу.
- Отдельный профиль `fake-hdf5-simulation` проигрывает уже записанные fake-каналы напрямую из нового HDF5 формата и не использует replay bundle.
- UI пока строится не из shared memory, а из `JSON control + binary frames` поверх Electron IPC.
- Система уже опирается на относительное время сессии (`session time`), а не на wall-clock как источник истины для data-path.
