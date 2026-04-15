# apps/desktop

Electron shell для локального desktop-запуска `sensync2`.

`desktop` не завязан только на macOS arm64: базовый сценарий запуска через `fake` профиль рассчитан на кроссплатформенный старт, включая Windows x64. Для live-профилей с реальным BLE/ANT+ железом ограничения могут оставаться на стороне драйверов и устройств.

## Для чего

- Собирает runtime и renderer в одно desktop-приложение.
- Держит IPC boundary между UI и backend.
- Убирает необходимость в отдельном HTTP/WS сервере для `v1`.

## Как работает

- `main.ts` поднимает `RuntimeHost`, настраивает IPC и открывает окно BrowserWindow.
- Профиль runtime выбирается через `SENSYNC2_PROFILE`.
- Для `fake-hdf5-simulation` main process не подбирает файл автоматически: путь должен прийти через `SENSYNC2_HDF5_SIMULATION_FILE`.
- Для `pedaling-emg-replay` main process тоже не подбирает файл автоматически: путь приходит из UI через `adapter.connect.request.formData.filePath`.
- Относительный путь для `SENSYNC2_HDF5_SIMULATION_FILE` интерпретируется от корня `sensync2`, а не от `apps/desktop`.
- `preload.cjs` публикует минимальный безопасный bridge в renderer, включая transport-методы и path-picker для локальных форм.
- В dev-режиме ждёт готовности Vite-сервера и только потом грузит renderer URL.
- Главное окно теперь фиксирует минимальный размер, чтобы declarative UI-layout не деградировал при ручном сужении окна.

## Взаимодействие

- Использует `@sensync2/runtime` как встроенный backend.
- Отдаёт control/binary поток в `apps/client`.
- Преобразует `UiCommandMessage` из renderer обратно в команды runtime.
