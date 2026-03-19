# packages/plugins-processor-pedaling-emg

Generic processor для грубой фазовой сегментации педалирования по `gyro` и детекции мышечной активности по `EMG`.

## Для чего

- Пакет публикует worker-плагин `pedaling-emg-processor`.
- Он оставляет потоковую фазовую логику в `TypeScript`, а плотную обработку коротких `EMG`-сегментов выносит в Python compute-worker.
- Код processor-а не зашивает конкретную мышцу, но профиль `veloerg` может использовать его для сценария `vastus lateralis`.

## Как работает

- `TypeScript`-часть подписывается на `gyro.x/y/z` и `EMG`, выбирает устойчивую ось, ловит циклы по zero-crossing и вырезает короткий `EMG`-сегмент вокруг ожидаемого фазового окна.
- `Python`-часть получает только компактный сегмент, делает band-pass, rectification, envelope/RMS и возвращает onset/offset + confidence.
- Если Python worker недоступен или мягко деградировал, фазовый слой всё равно продолжает публиковать `phase` и `phaseConfidence`, а `EMG`-ветка принудительно уходит в `activity=0` и `emgConfidence=0`.
- В `Python` отправляется только полностью покрытое окно `EMG`; усечённые сегменты после старта, `timeline reset` или skew между потоками отбрасываются ещё в `TypeScript`.
- Публичные выходы processor-а:
  - `label-batch` для грубой фазы;
  - `label-batch` для мышечной активности;
  - irregular signals для `phaseConfidence`, `emgConfidence` и `cyclePeriodMs`.
- Промежуточный вырезанный `EMG`-сегмент остаётся внутренним вычислительным артефактом и не публикуется в runtime bus.

## Взаимодействие

- Пакет использует `@sensync2/plugin-kit` для subscriptions, emit path, timeline reset и `ipc-worker`.
- Профиль runtime задаёт входные/выходные `streamId`, фазовое окно и конфиг запуска Python worker.
- Источники по алгоритму и выбранным default'ам зафиксированы в [ALGORITHM.md](/Users/tascan/Documents/sirius/sensync2/packages/plugins-processor-pedaling-emg/ALGORITHM.md).
