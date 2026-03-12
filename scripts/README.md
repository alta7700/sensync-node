# scripts

Служебные скрипты репозитория.

## Для чего

- Здесь лежат утилиты smoke/bench и вспомогательные преобразования, которые не должны попадать в runtime или UI.

## Как работает

- `smoke_hdf5_recorder.ts` поднимает runtime без UI и проверяет запись fake-данных в новый HDF5 формат.
- `smoke_fake_hdf5_simulation.ts` проверяет переходный профиль `fake-hdf5-simulation`: fake-графики и simulation-источник из HDF5.
- `tsconfig.json` закрепляет для IDE и локального `tsc` тот же TypeScript-контекст, что используют runtime-пакеты, чтобы smoke-скрипты не жили в inferred project с ложными ошибками по модульному резолвингу.

## Взаимодействие

- Скрипты используют `apps/runtime` и плагины из `packages/plugins-fake`, `packages/plugins-hdf5`, `packages/plugins-ui-gateway`.
- Они не описывают runtime-контракты сами по себе, а только проверяют, что текущие контракты действительно работают вместе.
