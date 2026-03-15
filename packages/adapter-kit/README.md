# packages/adapter-kit

Переиспользуемые helper'ы для runtime-адаптеров.

## Для чего

- Пакет даёт небольшой набор adapter-oriented утилит поверх `@sensync2/plugin-sdk`.
- Он убирает повторение в lifecycle, output mapping, `uniform/irregular signal.batch`, autoconnect, scan cache и reconnect backoff.
- Пакет не превращается в общий device framework и не заменяет transport/boundary код конкретных plugin-пакетов.

## Как работает

- `adapter-state-holder` хранит runtime-state адаптера, эмитит `adapter.state.changed` и даёт базовые guard'ы.
- `output-map` нормализует декларативный словарь outputs до валидированных descriptor'ов.
- `signal-emit` создаёт `uniform` и `irregular signal.batch` и выводит `sampleFormat` из typed array.
- `autoconnect-policy`, `scan-flow` и `reconnect-policy` дают изолированные helpers, которые можно подключать по отдельности.
- `autoconnect-policy` только принимает и исполняет решение автоподключения; сам запуск нужно привязывать к безопасной lifecycle-точке, обычно к `runtime.started`, а не к `onInit()`.

## Взаимодействие

- Пакет зависит только от `@sensync2/core` и `@sensync2/plugin-sdk`.
- Его используют adapter-плагины из `packages/plugins-*`.
- UI schema, device transport и boundary-валидация остаются вне этого пакета.
