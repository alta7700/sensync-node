import {
  defineRuntimeEventInput,
  EventTypes,
} from '@sensync2/core';
import {
  createAdapterStateHolder,
  createOutputRegistry,
  createTimelineResetParticipant,
  createUniformSignalEmitter,
} from '@sensync2/plugin-kit';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';

interface ShapeGeneratorConfig {
  sampleRateHz: number;
  batchMs: number;
}

const ShapeSchedulerTickType = 'shape.scheduler.tick';
const ShapeOutputs = createOutputRegistry({
  'shapes.signal': { streamId: 'shapes.signal', units: 'a.u.' },
});
const shapeEmitter = createUniformSignalEmitter(ShapeOutputs);

let cfg: ShapeGeneratorConfig = { sampleRateHz: 200, batchMs: 50 };
let producedSamples = 0;
let streamStartSessionMs = 0;
let pendingShape: Float32Array | null = null;
let pendingOffset = 0;
let shapeState = createAdapterStateHolder({ adapterId: 'shapes' });
const timelineResetParticipant = createTimelineResetParticipant({
  onPrepare: (_input, ctx) => {
    stopStreaming(ctx);
  },
  onAbort: async (_input, ctx) => {
    if (!shapeState.isState('connected')) {
      return;
    }
    await startStreaming(ctx);
  },
  onCommit: async (input, ctx) => {
    producedSamples = 0;
    streamStartSessionMs = input.timelineStartSessionMs;
    pendingShape = null;
    pendingOffset = 0;
    if (shapeState.isState('connected')) {
      await startStreaming(ctx);
    } else {
      stopStreaming(ctx);
    }
    await shapeState.emitCurrent(ctx);
  },
});

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
    await shapeEmitter.emit(ctx, 'shapes.signal', values, {
      t0Ms,
      dtMs,
      sampleRateHz,
    });
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
  ctx.setTimer('shape.scheduler', intervalMs, () => defineRuntimeEventInput({
    type: ShapeSchedulerTickType,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload: {},
  }));
}

async function connectShapeAdapter(ctx: PluginContext, requestId?: string): Promise<void> {
  shapeState.assertCanConnect();
  await shapeState.setState(ctx, 'connecting', requestId);
  producedSamples = 0;
  streamStartSessionMs = ctx.clock.nowSessionMs();
  await startStreaming(ctx);
  await shapeState.setState(ctx, 'connected', requestId);
}

async function disconnectShapeAdapter(ctx: PluginContext, requestId?: string): Promise<void> {
  if (!shapeState.canDisconnect()) return;
  await shapeState.setState(ctx, 'disconnecting', requestId);
  stopStreaming(ctx);
  await shapeState.setState(ctx, 'disconnected', requestId);
}

export default definePlugin({
  manifest: {
    id: 'shape-generator-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.adapterConnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.shapeGenerateRequest, v: 1, kind: 'command', priority: 'control' },
      { type: ShapeSchedulerTickType, v: 1, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.adapterStateChanged, v: 1 },
      { type: EventTypes.shapeGenerated, v: 1 },
      { type: EventTypes.signalBatch, v: 1 },
      { type: ShapeSchedulerTickType, v: 1 },
    ],
  },
  async onInit(ctx) {
    cfg = { ...cfg, ...(ctx.getConfig<ShapeGeneratorConfig>() ?? {}) };
    shapeState = createAdapterStateHolder({ adapterId: 'shapes' });
    timelineResetParticipant.initialize(ctx.currentTimelineId());
    await shapeState.emitCurrent(ctx);
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== 'shapes') return;
      if (!shapeState.canConnect()) return;
      await connectShapeAdapter(ctx, payload.requestId);
      return;
    }
    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== 'shapes') return;
      await disconnectShapeAdapter(ctx, payload.requestId);
      return;
    }
    if (event.type === EventTypes.shapeGenerateRequest) {
      const payload = event.payload;
      const shapeName = typeof payload.shapeName === 'string' ? payload.shapeName : 'sine';
      pendingShape = buildShape(shapeName, Math.max(1, cfg.sampleRateHz));
      pendingOffset = 0;
      const shapeGenerated = defineRuntimeEventInput({
        type: EventTypes.shapeGenerated,
        v: 1,
        kind: 'fact',
        priority: 'control',
        payload: { shapeName },
      });
      await ctx.emit(shapeGenerated);
      return;
    }
    if (event.type === ShapeSchedulerTickType) {
      if (!shapeState.isState('connected')) return;
      await emitDueBatches(ctx);
    }
  },
  async onShutdown(ctx) {
    stopStreaming(ctx);
    shapeState = createAdapterStateHolder({ adapterId: 'shapes' });
    pendingShape = null;
    pendingOffset = 0;
  },
  async onTimelineResetPrepare(input, ctx) {
    await timelineResetParticipant.onPrepare(input, ctx);
  },
  async onTimelineResetAbort(input, ctx) {
    await timelineResetParticipant.onAbort(input, ctx);
  },
  async onTimelineResetCommit(input, ctx) {
    await timelineResetParticipant.onCommit(input, ctx);
  },
});
