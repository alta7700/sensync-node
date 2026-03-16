import { EventTypes } from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';

interface ResetProbeConfig {
  prepareDelayMs?: number;
  commitDelayMs?: number;
  failCommit?: boolean;
  emitBeforeFailOnCommit?: boolean;
}

export default definePlugin({
  manifest: {
    id: 'runtime-reset-probe-plugin',
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
        clientId: event.payload.clientId,
        message: {
          type: 'ui.warning',
          code: 'attached_probe',
          message: `attached:${event.payload.clientId}`,
        },
      },
    });
  },
  async onTimelineResetPrepare(_input, ctx) {
    const config = ctx.getConfig<ResetProbeConfig>();
    if ((config.prepareDelayMs ?? 0) > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, config.prepareDelayMs);
      });
    }
  },
  async onTimelineResetCommit(_input, ctx) {
    const config = ctx.getConfig<ResetProbeConfig>();
    if ((config.commitDelayMs ?? 0) > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, config.commitDelayMs);
      });
    }
    if (config.emitBeforeFailOnCommit) {
      await ctx.emit({
        type: EventTypes.uiControlOut,
        v: 1,
        kind: 'fact',
        priority: 'system',
        payload: {
          message: {
            type: 'ui.warning',
            code: 'reset_commit_probe',
            message: `timeline:${ctx.currentTimelineId()}`,
          },
        },
      });
    }
    if (config.failCommit) {
      throw new Error('probe_commit_failed');
    }
    await ctx.emit({
      type: EventTypes.uiControlOut,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        message: {
          type: 'ui.warning',
          code: 'reset_commit_probe',
          message: `timeline:${ctx.currentTimelineId()}`,
        },
      },
    });
  },
  async onShutdown() {},
});
