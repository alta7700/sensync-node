import { buildVeloergUiSchema } from '@sensync2/plugins-ui-gateway';
import { moduleFileUrl } from '../launch-profile-boundary.ts';
import { makeUiGatewayDescriptor } from './shared.ts';
import type { LaunchProfileDefinition } from './types.ts';

export const veloergProfile: LaunchProfileDefinition = {
  id: 'veloerg',
  title: 'Veloerg live',
  resolve() {
    return {
      id: 'veloerg',
      title: 'Veloerg live',
      plugins: [
        {
          id: 'ant-plus-adapter',
          modulePath: moduleFileUrl('packages/plugins-ant-plus/src/ant-plus-adapter.ts'),
          config: {
            adapterId: 'ant-plus',
            mode: 'real',
          },
        },
        {
          id: 'zephyr-bioharness-3-adapter',
          modulePath: moduleFileUrl('packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts'),
          config: {
            adapterId: 'zephyr-bioharness',
            mode: 'real',
          },
        },
        {
          id: 'hr-from-rr-processor',
          modulePath: moduleFileUrl('packages/plugins-processors/src/hr-from-rr-processor.ts'),
          config: {
            sourceStreamId: 'zephyr.rr',
            outputStreamId: 'zephyr.hr',
          },
        },
        {
          id: 'trigno-adapter',
          modulePath: moduleFileUrl('packages/plugins-trigno/src/trigno-adapter.ts'),
          config: {
            adapterId: 'trigno',
            mode: 'real',
            backwardsCompatibility: false,
            upsampling: false,
          },
        },
        makeUiGatewayDescriptor(buildVeloergUiSchema()),
      ],
    };
  },
};
