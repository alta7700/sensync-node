# packages/plugins-processor-dfa-a1/src

Исходники worker-плагина `dfa-a1-from-rr`.

## Для чего

- Папка собирает lifecycle processor'а, локальную window/cadence логику и TS-обвязку вокруг Python compute-worker.

## Как работает

- `dfa-a1-from-rr.ts` держит окно RR и решает, когда нужно пересчитать DFA.
- По умолчанию scheduler работает на time-based окне `120 s` с шагом `5 s`; count-based режим используется только как явный override в конфиге.
- `dfa-a1-from-rr-processor.ts` управляет input runtime, IPC worker и emit результата.
- `generated/` содержит TS-артефакты protobuf codegen для локального DFA-контракта.

## Взаимодействие

- Processor использует `@sensync2/plugin-kit/ipc-worker` как transport/process helper.
- Python worker использует тот же контракт и публикует один `alpha1` на конец окна.
