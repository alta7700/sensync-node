# packages/plugins-processor-pedaling-emg/python_worker

Python compute-worker для локальной `EMG`-обработки внутри `pedaling-emg` processor-а.

## Для чего

- Папка держит компактный sidecar-алгоритм, который получает только вырезанный `EMG`-сегмент и возвращает onset/offset/confidence.

## Как работает

- `main.py` поднимает стандартный request/response loop через shared runtime из `packages/plugin-kit/python-runtime`.
- `compute.py` реализует плотную обработку короткого сегмента: band-pass, envelope/RMS, baseline и threshold logic.

## Взаимодействие

- Пакет не управляет своим Python-окружением напрямую и использует shared `uv run --project` runtime.
- Generated protobuf-модули лежат в `generated/`.
