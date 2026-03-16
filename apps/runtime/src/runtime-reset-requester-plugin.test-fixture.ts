import { EventTypes } from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';

interface ResetRequesterConfig {
  triggerClientId?: string;
  reason?: string;
}

export default definePlugin({
  manifest: {
    id: 'runtime-reset-requester-plugin',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.uiClientConnected, v: 1, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 32,
      dataCapacity: 8,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.uiControlOut, v: 1 },
    ],
  },
  async onInit() {},
  async onEvent(event, ctx) {
    if (event.type !== EventTypes.uiClientConnected) {
      return;
    }
    const config = ctx.getConfig<ResetRequesterConfig>();
    if (config.triggerClientId && event.payload.clientId !== config.triggerClientId) {
      return;
    }
    const requestId = ctx.requestTimelineReset(config.reason ?? 'requester-fixture');
    await ctx.emit({
      type: EventTypes.uiControlOut,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        message: {
          type: 'ui.warning',
          code: requestId ? 'reset_request_sent' : 'reset_request_not_sent',
          message: requestId ?? 'request-id-unavailable',
        },
      },
    });
  },
  async onTimelineResetRequestResult(input, ctx) {
    await ctx.emit({
      type: EventTypes.uiControlOut,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        message: {
          type: 'ui.warning',
          code: `reset_request_result_${input.status}`,
          message: `${input.code}:${input.message}`,
        },
      },
    });
  },
  async onShutdown() {},
});
