// Этот файл сгенерирован `npm run generate:runtime-event-map`.
// Не редактируй его вручную: править нужно *.spec.ts и генератор.

import type { FactEvent, RuntimeEventMap } from '@sensync2/core';

export type Hdf5SimulationTickEvent = FactEvent<Record<string, never>, 'hdf5.simulation.tick'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

declare module '@sensync2/core' {
  interface RuntimeEventMap {
    'hdf5.simulation.tick@1': Hdf5SimulationTickEvent;
  }
}

export {};
