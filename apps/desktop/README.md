# apps/desktop

Electron shell для локального desktop-запуска `sensync2`.

## Для чего

- Собирает runtime и renderer в одно desktop-приложение.
- Держит IPC boundary между UI и backend.
- Убирает необходимость в отдельном HTTP/WS сервере для `v1`.

## Как работает

- `main.ts` поднимает `RuntimeHost`, настраивает IPC и открывает окно BrowserWindow.
- Профиль runtime выбирается через `SENSYNC2_PROFILE`.
- Для `fake-hdf5-simulation` main process не подбирает файл автоматически: путь должен прийти через `SENSYNC2_HDF5_SIMULATION_FILE`.
- Относительный путь для `SENSYNC2_HDF5_SIMULATION_FILE` интерпретируется от корня `sensync2`, а не от `apps/desktop`.
- `preload.cjs` публикует минимальный безопасный bridge в renderer.
- В dev-режиме ждёт готовности Vite-сервера и только потом грузит renderer URL.

## Взаимодействие

- Использует `@sensync2/runtime` как встроенный backend.
- Отдаёт control/binary поток в `apps/client`.
- Преобразует `UiCommandMessage` из renderer обратно в команды runtime.
