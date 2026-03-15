import type { UiSchema } from '@sensync2/core';
import type { PluginDescriptor } from '../types.ts';
import { moduleFileUrl } from '../launch-profile-boundary.ts';

export function makeUiGatewayDescriptor(schema: UiSchema, sessionId = 'local-desktop'): PluginDescriptor {
  return {
    id: 'ui-gateway',
    modulePath: moduleFileUrl('packages/plugins-ui-gateway/src/ui-gateway-plugin.ts'),
    config: {
      sessionId,
      schema,
    },
  };
}
