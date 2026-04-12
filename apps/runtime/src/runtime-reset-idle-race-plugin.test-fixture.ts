import { EventTypes } from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';

export default definePlugin({
  manifest: {
    id: 'runtime-reset-idle-race-plugin',
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

    await ctx.emit({
      type: EventTypes.uiControlOut,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        message: {
          type: 'ui.warning',
          code: 'idle_probe',
          message: 'idle_probe',
        },
      },
    });

    const requestId = ctx.requestTimelineReset('idle-race-probe');
    if (!requestId) {
      throw new Error('Не удалось запросить reset для idle-race probe');
    }
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
          code: `idle_race_request_result_${input.status}`,
          message: `${input.code}:${input.message}`,
        },
      },
    });
  },
  async onShutdown() {},
});
