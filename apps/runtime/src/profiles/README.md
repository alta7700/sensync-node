# apps/runtime/src/profiles

Launch profiles как отдельные композиционные модули.

## Для чего

- Здесь живёт source of truth для профилей запуска runtime.
- Один профиль собирает в одном месте plugin composition, profile-specific env overrides и готовую `UiSchema` для `ui-gateway`.

## Как работает

- `types.ts` — типы `LaunchProfile`, `LaunchProfileDefinition` и `ResolvedLaunchProfile`.
- `index.ts` — registry профилей и thin API `resolveLaunchProfile(...)`, `buildLaunchProfile(...)`, `resolveLaunchProfileDefinition(...)`.
- `fake.ts`, `fake-hdf5-simulation.ts`, `veloerg.ts` — отдельные модули профилей.
- `shared.ts` — общие helper'ы композиции, чтобы не дублировать descriptor `ui-gateway`.

## Взаимодействие

- Использует `launch-profile-boundary.ts` для env/file overrides.
- Использует schema builders из `packages/plugins-ui-gateway/src/profile-schemas.ts`.
- `veloerg` дополнительно собирает generic `hr-from-rr-processor`, который превращает `zephyr.rr` в derived `zephyr.hr`.
- Точки входа `apps/runtime/src/main.ts` и `apps/desktop/src/main.ts` работают уже с `ResolvedLaunchProfile`, а не с ручным switch по строке профиля.
