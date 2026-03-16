import './generated-runtime-event-map.ts';

import {
  defineRuntimeEventInput,
  EventTypes,
  type AdapterConnectRequestPayload,
  type AdapterDisconnectRequestPayload,
} from '@sensync2/core';
import {
  createAdapterStateHolder,
  createOutputRegistry,
  createReconnectPolicy,
  createUniformSignalEmitter,
} from '@sensync2/plugin-kit';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import {
  buildTrignoExpectedStartSnapshot,
  buildTrignoConnectRequest,
  diffTrignoExpectedStartSnapshot,
  formatTrignoSnapshotMismatchMessage,
  resolveTrignoAdapterConfig,
  TrignoEventTypes,
  type TrignoAdapterConfig,
  type TrignoCommandRequestPayload,
  type TrignoConnectRequest,
  type TrignoStatusReportedPayload,
  type TrignoStatusSnapshot,
} from './trigno-boundary.ts';
import { TrignoTcpSession, type TrignoTcpSessionOptions } from './trigno-transport.ts';

const TrignoPollTimerId = 'trigno.poll';
const TrignoEmgStreamId = 'trigno.avanti';
const TrignoGyroXStreamId = 'trigno.avanti.gyro.x';
const TrignoGyroYStreamId = 'trigno.avanti.gyro.y';
const TrignoGyroZStreamId = 'trigno.avanti.gyro.z';
const TrignoOutputs = createOutputRegistry({
  emg: { streamId: TrignoEmgStreamId, units: 'V' },
  gyroX: { streamId: TrignoGyroXStreamId, units: 'deg/s' },
  gyroY: { streamId: TrignoGyroYStreamId, units: 'deg/s' },
  gyroZ: { streamId: TrignoGyroZStreamId, units: 'deg/s' },
});
const trignoEmitter = createUniformSignalEmitter(TrignoOutputs);

class TrignoStartBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrignoStartBlockedError';
  }
}

interface StreamTimeline {
  nextT0Ms: number | null;
  dtMs: number;
  sampleRateHz: number;
}

let config = resolveTrignoAdapterConfig(undefined);
let currentSession: TrignoTcpSession | null = null;
let lastConnectRequest: TrignoConnectRequest | null = null;
let reconnectReason: string | null = null;
let manualDisconnectRequested = false;
let shouldStream = false;
let lastStatusSnapshot: TrignoStatusSnapshot | null = null;
let nextConnectAllowedSessionMs: number | null = null;
let lastEmgDataSessionMs: number | null = null;
let lastAuxDataSessionMs: number | null = null;
let emgTimeline: StreamTimeline = { nextT0Ms: null, dtMs: 1, sampleRateHz: 1 };
let gyroTimeline: StreamTimeline = { nextT0Ms: null, dtMs: 1, sampleRateHz: 1 };
let trignoState = createAdapterStateHolder({ adapterId: config.adapterId });
let reconnectPolicy = createReconnectPolicy({ initialDelayMs: config.reconnectRetryDelayMs });

function trignoPollEvent() {
  return defineRuntimeEventInput({
    type: TrignoEventTypes.poll,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload: {},
  });
}

function statusReportedEvent(snapshot: TrignoStatusSnapshot, requestId?: string) {
  const payload: TrignoStatusReportedPayload = {
    adapterId: config.adapterId,
    status: snapshot,
  };
  if (requestId !== undefined) payload.requestId = requestId;
  return defineRuntimeEventInput({
    type: TrignoEventTypes.statusReported,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

function resetReconnectState(): void {
  reconnectReason = null;
  reconnectPolicy.reset();
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function armConnectCooldown(ctx: PluginContext): void {
  if (config.connectCooldownMs <= 0) {
    nextConnectAllowedSessionMs = null;
    return;
  }
  nextConnectAllowedSessionMs = ctx.clock.nowSessionMs() + config.connectCooldownMs;
}

async function waitForConnectCooldown(ctx: PluginContext): Promise<void> {
  if (nextConnectAllowedSessionMs === null) return;
  const remainingMs = nextConnectAllowedSessionMs - ctx.clock.nowSessionMs();
  if (remainingMs <= 0) {
    nextConnectAllowedSessionMs = null;
    return;
  }
  await sleep(remainingMs);
  nextConnectAllowedSessionMs = null;
}

function resetTimelines(snapshot: TrignoStatusSnapshot | null): void {
  if (!snapshot) {
    emgTimeline = { nextT0Ms: null, dtMs: 1, sampleRateHz: 1 };
    gyroTimeline = { nextT0Ms: null, dtMs: 1, sampleRateHz: 1 };
    return;
  }
  emgTimeline = {
    nextT0Ms: null,
    sampleRateHz: snapshot.emg.rateHz,
    dtMs: 1_000 / snapshot.emg.rateHz,
  };
  gyroTimeline = {
    nextT0Ms: null,
    sampleRateHz: snapshot.gyro.rateHz,
    dtMs: 1_000 / snapshot.gyro.rateHz,
  };
}

function resetDataActivity(): void {
  lastEmgDataSessionMs = null;
  lastAuxDataSessionMs = null;
}

function markDataActivity(ctx: PluginContext, kind: 'emg' | 'aux'): void {
  const now = ctx.clock.nowSessionMs();
  if (kind === 'emg') {
    lastEmgDataSessionMs = now;
    return;
  }
  lastAuxDataSessionMs = now;
}

async function setAdapterRuntimeState(
  ctx: PluginContext,
  state: Parameters<typeof trignoState.setState>[1],
  requestId?: string,
  message?: string,
): Promise<void> {
  await trignoState.setState(ctx, state, requestId, message);
}

async function emitStatusSnapshot(ctx: PluginContext, snapshot: TrignoStatusSnapshot, requestId?: string): Promise<void> {
  lastStatusSnapshot = snapshot;
  await ctx.emit(statusReportedEvent(snapshot, requestId));
}

function startPolling(ctx: PluginContext): void {
  ctx.setTimer(TrignoPollTimerId, config.pollIntervalMs, trignoPollEvent);
}

function stopPolling(ctx: PluginContext): void {
  ctx.clearTimer(TrignoPollTimerId);
}

function sessionOptions(request: TrignoConnectRequest): TrignoTcpSessionOptions {
  return {
    host: request.host,
    sensorSlot: request.sensorSlot,
    backwardsCompatibility: config.backwardsCompatibility,
    upsampling: config.upsampling,
    commandPort: config.commandPort,
    emgPort: config.emgPort,
    auxPort: config.auxPort,
    dataSocketReadyDelayMs: config.dataSocketReadyDelayMs,
    commandTimeoutMs: config.commandTimeoutMs,
    startTimeoutMs: config.startTimeoutMs,
    stopTimeoutMs: config.stopTimeoutMs,
  };
}

async function closeCurrentSession(): Promise<void> {
  const session = currentSession;
  currentSession = null;
  if (!session) return;
  await session.close().catch(() => undefined);
}

async function refreshStatusSnapshot(
  ctx: PluginContext,
  requestId?: string,
): Promise<TrignoStatusSnapshot> {
  if (!currentSession) {
    throw new Error('Trigno не подключён');
  }
  const snapshot = await currentSession.queryStatus();
  resetTimelines(snapshot);
  await emitStatusSnapshot(ctx, snapshot, requestId);
  return snapshot;
}

async function validateStartSnapshot(
  ctx: PluginContext,
  requestId?: string,
): Promise<TrignoStatusSnapshot> {
  const snapshot = await refreshStatusSnapshot(ctx, requestId);
  const mismatches = diffTrignoExpectedStartSnapshot(snapshot, buildTrignoExpectedStartSnapshot(config));
  if (mismatches.length > 0) {
    throw new TrignoStartBlockedError(formatTrignoSnapshotMismatchMessage(mismatches));
  }
  return snapshot;
}

function nextBatchT0(ctx: PluginContext, timeline: StreamTimeline, sampleCount: number): number {
  const t0Ms = timeline.nextT0Ms ?? ctx.clock.nowSessionMs();
  timeline.nextT0Ms = t0Ms + (sampleCount * timeline.dtMs);
  return t0Ms;
}

async function emitEmgBatch(ctx: PluginContext, values: Float32Array): Promise<void> {
  const t0Ms = nextBatchT0(ctx, emgTimeline, values.length);
  await trignoEmitter.emit(ctx, 'emg', values, {
    t0Ms,
    dtMs: emgTimeline.dtMs,
    sampleRateHz: emgTimeline.sampleRateHz,
  });
}

async function emitGyroBatches(
  ctx: PluginContext,
  samples: { x: Float32Array; y: Float32Array; z: Float32Array },
): Promise<void> {
  const t0Ms = nextBatchT0(ctx, gyroTimeline, samples.x.length);
  await Promise.all([
    trignoEmitter.emit(ctx, 'gyroX', samples.x, { t0Ms, dtMs: gyroTimeline.dtMs, sampleRateHz: gyroTimeline.sampleRateHz }),
    trignoEmitter.emit(ctx, 'gyroY', samples.y, { t0Ms, dtMs: gyroTimeline.dtMs, sampleRateHz: gyroTimeline.sampleRateHz }),
    trignoEmitter.emit(ctx, 'gyroZ', samples.z, { t0Ms, dtMs: gyroTimeline.dtMs, sampleRateHz: gyroTimeline.sampleRateHz }),
  ]);
}

async function openSession(
  ctx: PluginContext,
  request: TrignoConnectRequest,
  requestId?: string,
): Promise<TrignoTcpSession> {
  const session = new TrignoTcpSession(sessionOptions(request));
  await session.connect();
  await session.applyProfileConfig();
  const snapshot = await session.queryStatus();
  resetTimelines(snapshot);
  resetDataActivity();

  session.setDataCallbacks({
    onEmgSamples: (values) => {
      if (currentSession !== session || !shouldStream) return;
      markDataActivity(ctx, 'emg');
      void emitEmgBatch(ctx, values).catch(() => undefined);
    },
    onGyroSamples: (samples) => {
      if (currentSession !== session || !shouldStream) return;
      markDataActivity(ctx, 'aux');
      void emitGyroBatches(ctx, samples).catch(() => undefined);
    },
  });

  await session.openDataSockets();
  await emitStatusSnapshot(ctx, snapshot, requestId);
  return session;
}

async function startStreaming(ctx: PluginContext, requestId?: string): Promise<void> {
  if (!currentSession) {
    throw new Error('Trigno не подключён');
  }
  const snapshot = await validateStartSnapshot(ctx, requestId);
  resetTimelines(snapshot);
  resetDataActivity();
  shouldStream = true;
  markDataActivity(ctx, 'emg');
  markDataActivity(ctx, 'aux');
  await currentSession.start();
}

async function stopStreaming(requestId: string | undefined): Promise<void> {
  if (!currentSession) return;
  if (!shouldStream) return;
  shouldStream = false;
  await currentSession.stop().catch((error) => {
    throw new Error(`Не удалось остановить Trigno (${requestId ?? 'no-request-id'}): ${normalizeError(error)}`);
  });
}

async function handleConnect(ctx: PluginContext, payload: AdapterConnectRequestPayload): Promise<void> {
  try {
    if (trignoState.isState('connecting', 'connected', 'disconnecting', 'paused')) {
      throw new Error('Trigno уже подключён или находится в процессе connect/disconnect');
    }

    const request = buildTrignoConnectRequest(payload.formData);
    manualDisconnectRequested = false;
    lastConnectRequest = request;
    resetReconnectState();
    shouldStream = false;
    resetDataActivity();
    await setAdapterRuntimeState(ctx, 'connecting', payload.requestId);
    await waitForConnectCooldown(ctx);

    currentSession = await openSession(ctx, request, payload.requestId);
    shouldStream = false;
    resetTimelines(lastStatusSnapshot);
    await setAdapterRuntimeState(ctx, 'paused', payload.requestId, 'Trigno подключён и готов к запуску');
  } catch (error) {
    const message = normalizeError(error);
    await closeCurrentSession();
    armConnectCooldown(ctx);
    await setAdapterRuntimeState(ctx, 'failed', payload.requestId, message);
  }
}

async function handleDisconnect(ctx: PluginContext, payload: AdapterDisconnectRequestPayload): Promise<void> {
  manualDisconnectRequested = true;
  lastConnectRequest = null;
  shouldStream = false;
  resetReconnectState();

  if (trignoState.isState('disconnected') && !currentSession) {
    return;
  }

  await setAdapterRuntimeState(ctx, 'disconnecting', payload.requestId);
  await stopStreaming(payload.requestId).catch(() => undefined);
  await closeCurrentSession();
  armConnectCooldown(ctx);
  resetDataActivity();
  lastStatusSnapshot = null;
  await setAdapterRuntimeState(ctx, 'disconnected', payload.requestId);
}

async function handleStartRequest(ctx: PluginContext, payload: TrignoCommandRequestPayload): Promise<void> {
  try {
    if (!currentSession) {
      throw new Error('Trigno не подключён');
    }
    if (!trignoState.isState('paused', 'connected')) {
      throw new Error('Trigno нельзя запустить в текущем состоянии');
    }

    if (trignoState.isState('connected') && shouldStream) {
      return;
    }

    await setAdapterRuntimeState(ctx, 'connecting', payload.requestId, 'Запуск Trigno...');
    await startStreaming(ctx, payload.requestId);
    await setAdapterRuntimeState(ctx, 'connected', payload.requestId);
  } catch (error) {
    if (error instanceof TrignoStartBlockedError) {
      shouldStream = false;
      await setAdapterRuntimeState(ctx, 'paused', payload.requestId, error.message);
      return;
    }
    const message = normalizeError(error);
    shouldStream = false;
    await setAdapterRuntimeState(ctx, 'failed', payload.requestId, message);
  }
}

async function handleStopRequest(ctx: PluginContext, payload: TrignoCommandRequestPayload): Promise<void> {
  try {
    if (!currentSession) return;
    if (!shouldStream && trignoState.isState('paused')) return;

    await stopStreaming(payload.requestId);
    resetTimelines(lastStatusSnapshot);
    await setAdapterRuntimeState(ctx, 'paused', payload.requestId);
  } catch (error) {
    await setAdapterRuntimeState(ctx, 'failed', payload.requestId, normalizeError(error));
  }
}

async function handleRefreshRequest(ctx: PluginContext, payload: TrignoCommandRequestPayload): Promise<void> {
  try {
    if (!currentSession) {
      throw new Error('Trigno не подключён');
    }
    const snapshot = await currentSession.queryStatus();
    resetTimelines(snapshot);
    await emitStatusSnapshot(ctx, snapshot, payload.requestId);
  } catch (error) {
    await setAdapterRuntimeState(ctx, 'failed', payload.requestId, normalizeError(error));
  }
}

async function scheduleReconnect(ctx: PluginContext, reason: string): Promise<void> {
  shouldStream = false;
  reconnectReason = reason;

  if (!config.autoReconnect || manualDisconnectRequested || !lastConnectRequest) {
    await closeCurrentSession();
    await setAdapterRuntimeState(ctx, 'failed', undefined, reason);
    return;
  }

  if (reconnectPolicy.getNextAttemptSessionMs() !== null) {
    return;
  }

  await closeCurrentSession();
  armConnectCooldown(ctx);
  reconnectPolicy.schedule(ctx.clock.nowSessionMs());
  await setAdapterRuntimeState(ctx, 'connecting', undefined, `Автопереподключение Trigno: ${reason}`);
}

async function failDisconnectedPausedSession(ctx: PluginContext, reason: string): Promise<void> {
  // В paused оператор явно управляет запуском, поэтому скрытое переподключение здесь вредно.
  shouldStream = false;
  resetReconnectState();
  await closeCurrentSession();
  armConnectCooldown(ctx);
  await setAdapterRuntimeState(ctx, 'failed', undefined, reason);
}

async function tryPendingReconnect(ctx: PluginContext): Promise<void> {
  if (!lastConnectRequest || reconnectPolicy.getNextAttemptSessionMs() === null) {
    return;
  }
  if (!reconnectPolicy.isReady(ctx.clock.nowSessionMs())) {
    return;
  }

  const reconnectAttempt = reconnectPolicy.getAttempt();
  try {
    await waitForConnectCooldown(ctx);
    currentSession = await openSession(ctx, lastConnectRequest);
    reconnectReason = null;
    await startStreaming(ctx);
    resetReconnectState();
    await setAdapterRuntimeState(ctx, 'connected', undefined, 'Автопереподключение Trigno выполнено');
  } catch (error) {
    if (error instanceof TrignoStartBlockedError) {
      reconnectReason = error.message;
      reconnectPolicy.cancel();
      shouldStream = false;
      await setAdapterRuntimeState(ctx, 'paused', undefined, error.message);
      return;
    }

    reconnectPolicy.schedule(ctx.clock.nowSessionMs());
    reconnectReason = normalizeError(error);
    await closeCurrentSession();
    armConnectCooldown(ctx);
    await setAdapterRuntimeState(
      ctx,
      'connecting',
      undefined,
      `Автопереподключение Trigno #${reconnectAttempt}: ${reconnectReason}`,
    );
  }
}

async function handlePoll(ctx: PluginContext): Promise<void> {
  if (currentSession) {
    const disconnectReason = currentSession.takeDisconnectReason();
    if (disconnectReason) {
      if (!shouldStream || trignoState.isState('paused')) {
        await failDisconnectedPausedSession(ctx, disconnectReason);
        return;
      }
      await scheduleReconnect(ctx, disconnectReason);
      return;
    }
  }

  if (shouldStream && trignoState.isState('connected')) {
    const now = ctx.clock.nowSessionMs();
    const emgAgeMs = lastEmgDataSessionMs === null ? config.dataSilenceTimeoutMs + 1 : now - lastEmgDataSessionMs;
    const auxAgeMs = lastAuxDataSessionMs === null ? config.dataSilenceTimeoutMs + 1 : now - lastAuxDataSessionMs;
    if (emgAgeMs > config.dataSilenceTimeoutMs || auxAgeMs > config.dataSilenceTimeoutMs) {
      await scheduleReconnect(
        ctx,
        `нет данных EMG/AUX ${Math.round(Math.max(emgAgeMs, auxAgeMs))}ms`,
      );
      return;
    }
  }

  if (trignoState.isState('connecting') && reconnectPolicy.getNextAttemptSessionMs() !== null) {
    await tryPendingReconnect(ctx);
  }
}

export default definePlugin({
  manifest: {
    id: 'trigno-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.adapterConnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: TrignoEventTypes.streamStartRequest, v: 1, kind: 'command', priority: 'control' },
      { type: TrignoEventTypes.streamStopRequest, v: 1, kind: 'command', priority: 'control' },
      { type: TrignoEventTypes.statusRefreshRequest, v: 1, kind: 'command', priority: 'control' },
      { type: TrignoEventTypes.poll, v: 1, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 256,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.adapterStateChanged, v: 1 },
      { type: EventTypes.signalBatch, v: 1 },
      { type: TrignoEventTypes.statusReported, v: 1 },
      { type: TrignoEventTypes.poll, v: 1 },
    ],
  },
  async onInit(ctx) {
    config = resolveTrignoAdapterConfig(ctx.getConfig<TrignoAdapterConfig>());
    trignoState = createAdapterStateHolder({ adapterId: config.adapterId });
    reconnectPolicy = createReconnectPolicy({ initialDelayMs: config.reconnectRetryDelayMs });
    currentSession = null;
    lastConnectRequest = null;
    lastStatusSnapshot = null;
    manualDisconnectRequested = false;
    shouldStream = false;
    resetReconnectState();
    resetDataActivity();
    resetTimelines(null);
    nextConnectAllowedSessionMs = null;
    startPolling(ctx);
    await trignoState.emitCurrent(ctx);
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.adapterConnectRequest) {
      if (event.payload.adapterId !== config.adapterId) return;
      await handleConnect(ctx, event.payload);
      return;
    }

    if (event.type === EventTypes.adapterDisconnectRequest) {
      if (event.payload.adapterId !== config.adapterId) return;
      await handleDisconnect(ctx, event.payload);
      return;
    }

    if (event.type === TrignoEventTypes.streamStartRequest) {
      if (event.payload.adapterId !== config.adapterId) return;
      await handleStartRequest(ctx, event.payload);
      return;
    }

    if (event.type === TrignoEventTypes.streamStopRequest) {
      if (event.payload.adapterId !== config.adapterId) return;
      await handleStopRequest(ctx, event.payload);
      return;
    }

    if (event.type === TrignoEventTypes.statusRefreshRequest) {
      if (event.payload.adapterId !== config.adapterId) return;
      await handleRefreshRequest(ctx, event.payload);
      return;
    }

    if (event.type === TrignoEventTypes.poll) {
      await handlePoll(ctx);
    }
  },
  async onShutdown(ctx) {
    stopPolling(ctx);
    shouldStream = false;
    manualDisconnectRequested = true;
    await closeCurrentSession();
    trignoState = createAdapterStateHolder({ adapterId: config.adapterId });
    reconnectPolicy = createReconnectPolicy({ initialDelayMs: config.reconnectRetryDelayMs });
    lastConnectRequest = null;
    lastStatusSnapshot = null;
    resetReconnectState();
    resetDataActivity();
    resetTimelines(null);
    nextConnectAllowedSessionMs = null;
  },
});
