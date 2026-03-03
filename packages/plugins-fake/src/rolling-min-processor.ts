import { type CommandEvent, type FactEvent, type SignalBatchEvent } from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';
import { signalBatchEvent } from './helpers.ts';

interface RollingMinConfig {
  sourceChannelId: string;
  outputChannelId: string;
}

const FlushTickType = 'processor.rolling-min.flush';
let cfg: RollingMinConfig = { sourceChannelId: 'fake.a2', outputChannelId: 'metrics.fake.a2.rolling_min_1s' };
let windowValues: number[] = [];

export default definePlugin({
  manifest: {
    id: 'rolling-min-processor',
    version: '0.1.0',
    required: false,
    subscriptions: [
      { type: 'signal.batch', kind: 'data', priority: 'data', filter: { channelIdPrefix: 'fake.a' } },
      { type: FlushTickType, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 64,
      dataCapacity: 256,
      dataPolicy: 'fail-fast',
    },
  },
  async onInit(ctx) {
    cfg = { ...cfg, ...(ctx.getConfig<RollingMinConfig>() ?? {}) };
    ctx.setTimer('rolling-min.flush', 1000, () => ({
      type: FlushTickType,
      kind: 'fact',
      priority: 'system',
      payload: {},
    }));
  },
  async onEvent(event, ctx) {
    if (event.type === 'signal.batch') {
      const e = event as SignalBatchEvent;
      if (e.payload.channelId !== cfg.sourceChannelId) return;
      for (let i = 0; i < e.payload.values.length; i += 1) {
        windowValues.push(Number(e.payload.values[i]));
      }
      const maxKeep = 2000;
      if (windowValues.length > maxKeep) {
        windowValues = windowValues.slice(windowValues.length - maxKeep);
      }
      return;
    }

    if (event.type === FlushTickType) {
      if (windowValues.length === 0) return;
      let min = Number.POSITIVE_INFINITY;
      for (const value of windowValues) {
        if (value < min) min = value;
      }
      const values = new Float32Array([min]);
      await ctx.emit(signalBatchEvent(cfg.outputChannelId, cfg.outputChannelId, values, ctx.clock.nowSessionMs(), 1000, 'f32', 'a.u.'));

      const metricEvent: Omit<FactEvent<{ key: string; value: number }>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> = {
        type: 'metric.value.changed',
        kind: 'fact',
        priority: 'system',
        payload: { key: 'rollingMin.fakeA', value: min },
      };
      await ctx.emit(metricEvent);
    }
  },
  async onShutdown(ctx) {
    ctx.clearTimer('rolling-min.flush');
    windowValues = [];
  },
});
