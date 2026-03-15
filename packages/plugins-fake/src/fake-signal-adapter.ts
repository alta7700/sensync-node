import { EventTypes } from '@sensync2/core';
import {
  createAdapterStateHolder,
  createOutputRegistry,
  createUniformSignalEmitter,
  resolveAutoconnectDecision,
  runAutoconnect,
  type AdapterAutoconnectDecision,
} from '@sensync2/adapter-kit';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';

interface FakeSignalAdapterConfig {
  sampleRateHz: number;
  batchMs: number;
  compareSampleRateHz?: number;
  compareBatchMs?: number;
}

type Waveform = 'a' | 'b';
type FakeStreamId = 'fake.a1' | 'fake.a2' | 'fake.b';

interface StreamState {
  streamId: FakeStreamId;
  waveform: Waveform;
  sampleRateHz: number;
  batchMs: number;
  dtMs: number;
  samplesPerBatch: number;
  producedSamples: number;
}

const SchedulerTickType = 'fake.scheduler.tick';
const MaxBatchesPerSchedulerTick = 64;
const FakeSignalOutputs = createOutputRegistry({
  'fake.a1': { streamId: 'fake.a1', units: 'a.u.' },
  'fake.a2': { streamId: 'fake.a2', units: 'a.u.' },
  'fake.b': { streamId: 'fake.b', units: 'a.u.' },
});
const fakeSignalEmitter = createUniformSignalEmitter(FakeSignalOutputs);

let cfg: FakeSignalAdapterConfig = { sampleRateHz: 200, batchMs: 50 };
let connectionStartSessionMs = 0;
let streams: StreamState[] = [];
let fakeState = createAdapterStateHolder({ adapterId: 'fake' });
let autoconnectDecision: AdapterAutoconnectDecision = {
  kind: 'manual',
  shouldAutoconnect: false,
};

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function makeStream(streamId: StreamState['streamId'], waveform: Waveform, sampleRateHz: number, batchMs: number): StreamState {
  const safeRate = Math.max(1, sampleRateHz);
  const safeBatchMs = Math.max(1, Math.trunc(batchMs));
  return {
    streamId,
    waveform,
    sampleRateHz: safeRate,
    batchMs: safeBatchMs,
    dtMs: 1000 / safeRate,
    samplesPerBatch: Math.max(1, Math.round((safeRate * safeBatchMs) / 1000)),
    producedSamples: 0,
  };
}

function rebuildStreams(): void {
  const compareRate = cfg.compareSampleRateHz ?? cfg.sampleRateHz;
  const compareBatchMs = cfg.compareBatchMs ?? 50;

  streams = [
    makeStream('fake.a1', 'a', compareRate, compareBatchMs),
    makeStream('fake.a2', 'a', cfg.sampleRateHz, cfg.batchMs),
    makeStream('fake.b', 'b', cfg.sampleRateHz, cfg.batchMs),
  ];
}

function makeSignalValue(waveform: Waveform, sampleIndex: number, sampleRateHz: number): number {
  const x = sampleIndex / sampleRateHz;
  if (waveform === 'a') {
    return Math.sin(x * Math.PI * 2) * 0.8 + Math.sin(x * Math.PI * 0.5) * 0.2;
  }
  return Math.cos(x * Math.PI * 1.3) * 0.5;
}

function buildValues(stream: StreamState, startSample: number, count: number): Float32Array {
  const values = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    values[i] = makeSignalValue(stream.waveform, startSample + i, stream.sampleRateHz);
  }
  return values;
}

function schedulerTickIntervalMs(): number {
  if (streams.length === 0) return Math.max(1, Math.trunc(cfg.batchMs));
  let out = streams[0]!.batchMs;
  for (let i = 1; i < streams.length; i += 1) {
    out = gcd(out, streams[i]!.batchMs);
  }
  return Math.max(1, out);
}

async function emitDueBatches(ctx: PluginContext): Promise<void> {
  const nowSessionMs = ctx.clock.nowSessionMs();

  for (const stream of streams) {
    const elapsedMs = Math.max(0, nowSessionMs - connectionStartSessionMs);
    const targetSamples = Math.floor((elapsedMs * stream.sampleRateHz) / 1000);

    let emitted = 0;
    while ((targetSamples - stream.producedSamples) >= stream.samplesPerBatch) {
      const startSample = stream.producedSamples;
      const values = buildValues(stream, startSample, stream.samplesPerBatch);

      // Время сессии считаем по sample-index от старта подключения: без накопления `t += dt`.
      const t0Ms = connectionStartSessionMs + startSample * stream.dtMs;
      await fakeSignalEmitter.emit(ctx, stream.streamId, values, {
        t0Ms,
        dtMs: stream.dtMs,
        sampleRateHz: stream.sampleRateHz,
      });

      stream.producedSamples += stream.samplesPerBatch;
      emitted += 1;

      if (emitted >= MaxBatchesPerSchedulerTick) {
        // Ограничиваем catch-up за один тик, чтобы не "повесить" worker при аномально длинной паузе.
        break;
      }
    }
  }
}

async function startStreaming(ctx: PluginContext): Promise<void> {
  const intervalMs = schedulerTickIntervalMs();
  ctx.setTimer('fake.scheduler', intervalMs, () => ({
    type: SchedulerTickType,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload: {},
  }));
}

function stopStreaming(ctx: PluginContext): void {
  ctx.clearTimer('fake.scheduler');
}

function resetStreamProgress(): void {
  rebuildStreams();
  for (const stream of streams) {
    stream.producedSamples = 0;
  }
}

async function connectFakeAdapter(ctx: PluginContext, requestId?: string): Promise<void> {
  fakeState.assertCanConnect();
  await fakeState.setState(ctx, 'connecting', requestId);
  resetStreamProgress();
  connectionStartSessionMs = ctx.clock.nowSessionMs();
  await startStreaming(ctx);
  await fakeState.setState(ctx, 'connected', requestId);
}

async function disconnectFakeAdapter(ctx: PluginContext, requestId?: string): Promise<void> {
  if (!fakeState.canDisconnect()) return;
  await fakeState.setState(ctx, 'disconnecting', requestId);
  stopStreaming(ctx);
  await fakeState.setState(ctx, 'disconnected', requestId);
}

export default definePlugin({
  manifest: {
    id: 'fake-signal-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.runtimeStarted, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.adapterConnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: SchedulerTickType, v: 1, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.adapterStateChanged, v: 1 },
      { type: EventTypes.signalBatch, v: 1 },
      { type: SchedulerTickType, v: 1 },
    ],
  },
  async onInit(ctx) {
    cfg = { ...cfg, ...(ctx.getConfig<FakeSignalAdapterConfig>() ?? {}) };
    rebuildStreams();
    fakeState = createAdapterStateHolder({ adapterId: 'fake' });
    autoconnectDecision = resolveAutoconnectDecision({ kind: 'auto-on-init' });
    await fakeState.emitCurrent(ctx);
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.runtimeStarted) {
      if (!fakeState.canConnect()) return;
      await runAutoconnect(autoconnectDecision, async () => {
        await connectFakeAdapter(ctx);
      });
      return;
    }

    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== 'fake') return;
      if (!fakeState.canConnect()) return;
      await connectFakeAdapter(ctx, payload.requestId);
      return;
    }

    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== 'fake') return;
      await disconnectFakeAdapter(ctx, payload.requestId);
      return;
    }

    if (event.type === SchedulerTickType) {
      if (!fakeState.isState('connected')) return;
      await emitDueBatches(ctx);
    }
  },
  async onShutdown(ctx) {
    stopStreaming(ctx);
    fakeState = createAdapterStateHolder({ adapterId: 'fake' });
    autoconnectDecision = { kind: 'manual', shouldAutoconnect: false };
  },
});
