import { defineRuntimeEventInput, EventTypes } from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';
import { signalBatchEvent } from './helpers.ts';

interface ActivityDetectorConfig {
  sourceChannelId: string;
  threshold: number;
}

let cfg: ActivityDetectorConfig = { sourceChannelId: 'shapes.signal', threshold: 0.6 };
let active = false;

export default definePlugin({
  manifest: {
    id: 'activity-detector-processor',
    version: '0.1.0',
    required: false,
    subscriptions: [
      { type: EventTypes.signalBatch, v: 1, kind: 'data', priority: 'data', filter: { channelIdPrefix: 'shapes.signal' } },
    ],
    mailbox: {
      controlCapacity: 64,
      dataCapacity: 256,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.activityStateChanged, v: 1 },
      { type: EventTypes.signalBatch, v: 1 },
    ],
  },
  async onInit(ctx) {
    cfg = { ...cfg, ...(ctx.getConfig<ActivityDetectorConfig>() ?? {}) };
    await ctx.emit(defineRuntimeEventInput({
      type: EventTypes.activityStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { active: false },
    }));
  },
  async onEvent(event, ctx) {
    if (event.type !== EventTypes.signalBatch) return;
    if (event.payload.channelId !== cfg.sourceChannelId) return;

    let hasActivity = false;
    for (let i = 0; i < event.payload.values.length; i += 1) {
      if (Math.abs(Number(event.payload.values[i])) >= cfg.threshold) {
        hasActivity = true;
        break;
      }
    }

    if (hasActivity !== active) {
      active = hasActivity;
      await ctx.emit(defineRuntimeEventInput({
        type: EventTypes.activityStateChanged,
        v: 1,
        kind: 'fact',
        priority: 'system',
        payload: { active },
      }));

      const label = new Int16Array([active ? 1 : 0]);
      await ctx.emit(signalBatchEvent('activity.label', 'activity.label', label, ctx.clock.nowSessionMs(), 0, 'i16'));
    }
  },
  async onShutdown() {
    active = false;
  },
});
