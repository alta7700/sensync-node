import { EventTypes, type CommandEvent, type FactEvent } from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';
import { signalBatchEvent } from './helpers.ts';

let active = false;

function makeLabelBatch(value: 0 | 1, t0Ms: number) {
  const values = new Int16Array([value]);
  return signalBatchEvent('interval.label', 'interval.label', values, t0Ms, 0, 'i16');
}

export default definePlugin({
  manifest: {
    id: 'interval-label-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.intervalStart, kind: 'command', priority: 'control' },
      { type: EventTypes.intervalStop, kind: 'command', priority: 'control' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 32,
      dataPolicy: 'fail-fast',
    },
  },
  async onInit(ctx) {
    const initial: Omit<FactEvent<{ active: boolean }>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> = {
      type: EventTypes.intervalStateChanged,
      kind: 'fact',
      priority: 'system',
      payload: { active: false },
    };
    await ctx.emit(initial);
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.intervalStart) {
      if (active) return;
      active = true;
      await ctx.emit(makeLabelBatch(1, ctx.clock.nowSessionMs()));
      const stateChanged: Omit<FactEvent<{ active: boolean }>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> = {
        type: EventTypes.intervalStateChanged,
        kind: 'fact',
        priority: 'system',
        payload: { active: true },
      };
      await ctx.emit(stateChanged);
      return;
    }
    if (event.type === EventTypes.intervalStop) {
      if (!active) return;
      active = false;
      await ctx.emit(makeLabelBatch(0, ctx.clock.nowSessionMs()));
      const stateChanged: Omit<FactEvent<{ active: boolean }>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> = {
        type: EventTypes.intervalStateChanged,
        kind: 'fact',
        priority: 'system',
        payload: { active: false },
      };
      await ctx.emit(stateChanged);
    }
  },
  async onShutdown() {
    active = false;
  },
});
