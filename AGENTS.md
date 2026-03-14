# AGENTS.md

Инструкции для работы с кодовой базой `sensync2`.

## Общие правила

- Все пояснения, комментарии в коде и документацию писать на русском языке.
- По умолчанию оставлять короткие комментарии в местах нетривиальной логики.
- Не принимать архитектурные решения по инерции: если идея спорная, сначала проверить её на совместимость с текущей моделью `runtime -> plugins -> ui-gateway -> client-runtime`.

## Правило README

- Модулем считается любая рабочая папка проекта, относящаяся к исходному коду, контрактам, рантайму или служебным скриптам.
- Перед работой в папке нужно прочитать ближайший `README.md`: сначала в самой папке, если его нет, то в ближайшем родителе внутри репозитория.
- Если изменения меняют поведение, публичный контракт, состав файлов или роль папки, `README.md` этой папки нужно обновить в том же изменении.
- Если у рабочей папки нет `README.md`, его нужно создать минимум с тремя пунктами:
  - для чего нужна папка;
  - как она работает;
  - как взаимодействует с остальными модулями.
- Если папка содержит межмодульный контракт или схему, одного `README.md` недостаточно:
  - для контрактов добавлять `CONTRACTS.md`;
  - для конкретных materialized схем добавлять `SCHEMA.md`;
  - для форматов данных добавлять отдельный файл вроде `HDF5_FORMAT.md`.
- Если меняется внешний ingress, зона доверия или boundary между внешними данными и runtime bus, нужно обновлять [BOUNDARIES.md](BOUNDARIES.md).

## Что не считать модулем

- Не документировать как модули служебные и генерируемые директории:
  - `node_modules/`
  - `dist/`
  - `.git/`
  - `.idea/`
  - build-артефакты и кэши (`*.tsbuildinfo`, временные JS/DTS артефакты рядом с TS-файлами)
- `recordings/` считать артефактом данных, а не исходным кодом. Его содержимое не редактируется вручную и не должно использоваться как скрытая часть runtime-контракта.

## Архитектурный фокус

- Основная система находится в `apps/` и `packages/`.
- `apps/runtime` — event-driven runtime и хост plugin worker'ов.
- `packages/core` — общие контракты событий, UI-схем и wire-форматов.
- `packages/plugin-sdk` — API и bootstrap для worker-плагинов.
- `packages/plugins-*` — доменная логика, которая должна оставаться вне ядра.
- `packages/client-runtime` — materialization слоя UI на стороне renderer.
- `apps/desktop` — Electron shell, который соединяет renderer и runtime через IPC.
- `apps/client` — React renderer, который читает только schema/control/binary поток.

## Практические правила

- При изменении контрактов в `packages/core` проверять все зависимые модули:
  - `packages/plugin-sdk`
  - `packages/client-runtime`
  - `packages/plugins-fake`
  - `packages/plugins-hdf5`
  - `packages/plugins-ui-gateway`
  - `apps/runtime`
  - `apps/client`
  - `apps/desktop`
- При изменении контрактов в `packages/core` обновлять [packages/core/CONTRACTS.md](packages/core/CONTRACTS.md).
- При изменении materialized UI-схемы `ui-gateway` обновлять [packages/plugins-ui-gateway/SCHEMA.md](packages/plugins-ui-gateway/SCHEMA.md).
- При изменении HDF5 on-disk формата или семантики симуляции обновлять [packages/plugins-hdf5/HDF5_FORMAT.md](packages/plugins-hdf5/HDF5_FORMAT.md).
- Если меняется способ запуска, обновлять корневой `README.md` и README затронутого `app`.
- Если меняется дефолтная demo-конфигурация или источник данных профиля, обновлять:
  - `apps/runtime/README.md`
  - `packages/plugins-fake/README.md`
  - `packages/plugins-hdf5/README.md`
  - `scripts/README.md`
