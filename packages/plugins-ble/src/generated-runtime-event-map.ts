// Этот файл сгенерирован `npm run generate:runtime-event-map`.
// Не редактируй его вручную: править нужно *.spec.ts и генератор.

import type { FactEvent, RuntimeEventMap } from '@sensync2/core';

export type ZephyrBioHarnessPollEvent = FactEvent<Record<string, never>, 'zephyr-bioharness.poll'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

declare module '@sensync2/core' {
  interface RuntimeEventMap {
    'zephyr-bioharness.poll@1': ZephyrBioHarnessPollEvent;
  }
}

export {};
