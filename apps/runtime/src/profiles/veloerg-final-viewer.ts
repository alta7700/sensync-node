import { buildVeloergFinalViewerUiSchema } from '@sensync2/plugins-ui-gateway';
import { moduleFileUrl } from '../launch-profile-boundary.ts';
import { makeUiGatewayDescriptor } from './shared.ts';
import type { LaunchProfileDefinition } from './types.ts';

const VeloergFinalViewerStreamIds = [
  'moxy.smo2',
  'train.red.smo2',
  'train.red.hbdiff',
  'train.red.smo2.unfiltered',
  'train.red.o2hb.unfiltered',
  'train.red.hhb.unfiltered',
  'train.red.thb.unfiltered',
  'train.red.hbdiff.unfiltered',
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
  'lactate',
] as const;

export const veloergFinalViewerProfile: LaunchProfileDefinition = {
  id: 'veloerg-final-viewer',
  title: 'Veloerg final viewer',
  resolve() {
    return {
      id: 'veloerg-final-viewer',
      title: 'Veloerg final viewer',
      plugins: [
        {
          id: 'hdf5-viewer-adapter',
          modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-viewer-adapter.ts'),
          config: {
            adapterId: 'veloerg-final-viewer',
            allowConnectFilePathOverride: true,
            streamIds: [...VeloergFinalViewerStreamIds],
            requireAllStreamIds: true,
            readChunkSamples: 4096,
          },
        },
        makeUiGatewayDescriptor(buildVeloergFinalViewerUiSchema()),
      ],
    };
  },
};
