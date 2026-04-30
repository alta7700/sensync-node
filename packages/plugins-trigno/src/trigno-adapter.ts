import './generated-runtime-event-map.ts';

import {
  defineRuntimeEventInput,
  EventTypes,
  type AdapterConnectRequestPayload,
  type AdapterDisconnectRequestPayload,
} from '@sensync2/core';
import {
  createAdapterStateHolder,
  createTimelineResetParticipant,
  clipSignalBatchToTimelineStart,
  createReconnectPolicy,
} from '@sensync2/plugin-kit';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import {
  buildTrignoExpectedStartSnapshot,
  buildTrignoConnectRequest,
  diffTrignoExpectedStartSnapshot,
  formatTrignoSnapshotMismatchMessage,
  isPairedTrignoConnectRequest,
  isPairedTrignoStatusSnapshot,
  resolveTrignoAdapterConfig,
  TrignoEventTypes,
  type TrignoAdapterConfig,
  type TrignoCommandRequestPayload,
  type TrignoConnectRequest,
  type TrignoSensorStatusSnapshot,
  type TrignoStatusReportedPayload,
  type TrignoStatusSnapshot,
} from './trigno-boundary.ts';
import {
  TrignoTcpSession,
  type TrignoDataSensorKey,
  type TrignoTcpSessionOptions,
} from './trigno-transport.ts';

const TrignoPollTimerId = 'trigno.poll';
const TrignoSensorKeys = ['single', 'vl', 'rf'] as const satisfies readonly TrignoDataSensorKey[];

const TrignoStreamDescriptors = {
  single: {
    emg: { streamId: 'trigno.avanti', units: 'V' },
    gyroX: { streamId: 'trigno.avanti.gyro.x', units: 'deg/s' },
    gyroY: { streamId: 'trigno.avanti.gyro.y', units: 'deg/s' },
    gyroZ: { streamId: 'trigno.avanti.gyro.z', units: 'deg/s' },
  },
  vl: {
    emg: { streamId: 'trigno.vl.avanti', units: 'V' },
    gyroX: { streamId: 'trigno.vl.avanti.gyro.x', units: 'deg/s' },
    gyroY: { streamId: 'trigno.vl.avanti.gyro.y', units: 'deg/s' },
    gyroZ: { streamId: 'trigno.vl.avanti.gyro.z', units: 'deg/s' },
  },
  rf: {
    emg: { streamId: 'trigno.rf.avanti', units: 'V' },
    gyroX: { streamId: 'trigno.rf.avanti.gyro.x', units: 'deg/s' },
    gyroY: { streamId: 'trigno.rf.avanti.gyro.y', units: 'deg/s' },
    gyroZ: { streamId: 'trigno.rf.avanti.gyro.z', units: 'deg/s' },
  },
} as const;

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

type TimelineMap = Record<TrignoDataSensorKey, StreamTimeline>;
type ResetCutoffMap = Record<TrignoDataSensorKey, number | null>;

function createDefaultTimeline(): StreamTimeline {
  return { nextT0Ms: null, dtMs: 1, sampleRateHz: 1 };
}

function createDefaultTimelineMap(): TimelineMap {
  return {
    single: createDefaultTimeline(),
    vl: createDefaultTimeline(),
    rf: createDefaultTimeline(),
  };
}

function createDefaultResetCutoffMap(): ResetCutoffMap {
  return {
    single: null,
    vl: null,
    rf: null,
  };
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
let emgTimelines = createDefaultTimelineMap();
let gyroTimelines = createDefaultTimelineMap();
let emgResetCutoffSessionMs = createDefaultResetCutoffMap();
let gyroResetCutoffSessionMs = createDefaultResetCutoffMap();
let trignoState = createAdapterStateHolder({ adapterId: config.adapterId });
let reconnectPolicy = createReconnectPolicy({ initialDelayMs: config.reconnectRetryDelayMs });
const timelineResetParticipant = createTimelineResetParticipant({
  onPrepare: async (_input, ctx) => {
    stopPolling(ctx);
  },
  onAbort: async (_input, ctx) => {
    if (shouldPollAfterReset()) {
      startPolling(ctx);
    }
  },
  onCommit: async (input, ctx) => {
    if (lastStatusSnapshot) {
      resetTimelines(lastStatusSnapshot);
    } else {
      resetTimelines(null);
    }
    if (currentSession && shouldStream && trignoState.isState('connected')) {
      setResetCutoffForActiveSensors(emgResetCutoffSessionMs, lastStatusSnapshot, input.timelineStartSessionMs);
      setResetCutoffForActiveSensors(gyroResetCutoffSessionMs, lastStatusSnapshot, input.timelineStartSessionMs);
      lastEmgDataSessionMs = input.timelineStartSessionMs;
      lastAuxDataSessionMs = input.timelineStartSessionMs;
    } else {
      emgResetCutoffSessionMs = createDefaultResetCutoffMap();
      gyroResetCutoffSessionMs = createDefaultResetCutoffMap();
      resetDataActivity();
    }
    if (shouldPollAfterReset()) {
      startPolling(ctx);
    }
    await trignoState.emitCurrent(ctx);
  },
});

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

function activeSensorKeys(snapshot: TrignoStatusSnapshot | null): TrignoDataSensorKey[] {
  if (!snapshot) {
    return ['single'];
  }
  if (isPairedTrignoStatusSnapshot(snapshot)) {
    return ['vl', 'rf'];
  }
  return ['single'];
}

function sensorSnapshotByKey(snapshot: TrignoStatusSnapshot, sensorKey: Exclude<TrignoDataSensorKey, 'single'>): TrignoSensorStatusSnapshot {
  if (!isPairedTrignoStatusSnapshot(snapshot)) {
    throw new Error(`Для ключа ${sensorKey} ожидался paired snapshot Trigno`);
  }
  return snapshot.sensors[sensorKey];
}

function resolveSensorSnapshot(snapshot: TrignoStatusSnapshot, sensorKey: TrignoDataSensorKey): TrignoSensorStatusSnapshot {
  if (sensorKey === 'single') {
    if (isPairedTrignoStatusSnapshot(snapshot)) {
      throw new Error('Для single timeline нельзя использовать paired snapshot Trigno');
    }
    return snapshot;
  }
  return sensorSnapshotByKey(snapshot, sensorKey);
}

function assignTimeline(target: StreamTimeline, rateHz: number): void {
  target.nextT0Ms = null;
  target.sampleRateHz = rateHz;
  target.dtMs = 1_000 / rateHz;
}

function resetTimelines(snapshot: TrignoStatusSnapshot | null): void {
  if (!snapshot) {
    emgTimelines = createDefaultTimelineMap();
    gyroTimelines = createDefaultTimelineMap();
    return;
  }
  emgTimelines = createDefaultTimelineMap();
  gyroTimelines = createDefaultTimelineMap();
  for (const sensorKey of activeSensorKeys(snapshot)) {
    const sensorSnapshot = resolveSensorSnapshot(snapshot, sensorKey);
    assignTimeline(emgTimelines[sensorKey], sensorSnapshot.emg.rateHz);
    assignTimeline(gyroTimelines[sensorKey], sensorSnapshot.gyro.rateHz);
  }
}

function setResetCutoffForActiveSensors(
  target: ResetCutoffMap,
  snapshot: TrignoStatusSnapshot | null,
  timelineStartSessionMs: number,
): void {
  for (const sensorKey of TrignoSensorKeys) {
    target[sensorKey] = null;
  }
  for (const sensorKey of activeSensorKeys(snapshot)) {
    target[sensorKey] = timelineStartSessionMs;
  }
}

function resetDataActivity(): void {
  lastEmgDataSessionMs = null;
  lastAuxDataSessionMs = null;
}

function shouldPollAfterReset(): boolean {
  return currentSession !== null || reconnectPolicy.getNextAttemptSessionMs() !== null;
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
  const baseOptions: TrignoTcpSessionOptions = {
    host: request.host,
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

  if (isPairedTrignoConnectRequest(request)) {
    return {
      ...baseOptions,
      vlSensorSlot: request.vlSensorSlot,
      rfSensorSlot: request.rfSensorSlot,
    };
  }

  return {
    ...baseOptions,
    sensorSlot: request.sensorSlot,
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
  const expected = buildTrignoExpectedStartSnapshot(config);
  const mismatches = isPairedTrignoStatusSnapshot(snapshot)
    ? (['vl', 'rf'] as const).flatMap((sensorKey) => {
      return diffTrignoExpectedStartSnapshot(snapshot.sensors[sensorKey], expected).map((mismatch) => ({
        ...mismatch,
        field: `${sensorKey}.${mismatch.field}`,
      }));
    })
    : diffTrignoExpectedStartSnapshot(snapshot, expected);
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

function createSignalBatchEvent(
  sensorKey: TrignoDataSensorKey,
  signalKey: 'emg' | 'gyroX' | 'gyroY' | 'gyroZ',
  values: Float32Array,
  timeline: StreamTimeline,
  t0Ms: number,
) {
  const descriptor = TrignoStreamDescriptors[sensorKey][signalKey];
  return defineRuntimeEventInput({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    payload: {
      streamId: descriptor.streamId,
      sampleFormat: 'f32',
      frameKind: 'uniform-signal-batch',
      units: descriptor.units,
      t0Ms,
      dtMs: timeline.dtMs,
      sampleRateHz: timeline.sampleRateHz,
      sampleCount: values.length,
      values,
    },
  });
}

async function emitEmgBatch(ctx: PluginContext, sensorKey: TrignoDataSensorKey, values: Float32Array): Promise<void> {
  const timeline = emgTimelines[sensorKey];
  const t0Ms = nextBatchT0(ctx, timeline, values.length);
  const event = createSignalBatchEvent(sensorKey, 'emg', values, timeline, t0Ms);
  const cutoffSessionMs = emgResetCutoffSessionMs[sensorKey];
  if (cutoffSessionMs !== null) {
    const clipped = clipSignalBatchToTimelineStart(event.payload, cutoffSessionMs);
    if (clipped.kind === 'drop') {
      return;
    }
    emgResetCutoffSessionMs[sensorKey] = null;
    await ctx.emit({ ...event, payload: clipped.payload });
    return;
  }
  await ctx.emit(event);
}

async function emitGyroBatches(
  ctx: PluginContext,
  sensorKey: TrignoDataSensorKey,
  samples: { x: Float32Array; y: Float32Array; z: Float32Array },
): Promise<void> {
  const timeline = gyroTimelines[sensorKey];
  const t0Ms = nextBatchT0(ctx, timeline, samples.x.length);
  const events = [
    createSignalBatchEvent(sensorKey, 'gyroX', samples.x, timeline, t0Ms),
    createSignalBatchEvent(sensorKey, 'gyroY', samples.y, timeline, t0Ms),
    createSignalBatchEvent(sensorKey, 'gyroZ', samples.z, timeline, t0Ms),
  ];

  const cutoffSessionMs = gyroResetCutoffSessionMs[sensorKey];
  if (cutoffSessionMs !== null) {
    const clippedEvents = events.flatMap((event) => {
      const clipped = clipSignalBatchToTimelineStart(event.payload, cutoffSessionMs);
      if (clipped.kind === 'drop') {
        return [];
      }
      return [{ ...event, payload: clipped.payload }];
    });
    if (clippedEvents.length === 0) {
      return;
    }
    gyroResetCutoffSessionMs[sensorKey] = null;
    await Promise.all(clippedEvents.map((event) => ctx.emit(event)));
    return;
  }

  await Promise.all(events.map((event) => ctx.emit(event)));
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
    onSensorEmgSamples: (sensorKey, values) => {
      if (currentSession !== session || !shouldStream) return;
      markDataActivity(ctx, 'emg');
      void emitEmgBatch(ctx, sensorKey, values).catch(() => undefined);
    },
    onSensorGyroSamples: (sensorKey, samples) => {
      if (currentSession !== session || !shouldStream) return;
      markDataActivity(ctx, 'aux');
      void emitGyroBatches(ctx, sensorKey, samples).catch(() => undefined);
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
    emgResetCutoffSessionMs = createDefaultResetCutoffMap();
    gyroResetCutoffSessionMs = createDefaultResetCutoffMap();
    nextConnectAllowedSessionMs = null;
    timelineResetParticipant.initialize(ctx.currentTimelineId());
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
    emgResetCutoffSessionMs = createDefaultResetCutoffMap();
    gyroResetCutoffSessionMs = createDefaultResetCutoffMap();
    nextConnectAllowedSessionMs = null;
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
