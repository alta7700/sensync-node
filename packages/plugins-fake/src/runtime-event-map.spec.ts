import type { RuntimeEventMapCodegenSpec } from '@sensync2/core';

export const fakeRuntimeEventMapSpec: RuntimeEventMapCodegenSpec = {
  moduleToAugment: '@sensync2/core',
  coreImportPath: '@sensync2/core',
  outputFilePath: 'packages/plugins-fake/src/generated-runtime-event-map.ts',
  entries: [
    {
      alias: 'FakeSchedulerTickEvent',
      mode: 'compose',
      envelope: 'fact',
      type: 'fake.scheduler.tick',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { kind: 'inline', typeText: 'Record<string, never>' },
    },
    {
      alias: 'ShapeSchedulerTickEvent',
      mode: 'compose',
      envelope: 'fact',
      type: 'shape.scheduler.tick',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { kind: 'inline', typeText: 'Record<string, never>' },
    },
    {
      alias: 'RollingMinFlushEvent',
      mode: 'compose',
      envelope: 'fact',
      type: 'processor.rolling-min.flush',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { kind: 'inline', typeText: 'Record<string, never>' },
    },
    {
      alias: 'MetricValueChangedEvent',
      mode: 'compose',
      envelope: 'fact',
      type: 'metric.value.changed',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { kind: 'inline', typeText: '{ key: string; value: number }' },
    },
  ],
};
