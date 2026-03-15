# План: улучшение test coverage

## Кратко

Цель: поднять покрытие тестами в `sensync2` не равномерно по всему monorepo, а сначала в критичных пакетах data-path и runtime boundary.

Текущий baseline снимается командой:

```bash
npm run coverage
```

На текущем этапе coverage уже считается через `Vitest V8`, но качество покрытия по пакетам сильно разное.

## Текущие приоритеты

### 1. Критичный контур runtime/data-path

Сначала поднимать покрытие там, где ошибка ломает весь runtime или искажает данные:

- `packages/core`
- `packages/plugin-sdk`
- `packages/client-runtime`
- `packages/plugins-hdf5`

Фокус тестов:

- event contracts и helper'ы boundary-слоя;
- worker lifecycle и timer path в `plugin-sdk`;
- decode/materialization path в `client-runtime`;
- `hdf5-recorder` и `hdf5-simulation-adapter`, а не только boundary.

Цель этапа:

- убрать почти нулевое покрытие в `core`, `plugin-sdk`, `client-runtime`;
- довести `plugins-hdf5` хотя бы до уверенного unit/integration уровня.

### 2. Device/adapter слой

После этого добивать пакеты, где логика уже partially covered, но остаются большие зоны real/fake transport orchestration:

- `apps/runtime`
- `packages/plugins-ant-plus`
- `packages/plugins-ble`

Фокус тестов:

- runtime host error/queue/warning path;
- reconnect/autoconnect/device lifecycle;
- fake/real transport switching;
- profile-specific wiring, если оно не покрыто smoke.

### 3. UI shell и низкий приоритет

Последними закрывать оболочки, которые сейчас почти не тестируются:

- `apps/desktop`
- `apps/client`
- `packages/devtools`

Фокус тестов:

- Electron entrypoint и IPC bootstrap;
- минимальные renderer smoke/logic tests;
- devtools только по мере появления реальной логики.

## Практический путь

1. Держать `npm run coverage` как обязательный локальный инструмент перед крупным merge.
2. Для каждого слабого пакета сначала добавить 2-3 теста на самые рискованные ветки, а не пытаться сразу “набить проценты”.
3. Новые helper'ы и boundary-модули не оставлять без unit-тестов в том же изменении.
4. Smoke не подменяют unit coverage:
   - smoke защищает связность сценария;
   - unit/integration тесты защищают локальную логику ветвлений и ошибок.

## Минимальные целевые ориентиры

Не как жёсткий gate, а как practical target на ближайшие этапы:

- `packages/plugin-kit`: удерживать текущий высокий coverage
- `packages/core`: вывести из однозначно низкой зоны
- `packages/plugin-sdk`: вывести из нулевой зоны
- `packages/client-runtime`: вывести из нулевой зоны
- `packages/plugins-hdf5`: заметно поднять относительно текущего baseline

## Что пока не делаем

- не вводим жёсткие coverage thresholds в CI прямо сейчас;
- не строим merged monorepo coverage report как обязательный gate;
- не пишем тесты ради процентов на файлы-заглушки и re-export entrypoints.
