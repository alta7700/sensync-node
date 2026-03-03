import {
  EventTypes,
  type AdapterConnectRequestPayload,
  type AdapterDisconnectRequestPayload,
  type CommandEvent,
  type FactEvent,
} from '@sensync2/core';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import { adapterStateEvent, signalBatchEvent } from './helpers.ts';

interface ShapeGeneratorConfig {
  sampleRateHz: number;
  batchMs: number;
}

const ShapeSchedulerTickType = 'shape.scheduler.tick';

let cfg: ShapeGeneratorConfig = { sampleRateHz: 200, batchMs: 50 };
let connected = false;
let producedSamples = 0;
let streamStartSessionMs = 0;
let pendingShape: Float32Array | null = null;
let pendingOffset = 0;

function buildShape(shapeName: string, sampleRateHz: number): Float32Array {
  const durationSec = 2;
  const count = Math.max(1, Math.round(durationSec * sampleRateHz));
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i / sampleRateHz;
    if (shapeName === 'triangle') {
      const phase = (t % 1) / 1;
      out[i] = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    } else if (shapeName === 'pulse') {
      const c = (t - 1) / 0.2;
      out[i] = Math.exp(-(c * c));
    } else {
      out[i] = Math.sin(t * Math.PI * 2);
    }
  }
  return out;
}

function nextShapeValues(sampleCount: number): Float32Array {
  const values = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    if (pendingShape && pendingOffset < pendingShape.length) {
      values[i] = pendingShape[pendingOffset]!;
      pendingOffset += 1;
      if (pendingOffset >= pendingShape.length) {
        pendingShape = null;
        pendingOffset = 0;
      }
    } else {
      values[i] = 0;
    }
  }
  return values;
}

async function emitDueBatches(ctx: PluginContext): Promise<void> {
  const sampleRateHz = Math.max(1, cfg.sampleRateHz);
  const dtMs = 1000 / sampleRateHz;
  const samplesPerBatch = Math.max(1, Math.round((sampleRateHz * Math.max(1, cfg.batchMs)) / 1000));
  const elapsedMs = Math.max(0, ctx.clock.nowSessionMs() - streamStartSessionMs);
  const targetSamples = Math.floor((elapsedMs * sampleRateHz) / 1000);

  let emitted = 0;
  const maxBatchesPerTick = 64;
  while ((targetSamples - producedSamples) >= samplesPerBatch) {
    const startSample = producedSamples;
    const values = nextShapeValues(samplesPerBatch);
    const t0Ms = streamStartSessionMs + startSample * dtMs;
    await ctx.emit(signalBatchEvent('shapes.signal', 'shapes.signal', values, t0Ms, dtMs, 'f32', 'a.u.'));
    producedSamples += samplesPerBatch;
    emitted += 1;
    if (emitted >= maxBatchesPerTick) break;
  }
}

function stopStreaming(ctx: PluginContext): void {
  ctx.clearTimer('shape.scheduler');
}

async function startStreaming(ctx: PluginContext): Promise<void> {
  const intervalMs = Math.max(1, Math.trunc(cfg.batchMs));
  ctx.setTimer('shape.scheduler', intervalMs, () => ({
    type: ShapeSchedulerTickType,
    kind: 'fact',
    priority: 'system',
    payload: {},
  }));
}

export default definePlugin({
  manifest: {
    id: 'shape-generator-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.adapterConnectRequest, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, kind: 'command', priority: 'control' },
      { type: EventTypes.shapeGenerateRequest, kind: 'command', priority: 'control' },
      { type: ShapeSchedulerTickType, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
  },
  async onInit(ctx) {
    cfg = { ...cfg, ...(ctx.getConfig<ShapeGeneratorConfig>() ?? {}) };
    await ctx.emit(adapterStateEvent('shapes', 'disconnected'));
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = (event as CommandEvent<AdapterConnectRequestPayload>).payload;
      if (payload.adapterId !== 'shapes') return;
      if (connected) return;
      await ctx.emit(adapterStateEvent('shapes', 'connecting', undefined, payload.requestId));
      connected = true;
      producedSamples = 0;
      streamStartSessionMs = ctx.clock.nowSessionMs();
      await startStreaming(ctx);
      await ctx.emit(adapterStateEvent('shapes', 'connected', undefined, payload.requestId));
      return;
    }
    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = (event as CommandEvent<AdapterDisconnectRequestPayload>).payload;
      if (payload.adapterId !== 'shapes') return;
      if (!connected) return;
      await ctx.emit(adapterStateEvent('shapes', 'disconnecting', undefined, payload.requestId));
      connected = false;
      stopStreaming(ctx);
      await ctx.emit(adapterStateEvent('shapes', 'disconnected', undefined, payload.requestId));
      return;
    }
    if (event.type === EventTypes.shapeGenerateRequest) {
      const payload = (event as CommandEvent<{ shapeName?: string }>).payload;
      const shapeName = typeof payload.shapeName === 'string' ? payload.shapeName : 'sine';
      pendingShape = buildShape(shapeName, Math.max(1, cfg.sampleRateHz));
      pendingOffset = 0;
      const shapeGenerated: Omit<FactEvent<{ shapeName: string }>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> = {
        type: EventTypes.shapeGenerated,
        kind: 'fact',
        priority: 'control',
        payload: { shapeName },
      };
      await ctx.emit(shapeGenerated);
      return;
    }
    if (event.type === ShapeSchedulerTickType) {
      if (!connected) return;
      await emitDueBatches(ctx);
    }
  },
  async onShutdown(ctx) {
    stopStreaming(ctx);
    connected = false;
    pendingShape = null;
    pendingOffset = 0;
  },
});

