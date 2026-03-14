import type { RuntimeEventMapCodegenSpec } from '@sensync2/core';

export const hdf5RuntimeEventMapSpec: RuntimeEventMapCodegenSpec = {
  moduleToAugment: '@sensync2/core',
  coreImportPath: '@sensync2/core',
  outputFilePath: 'packages/plugins-hdf5/src/generated-runtime-event-map.ts',
  entries: [
    {
      alias: 'Hdf5SimulationTickEvent',
      mode: 'compose',
      envelope: 'fact',
      type: 'hdf5.simulation.tick',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { kind: 'inline', typeText: 'Record<string, never>' },
    },
  ],
};
