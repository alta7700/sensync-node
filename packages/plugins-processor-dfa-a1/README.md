# packages/plugins-processor-dfa-a1

Generic processor для расчёта DFA-a1 по RR-интервалам через внешний Python compute-worker.

## Для чего

- Пакет держит device-agnostic worker-плагин `dfa-a1-from-rr-processor`.
- Здесь же лежат локальный `.proto` контракт, Python compute-worker и codegen-артефакты для DFA-a1.
- Отдельный файл [ALGORITHM.md](/Users/tascan/Documents/sirius/sensync2/packages/plugins-processor-dfa-a1/ALGORITHM.md) фиксирует источники и выбранные scientific defaults.

## Как работает

- TypeScript-часть держит окно RR, cadence пересчёта и emit результата.
- Сам расчёт DFA-a1 выполняет Python worker через `@sensync2/plugin-kit/ipc-worker`.
- Конфиг задаёт `sourceStreamId`, `outputStreamId`, параметры окна и boundary-конфиг запуска worker'а.
- Формула расчёта опирается на классический DFA для heartbeat time series:
  - интеграция ряда RR;
  - линейный detrending по окнам;
  - регрессия `log(F(n))` на `log(n)`;
  - short-term scale range по умолчанию `4..16`.
- Параметры `4..16` и логарифмическая сетка шкал согласованы с классическим PhysioNet DFA toolkit и современными open-source HRV toolbox'ами; при этом GUI-значения Kubios по умолчанию для `alpha1` уже, чем наш runtime default.
- Для live/exercise сценария дефолтный scheduler теперь time-based:
  - окно `120_000 ms`;
  - шаг пересчёта `5_000 ms`;
  - минимально `50` RR до первого расчёта.
- Count-based режим не удалён, но это уже explicit override для специальных сценариев, а не основной scientific default.

## Взаимодействие

- Профили runtime подключают processor как обычный worker-plugin.
- Пакет переиспользует shared Python runtime из `packages/plugin-kit/python-runtime`.
- Сам пакет не привязан к `Zephyr`: он работает с любым совместимым RR stream.
