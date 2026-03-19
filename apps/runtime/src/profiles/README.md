# apps/runtime/src/profiles

Launch profiles как отдельные композиционные модули.

## Для чего

- Здесь живёт source of truth для профилей запуска runtime.
- Один профиль собирает в одном месте plugin composition, profile-specific env overrides и готовую `UiSchema` для `ui-gateway`.

## Как работает

- `types.ts` — типы `LaunchProfile`, `LaunchProfileDefinition` и `ResolvedLaunchProfile`.
- `ResolvedLaunchProfile` теперь может нести и `timelineReset` profile config.
- `index.ts` — registry профилей и thin API `resolveLaunchProfile(...)`, `buildLaunchProfile(...)`, `resolveLaunchProfileDefinition(...)`.
- `fake.ts`, `fake-hdf5-simulation.ts`, `veloerg.ts` — отдельные модули профилей.
- `shared.ts` — общие helper'ы композиции, чтобы не дублировать descriptor `ui-gateway`.

## Взаимодействие

- Использует `launch-profile-boundary.ts` для env/file overrides.
- Использует schema builders из `packages/plugins-ui-gateway/src/profile-schemas.ts`.
- `fake` теперь поднимает generic `label-generator-adapter`, который публикует `interval.label` по shared-команде `label.mark.request`.
- `fake` также включает profile-level `timelineReset`:
  - requester: `external-ui`;
  - participants: `ui-gateway`, fake adapters и первые processor'ы как явно описанный lifecycle/policy subset;
  - сам coordinator всё равно синхронизирует новый `timelineId` на все загруженные worker-плагины, чтобы non-participant emit path не зависал на старом timeline;
  - recorder policy: `reject-if-recording`.
- `veloerg` дополнительно собирает generic `hr-from-rr-processor` и `dfa-a1-from-rr-processor`, которые превращают `zephyr.rr` в derived `zephyr.hr` и `zephyr.dfa_a1`.
- `veloerg` также включает recorder-driven `timelineReset`:
  - requester: только `hdf5-recorder`;
  - participants: `ui-gateway`, live adapters, derived HR/DFA processors и recorder как явно описанный reset-aware subset;
  - `zephyr-bioharness-3-adapter`, `hr-from-rr-processor`, `dfa-a1-from-rr-processor` и `hdf5-recorder` получают `required` через config-dependent manifest;
  - recorder пишет в `recordings/veloerg` и использует `fact-field` preflight checks для ANT+, Zephyr и Trigno.
- Точки входа `apps/runtime/src/main.ts` и `apps/desktop/src/main.ts` работают уже с `ResolvedLaunchProfile`, а не с ручным switch по строке профиля.
