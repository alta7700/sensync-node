import { buildVeloergViewerUiSchema } from '@sensync2/plugins-ui-gateway';
import { moduleFileUrl } from '../launch-profile-boundary.ts';
import { makeUiGatewayDescriptor } from './shared.ts';
import type { LaunchProfileDefinition } from './types.ts';

const VeloergViewerStreamIds = [
  'moxy.smo2',
  'moxy.thb',
  'zephyr.rr',
  'zephyr.hr',
  'zephyr.dfa_a1',
  'trigno.avanti',
  'trigno.avanti.gyro.x',
  'trigno.avanti.gyro.y',
  'trigno.avanti.gyro.z',
  'lactate.label',
  'power.label',
] as const;

export const veloergViewerProfile: LaunchProfileDefinition = {
  id: 'veloerg-viewer',
  title: 'Veloerg viewer',
  resolve() {
    return {
      id: 'veloerg-viewer',
      title: 'Veloerg viewer',
      plugins: [
        {
          id: 'hdf5-viewer-adapter',
          modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-viewer-adapter.ts'),
          config: {
            adapterId: 'veloerg-viewer',
            allowConnectFilePathOverride: true,
            streamIds: [...VeloergViewerStreamIds],
            readChunkSamples: 4096,
          },
        },
        makeUiGatewayDescriptor(buildVeloergViewerUiSchema()),
      ],
    };
  },
};
