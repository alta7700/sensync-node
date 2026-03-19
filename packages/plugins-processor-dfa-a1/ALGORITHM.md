# DFA-a1: алгоритм и источники

Этот файл фиксирует, на какие источники опирается реализация `dfa-a1-from-rr-processor`
и какие инженерные решения приняты в `sensync2`.

## 1. Каноническая формула DFA

Базовая схема алгоритма взята из классического DFA:

1. интеграция ряда RR;
2. разбиение на окна фиксированного масштаба `n`;
3. detrending в каждом окне;
4. расчёт функции флуктуации `F(n)`;
5. регрессия `log(F(n))` на `log(n)` и взятие наклона.

Основные источники:

- Peng C-K, Buldyrev SV, Havlin S, Simons M, Stanley HE, Goldberger AL.
  Mosaic organization of DNA nucleotides. Phys Rev E. 1994.
- Peng C-K, Havlin S, Stanley HE, Goldberger AL.
  Quantification of scaling exponents and crossover phenomena in nonstationary heartbeat time series.
  Chaos. 1995.
- PhysioNet DFA toolkit:
  [https://www.physionet.org/content/dfa/1.0.0/](https://www.physionet.org/content/dfa/1.0.0/)

Важно:

- наша реализация считает `alpha1` для short-term scales;
- Python-реализация в
  [python_worker/compute.py](/Users/tascan/Documents/sirius/sensync2/packages/plugins-processor-dfa-a1/python_worker/compute.py)
  повторяет формулу legacy `sensync` и остаётся совместимой с классической схемой DFA для heartbeat time series.

## 2. Short-term scales для alpha1

Для `alpha1` в `sensync2` по умолчанию используется диапазон `4..16`.

Это решение опирается на открытые референсы, где именно этот диапазон используется
для short-term scaling:

- PhysioNet Cardiovascular Signal Toolbox benchmark:
  [https://www.physionet.org/files/pcst/1.0.0/An-Open-Source-Benchmarked-Toolbox-for-Cardiovascular-Waveform-and-Interval-Analysis.pdf?download=](https://www.physionet.org/files/pcst/1.0.0/An-Open-Source-Benchmarked-Toolbox-for-Cardiovascular-Waveform-and-Interval-Analysis.pdf?download=)
  В benchmark-таблице `alpha1` сравнивается по диапазону `4–16` для PhysioNet, PCST, Kubios и Kaplan.

Оговорка:

- Kubios GUI по умолчанию использует более узкий short-term диапазон `4–12`, а long-term `13–64`.
- Это не делает `4–16` неверным, но значит, что у разных инструментов есть разные product defaults.

Источник:

- Kubios HRV Users Guide 3.2:
  [https://www.kubios.com/downloads/Kubios_HRV_Users_Guide_3_2_0.pdf](https://www.kubios.com/downloads/Kubios_HRV_Users_Guide_3_2_0.pdf)

## 3. Сетка масштабов

Для набора шкал используется логарифмическая сетка с последующим приведением к уникальным целым значениям.

Это согласуется с практикой open-source реализаций DFA: масштабы не должны быть линейно распределены,
иначе большие окна получают непропорциональный вес в регрессии.

Источник:

- Nolds documentation:
  [https://nolds.readthedocs.io/_/downloads/en/0.5.2/pdf/](https://nolds.readthedocs.io/_/downloads/en/0.5.2/pdf/)

## 4. Окно и cadence для live/exercise use case

В `sensync2` дефолт для live processor'а сделан time-based:

- `windowDurationMs = 120_000`
- `recomputeEveryMs = 5_000`
- `minRrCount = 50`

Причина:

- для exercise/live сценариев time-varying DFA-a1 в литературе обычно обсуждается
  как rolling estimate по короткому временному окну, а не как чисто count-based вычисление;
- инженерно это лучше согласуется с live-графиком и повторяемостью cadence независимо от ЧСС.

При этом:

- count-based режим не удалён;
- он остаётся доступным как explicit override через `windowCount` и `recomputeEvery`.

## 5. Что является научным default в `sensync2`

На текущем этапе зафиксировано следующее:

- формула: классический DFA по Peng/PhysioNet;
- `alpha1` scales: `4..16`;
- live default window: `120 s`;
- live default recompute cadence: `5 s`;
- minimum RR count: `50`.

Это не означает, что в литературе существует один абсолютный глобальный стандарт для всех сценариев.
Это означает, что текущий default:

- не противоречит каноническому DFA;
- согласуется с открытыми HRV toolbox reference-реализациями;
- лучше подходит для live exercise use case, чем прежний дефолт `100 RR / every 5 beats`.
