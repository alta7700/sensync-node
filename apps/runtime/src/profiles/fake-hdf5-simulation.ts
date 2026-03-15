import { buildFakeHdf5SimulationUiSchema } from '@sensync2/plugins-ui-gateway';
import {
  moduleFileUrl,
  readFakeHdf5SimulationEnvOverrides,
} from '../launch-profile-boundary.ts';
import { makeUiGatewayDescriptor } from './shared.ts';
import type { LaunchProfileDefinition } from './types.ts';

const FakeSimulationStreamIds = ['fake.a1', 'fake.a2', 'fake.b', 'shapes.signal', 'interval.label', 'activity.label'] as const;

export const fakeHdf5SimulationProfile: LaunchProfileDefinition = {
  id: 'fake-hdf5-simulation',
  title: 'Fake HDF5 simulation',
  resolve(context) {
    const envOverrides = readFakeHdf5SimulationEnvOverrides(context.env);
    return {
      id: 'fake-hdf5-simulation',
      title: 'Fake HDF5 simulation',
      plugins: [
        {
          id: 'hdf5-simulation-adapter',
          modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-simulation-adapter.ts'),
          config: {
            adapterId: 'fake-hdf5-simulation',
            filePath: envOverrides.filePath,
            streamIds: [...FakeSimulationStreamIds],
            batchMs: envOverrides.batchMs,
            speed: envOverrides.speed,
            readChunkSamples: envOverrides.readChunkSamples,
          },
        },
        makeUiGatewayDescriptor(buildFakeHdf5SimulationUiSchema()),
      ],
    };
  },
};
