import { EventTypes } from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';

const PluginId = 'runtime-start-fast-probe-plugin';

export default definePlugin({
  manifest: {
    id: PluginId,
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.runtimeStarted, v: 1, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 16,
      dataCapacity: 1,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.uiControlOut, v: 1 },
    ],
  },
  async onInit() {},
  async onEvent(event, ctx) {
    if (event.type !== EventTypes.runtimeStarted) return;
    await ctx.emit({
      type: EventTypes.uiControlOut,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        message: {
          type: 'ui.warning',
          code: 'runtime_started_probe',
          message: 'runtime.started доставлен fast-probe',
          pluginId: PluginId,
        },
      },
    });
  },
  async onShutdown() {},
});
