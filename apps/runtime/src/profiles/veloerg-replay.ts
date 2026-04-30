import { buildVeloergReplayUiSchema } from '@sensync2/plugins-ui-gateway';
import { moduleFileUrl } from '../launch-profile-boundary.ts';
import { makeUiGatewayDescriptor } from './shared.ts';
import type { LaunchProfileDefinition } from './types.ts';

const VeloergReplayStreamIds = [
  'moxy.smo2',
  'moxy.thb',
  'zephyr.rr',
  'zephyr.hr',
  'zephyr.dfa_a1',
  'trigno.vl.avanti',
  'trigno.vl.avanti.gyro.x',
  'trigno.vl.avanti.gyro.y',
  'trigno.vl.avanti.gyro.z',
  'trigno.rf.avanti',
  'trigno.rf.avanti.gyro.x',
  'trigno.rf.avanti.gyro.y',
  'trigno.rf.avanti.gyro.z',
  'power.label',
] as const;

export const veloergReplayProfile: LaunchProfileDefinition = {
  id: 'veloerg-replay',
  title: 'Veloerg replay',
  resolve() {
    return {
      id: 'veloerg-replay',
      title: 'Veloerg replay',
      plugins: [
        {
          id: 'hdf5-simulation-adapter',
          modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-simulation-adapter.ts'),
          config: {
            adapterId: 'veloerg-replay',
            allowConnectFilePathOverride: true,
            streamIds: [...VeloergReplayStreamIds],
            requireAllStreamIds: true,
            batchMs: 50,
            speed: 1,
            readChunkSamples: 4096,
          },
        },
        makeUiGatewayDescriptor(buildVeloergReplayUiSchema()),
      ],
    };
  },
};
