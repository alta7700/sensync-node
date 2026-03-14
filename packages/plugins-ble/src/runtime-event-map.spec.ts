import type { RuntimeEventMapCodegenSpec } from '@sensync2/core';

export const bleRuntimeEventMapSpec: RuntimeEventMapCodegenSpec = {
  moduleToAugment: '@sensync2/core',
  coreImportPath: '@sensync2/core',
  outputFilePath: 'packages/plugins-ble/src/generated-runtime-event-map.ts',
  entries: [
    {
      alias: 'ZephyrBioHarnessPollEvent',
      mode: 'compose',
      envelope: 'fact',
      type: 'zephyr-bioharness.poll',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { kind: 'inline', typeText: 'Record<string, never>' },
    },
  ],
};
