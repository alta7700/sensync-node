import type { RuntimeEventMapCodegenSpec } from '@sensync2/core';

export const antPlusRuntimeEventMapSpec: RuntimeEventMapCodegenSpec = {
  moduleToAugment: '@sensync2/core',
  coreImportPath: '@sensync2/core',
  outputFilePath: 'packages/plugins-ant-plus/src/generated-runtime-event-map.ts',
  entries: [
    {
      alias: 'AntPlusPacketPollEvent',
      mode: 'compose',
      envelope: 'fact',
      type: 'ant-plus.packet.poll',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { kind: 'inline', typeText: 'Record<string, never>' },
    },
  ],
};
