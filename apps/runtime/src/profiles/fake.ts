import * as path from 'node:path';
import { buildFakeUiSchema } from '@sensync2/plugins-ui-gateway';
import { moduleFileUrl, runtimeRepoRoot } from '../launch-profile-boundary.ts';
import { makeUiGatewayDescriptor } from './shared.ts';
import type { LaunchProfileDefinition } from './types.ts';

export const fakeProfile: LaunchProfileDefinition = {
  id: 'fake',
  title: 'Fake demo',
  resolve() {
    return {
      id: 'fake',
      title: 'Fake demo',
      plugins: [
        {
          id: 'fake-signal-adapter',
          modulePath: moduleFileUrl('packages/plugins-fake/src/fake-signal-adapter.ts'),
          config: {
            sampleRateHz: 200,
            batchMs: 50,
            compareSampleRateHz: 200,
            compareBatchMs: 50,
          },
        },
        {
          id: 'shape-generator-adapter',
          modulePath: moduleFileUrl('packages/plugins-fake/src/shape-generator-adapter.ts'),
          config: {
            sampleRateHz: 200,
            batchMs: 50,
          },
        },
        {
          id: 'interval-label-adapter',
          modulePath: moduleFileUrl('packages/plugins-fake/src/interval-label-adapter.ts'),
          config: {},
        },
        {
          id: 'rolling-min-processor',
          modulePath: moduleFileUrl('packages/plugins-fake/src/rolling-min-processor.ts'),
          config: {
            sourceStreamId: 'fake.a2',
            outputStreamId: 'metrics.fake.a2.rolling_min_1s',
          },
        },
        {
          id: 'activity-detector-processor',
          modulePath: moduleFileUrl('packages/plugins-fake/src/activity-detector-processor.ts'),
          config: {
            sourceStreamId: 'shapes.signal',
            threshold: 0.6,
          },
        },
        {
          id: 'hdf5-recorder',
          modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-recorder-plugin.ts'),
          config: {
            writerKey: 'local',
            outputDir: path.join(runtimeRepoRoot, 'recordings/fake'),
            defaultFilenameTemplate: '{writer}-{startDateTime}',
          },
        },
        makeUiGatewayDescriptor(buildFakeUiSchema()),
      ],
    };
  },
};
