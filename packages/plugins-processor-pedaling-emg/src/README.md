# packages/plugins-processor-pedaling-emg/src

Исходники worker-плагина `pedaling-emg`.

## Для чего

- Здесь живут TS-компоненты фазового трекера, буферизации `EMG` и runtime integration.

## Как работает

- `pedaling-emg.ts` содержит внутренние stateful helper'ы processor-а.
- `pedaling-emg-codec.ts` кодирует/декодирует protobuf payload для Python worker.
- `pedaling-emg-processor.ts` собирает всё в один plugin module.

## Взаимодействие

- Папка зависит от `@sensync2/plugin-kit/ipc-worker`, но не знает про packaged sidecar boundary приложения.
- Входные и выходные `streamId` полностью приходят из конфигурации профиля.
