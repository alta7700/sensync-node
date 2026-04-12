# scripts

Служебные скрипты репозитория.

## Для чего

- Здесь лежат утилиты smoke/bench и вспомогательные преобразования, которые не должны попадать в runtime или UI.

## Как работает

- `smoke_hdf5_recorder.ts` поднимает runtime без UI и проверяет запись fake-данных в новый HDF5 формат.
- `smoke_fake_profile.ts` проверяет, что launch profile `fake` реально стартует через profile registry, materialize'ит fake schema и отдаёт live stream'ы в UI.
- `smoke_fake_hdf5_simulation.ts` проверяет переходный профиль `fake-hdf5-simulation`: fake-графики и simulation-источник из HDF5.
- `probe_ant_plus.ts` открывает ANT+ stick, переводит его в scan mode и печатает:
  - первые raw extended frames;
  - `deviceId`, `deviceType` и `transmissionType` из эфира;
  - snapshot'ы от известных ANT+ scanner-классов, если устройство совпадает со стандартным профилем.
  - служебные heartbeat-сообщения раз в секунду, чтобы было видно, где probe ждёт.
- `generate_compute_proto.sh` генерирует shared protobuf-артефакты для `plugin-kit/ipc-worker` и автоматически обходит все `packages/*/proto`, чтобы собрать локальные protobuf-артефакты для Python-backed processor'ов без ручного списка `.proto`.
- На уровне корня репозитория эти сценарии агрегируются командами `npm run smoke` и `npm run verify`.
- `tsconfig.json` закрепляет для IDE и локального `tsc` тот же TypeScript-контекст, что используют runtime-пакеты, чтобы smoke-скрипты не жили в inferred project с ложными ошибками по модульному резолвингу.

## Взаимодействие

- Скрипты используют `apps/runtime` и плагины из `packages/plugins-fake`, `packages/plugins-hdf5`, `packages/plugins-ui-gateway`.
- Скрипт генерации compute proto использует глобальный `protoc`, локальный `uv` project из `packages/plugin-kit/python-runtime` и `ts-proto`.
- Они не описывают runtime-контракты сами по себе, а только проверяют, что текущие контракты действительно работают вместе.
