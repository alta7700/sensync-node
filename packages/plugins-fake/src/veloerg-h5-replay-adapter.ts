import { EventTypes, type AdapterConnectRequestPayload, type AdapterDisconnectRequestPayload, type CommandEvent, type FactEvent, type SignalBatchEvent } from '@sensync2/core';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

interface ReplayStreamManifest {
  streamId: string;
  channelId: string;
  sampleFormat: 'f64' | 'i16';
  frameKind: 'irregular-signal-batch' | 'label-batch';
  sampleCount: number;
  dataFile: string;
  minTimestampMs: number;
  maxTimestampMs: number;
  units?: string;
}

interface ReplayBundleManifest {
  version: number;
  format: string;
  timeDomain: 'session';
  streams: ReplayStreamManifest[];
  stats?: {
    minTimestampMs?: number | null;
    maxTimestampMs?: number | null;
  };
}

interface ReplayStreamState {
  meta: ReplayStreamManifest;
  interleaved: Float64Array;
  cursor: number;
}

interface ReplayAdapterConfig {
  adapterId?: string;
  bundlePath: string;
  tickMs?: number;
  speed?: number;
  maxSamplesPerBatch?: number;
}

const ReplayTickType = 'veloerg.replay.tick';

let cfg: ReplayAdapterConfig = { adapterId: 'velo-replay', bundlePath: '', tickMs: 20, speed: 1, maxSamplesPerBatch: 3000 };
let connected = false;
let streams: ReplayStreamState[] = [];
let playbackStartSessionMs = 0;
let dataStartMs = 0;

function adapterStateEvent(
  adapterId: string,
  state: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'failed',
  message?: string,
  requestId?: string,
): Omit<FactEvent<{ adapterId: string; state: string; message?: string; requestId?: string }>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: { adapterId: string; state: string; message?: string; requestId?: string } = { adapterId, state };
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return {
    type: EventTypes.adapterStateChanged,
    kind: 'fact',
    priority: 'system',
    payload,
  };
}

function resetReplayState(): void {
  for (const stream of streams) {
    stream.cursor = 0;
  }
}

function stopReplay(ctx: PluginContext): void {
  ctx.clearTimer('veloerg.replay.timer');
}

async function startReplay(ctx: PluginContext): Promise<void> {
  const tickMs = Math.max(1, Math.trunc(cfg.tickMs ?? 20));
  ctx.setTimer('veloerg.replay.timer', tickMs, () => ({
    type: ReplayTickType,
    kind: 'fact',
    priority: 'system',
    payload: {},
  }));
}

function tsAt(stream: ReplayStreamState, index: number): number {
  return stream.interleaved[index * 2]!;
}

function valueAt(stream: ReplayStreamState, index: number): number {
  return stream.interleaved[index * 2 + 1]!;
}

function upperBoundByTs(stream: ReplayStreamState, targetTsMs: number): number {
  let lo = stream.cursor;
  let hi = stream.meta.sampleCount;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (tsAt(stream, mid) <= targetTsMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildChunkEvent(stream: ReplayStreamState, from: number, to: number): Omit<SignalBatchEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const sampleCount = to - from;
  const timestampsMs = new Float64Array(sampleCount);

  let values: Float64Array | Int16Array;
  if (stream.meta.sampleFormat === 'i16') {
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      timestampsMs[i] = tsAt(stream, from + i);
      out[i] = Math.round(valueAt(stream, from + i));
    }
    values = out;
  } else {
    const out = new Float64Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      timestampsMs[i] = tsAt(stream, from + i);
      out[i] = valueAt(stream, from + i);
    }
    values = out;
  }

  const payload: SignalBatchEvent['payload'] = {
    streamId: stream.meta.streamId,
    channelId: stream.meta.channelId,
    sampleFormat: stream.meta.sampleFormat,
    frameKind: stream.meta.frameKind,
    t0Ms: timestampsMs[0]!,
    dtMs: 0,
    sampleCount,
    values,
    timestampsMs,
  };
  if (stream.meta.units !== undefined) payload.units = stream.meta.units;

  return {
    type: 'signal.batch',
    kind: 'data',
    priority: 'data',
    payload,
  };
}

async function emitDueSamples(ctx: PluginContext): Promise<void> {
  if (!connected) return;

  const speed = Math.max(0.001, Number(cfg.speed ?? 1));
  const targetTsMs = dataStartMs + (ctx.clock.nowSessionMs() - playbackStartSessionMs) * speed;
  const maxSamplesPerBatch = Math.max(1, Math.trunc(cfg.maxSamplesPerBatch ?? 3000));

  for (const stream of streams) {
    const upperBound = upperBoundByTs(stream, targetTsMs);
    while (stream.cursor < upperBound) {
      const from = stream.cursor;
      const to = Math.min(upperBound, from + maxSamplesPerBatch);
      await ctx.emit(buildChunkEvent(stream, from, to));
      stream.cursor = to;
    }
  }

  const completed = streams.length > 0 && streams.every((stream) => stream.cursor >= stream.meta.sampleCount);
  if (completed) {
    connected = false;
    stopReplay(ctx);
    await ctx.emit(adapterStateEvent(cfg.adapterId ?? 'velo-replay', 'disconnected', 'Replay завершен'));
  }
}

async function loadBundle(bundlePath: string): Promise<{ streams: ReplayStreamState[]; dataStartMs: number }> {
  const manifestRaw = await readFile(bundlePath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as ReplayBundleManifest;
  if (!manifest || !Array.isArray(manifest.streams)) {
    throw new Error(`Некорректный manifest replay bundle: ${bundlePath}`);
  }

  const baseDir = new URL('.', pathToFileURL(bundlePath));
  const loaded: ReplayStreamState[] = [];
  let globalMinTs = Number.POSITIVE_INFINITY;

  for (const meta of manifest.streams) {
    const dataUrl = new URL(meta.dataFile, baseDir);
    const dataBuffer = await readFile(dataUrl);
    if (dataBuffer.byteLength % Float64Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Некорректная длина dataFile для stream ${meta.streamId}`);
    }
    const arr = new Float64Array(
      dataBuffer.buffer,
      dataBuffer.byteOffset,
      Math.floor(dataBuffer.byteLength / Float64Array.BYTES_PER_ELEMENT),
    );
    if (arr.length !== meta.sampleCount * 2) {
      throw new Error(`Размер dataFile не совпадает с sampleCount для stream ${meta.streamId}`);
    }
    const interleaved = new Float64Array(arr);
    loaded.push({ meta, interleaved, cursor: 0 });
    if (meta.sampleCount > 0 && meta.minTimestampMs < globalMinTs) {
      globalMinTs = meta.minTimestampMs;
    }
  }

  const normalizedMinTs = Number.isFinite(globalMinTs) ? globalMinTs : 0;
  return { streams: loaded, dataStartMs: normalizedMinTs };
}

export default definePlugin({
  manifest: {
    id: 'veloerg-h5-replay-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.adapterConnectRequest, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, kind: 'command', priority: 'control' },
      { type: ReplayTickType, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
  },
  async onInit(ctx) {
    cfg = { ...cfg, ...(ctx.getConfig<ReplayAdapterConfig>() ?? {}) };
    if (!cfg.bundlePath) {
      throw new Error('Не задан bundlePath для veloerg-h5-replay-adapter');
    }
    const loaded = await loadBundle(cfg.bundlePath);
    streams = loaded.streams;
    dataStartMs = loaded.dataStartMs;
    await ctx.emit(adapterStateEvent(cfg.adapterId ?? 'velo-replay', 'disconnected'));
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = (event as CommandEvent<AdapterConnectRequestPayload>).payload;
      const adapterId = cfg.adapterId ?? 'velo-replay';
      if (payload.adapterId !== adapterId) return;
      if (connected) return;

      await ctx.emit(adapterStateEvent(adapterId, 'connecting', undefined, payload.requestId));
      resetReplayState();
      playbackStartSessionMs = ctx.clock.nowSessionMs();
      connected = true;
      await startReplay(ctx);
      await ctx.emit(adapterStateEvent(adapterId, 'connected', undefined, payload.requestId));
      return;
    }

    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = (event as CommandEvent<AdapterDisconnectRequestPayload>).payload;
      const adapterId = cfg.adapterId ?? 'velo-replay';
      if (payload.adapterId !== adapterId) return;
      if (!connected) return;

      await ctx.emit(adapterStateEvent(adapterId, 'disconnecting', undefined, payload.requestId));
      connected = false;
      stopReplay(ctx);
      await ctx.emit(adapterStateEvent(adapterId, 'disconnected', undefined, payload.requestId));
      return;
    }

    if (event.type === ReplayTickType) {
      await emitDueSamples(ctx);
    }
  },
  async onShutdown(ctx) {
    connected = false;
    stopReplay(ctx);
    streams = [];
  },
});
