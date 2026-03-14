import { randomUUID } from 'node:crypto';
import {
  defineRuntimeEventInput,
  EventTypes,
  type AdapterConnectRequestPayload,
  type AdapterDisconnectRequestPayload,
  type AdapterScanCandidate,
  type AdapterScanCandidatesPayload,
  type AdapterScanRequestPayload,
  type AdapterScanStateChangedPayload,
  type AdapterStateChangedPayload,
  type SignalBatchEvent,
} from '@sensync2/core';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import {
  buildAntTransportConnectRequest,
  buildAntTransportScanRequest,
  decodeRawMoxyPacketMeta,
  loadAntPlusApi,
  readAntPlusEnvOverrides,
  realPacketFromState,
  resolveAntPlusConfig,
  type AntEventEmitterLike,
  type AntPlusAdapterConfig,
  type AntPlusApi,
  type AntPlusSensor,
  type AntPlusStick,
  type AntTransportConnectRequest,
  type AntTransportPacket,
  type AntTransportScanRequest,
  type FakeAntTransportConfig,
  type RawMoxyPacketMeta,
  type RealMuscleOxygenState,
} from './ant-plus-boundary.ts';

interface AntTransportScanResult {
  scanId: string;
  candidates: AdapterScanCandidate[];
}

interface AntTransport {
  readonly mode: 'fake' | 'real';
  scan(request: AntTransportScanRequest): Promise<AntTransportScanResult>;
  connect(request: AntTransportConnectRequest): Promise<void>;
  disconnect(): Promise<void>;
  readPacket(): AntTransportPacket | null;
  takeConnectionSignal(): string | null;
}

const PacketPollType = 'ant-plus.packet.poll';
let config = resolveAntPlusConfig(undefined);
let transport: AntTransport | null = null;
let runtimeState: AdapterStateChangedPayload['state'] = 'disconnected';
let scanInFlight = false;
let manualDisconnectRequested = false;
let lastConnectRequest: AntTransportConnectRequest | null = null;
let reconnectAttempt = 0;
let reconnectReason: string | null = null;
let reconnectNextAttemptSessionMs: number | null = null;
let connectionStartedSessionMs: number | null = null;
let lastEventCount: number | null = null;
let lastMeasurementTimeMs: number | null = null;
let lastPacketArrivalMonoMs: number | null = null;
let lastPacketSeenSessionMs: number | null = null;
let nextFakePacketDueSessionMs: number | null = null;
let lastDriftWarningAtSessionMs: number | null = null;
let lastIntervalMismatchWarningAtMonoMs: number | null = null;
let lastIntervalMismatchWarningSignature: string | null = null;
let lastPacketGapWarningAtSessionMs: number | null = null;
let lastBroadcastDeltaMs: number | null = null;
let broadcastPeriodEstimateMs: number | null = null;
let maxBroadcastGapMs = 0;
let broadcastGapCount = 0;
let approxMissingBroadcastsTotal = 0;
let lastEventAdvance = 1;
let lastProfileIntervalFieldMs: number | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

function waitForEmitterEvent(
  emitter: AntEventEmitterLike,
  eventName: string,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout | null = null;
    const listener = () => {
      if (timeoutId) clearTimeout(timeoutId);
      emitter.removeListener(eventName, listener);
      resolve();
    };

    timeoutId = setTimeout(() => {
      emitter.removeListener(eventName, listener);
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    emitter.on(eventName, listener);
  });
}

async function closeStickSafely(stick: AntPlusStick | null): Promise<void> {
  if (!stick) return;

  try {
    const shutdownPromise = waitForEmitterEvent(stick, 'shutdown', 1_000, 'ANT+ stick не прислал shutdown');
    stick.close();
    await shutdownPromise.catch(() => undefined);
  } catch {
    // Игнорируем ошибки закрытия: при следующем scan/connect попробуем открыть новый stick.
  }
}


function adapterStateEvent(
  adapterId: string,
  state: AdapterStateChangedPayload['state'],
  message?: string,
  requestId?: string,
) {
  const payload: AdapterStateChangedPayload = { adapterId, state };
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return defineRuntimeEventInput({
    type: EventTypes.adapterStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

function adapterScanStateEvent(
  adapterId: string,
  scanning: boolean,
  requestId?: string,
  scanId?: string,
  message?: string,
) {
  const payload: AdapterScanStateChangedPayload = { adapterId, scanning };
  if (requestId !== undefined) payload.requestId = requestId;
  if (scanId !== undefined) payload.scanId = scanId;
  if (message !== undefined) payload.message = message;
  return defineRuntimeEventInput({
    type: EventTypes.adapterScanStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

function adapterScanCandidatesEvent(
  adapterId: string,
  scanId: string,
  candidates: AdapterScanCandidate[],
  requestId?: string,
) {
  const payload: AdapterScanCandidatesPayload = {
    adapterId,
    scanId,
    candidates,
  };
  if (requestId !== undefined) payload.requestId = requestId;
  return defineRuntimeEventInput({
    type: EventTypes.adapterScanCandidates,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

function signalBatchEvent(
  streamId: string,
  channelId: string,
  value: number,
  t0Ms: number,
  dtMs: number,
  units: string,
): Omit<SignalBatchEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  return defineRuntimeEventInput({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    payload: {
      streamId,
      channelId,
      sampleFormat: 'f32',
      frameKind: 'uniform-signal-batch',
      t0Ms,
      dtMs,
      sampleRateHz: 1000 / dtMs,
      sampleCount: 1,
      values: new Float32Array([value]),
      units,
    },
  });
}

function emitMoxyQualityMetrics(ctx: PluginContext): void {
  const tags = {
    adapterId: config.adapterId,
    profile: 'muscle-oxygen',
  };

  if (lastBroadcastDeltaMs !== null) {
    ctx.telemetry({ name: 'moxy.broadcast_delta_ms', value: lastBroadcastDeltaMs, unit: 'ms', tags });
  }
  ctx.telemetry({ name: 'moxy.broadcast_gap_total', value: broadcastGapCount, unit: 'count', tags });
  ctx.telemetry({ name: 'moxy.missing_broadcast_total', value: approxMissingBroadcastsTotal, unit: 'count', tags });
  ctx.telemetry({ name: 'moxy.max_broadcast_gap_ms', value: maxBroadcastGapMs, unit: 'ms', tags });
  ctx.telemetry({ name: 'moxy.event_advance', value: lastEventAdvance, unit: 'count', tags });
  if (broadcastPeriodEstimateMs !== null) {
    ctx.telemetry({ name: 'moxy.broadcast_period_estimate_ms', value: broadcastPeriodEstimateMs, unit: 'ms', tags });
  }
  if (lastProfileIntervalFieldMs !== null) {
    ctx.telemetry({ name: 'moxy.profile_interval_field_ms', value: lastProfileIntervalFieldMs, unit: 'ms', tags });
  }
}

function updateBroadcastPeriodEstimate(deltaMonoMs: number): number {
  const boundedDeltaMs = Math.max(1, deltaMonoMs);
  if (broadcastPeriodEstimateMs === null) {
    broadcastPeriodEstimateMs = boundedDeltaMs;
    return broadcastPeriodEstimateMs;
  }

  // Обучаем baseline только на значениях, похожих на обычный каденс broadcast.
  // Крупные паузы считаем аномалией связи и не даём им "съесть" оценку периода.
  const nearBaseline = boundedDeltaMs <= (broadcastPeriodEstimateMs * 1.35);
  if (nearBaseline) {
    broadcastPeriodEstimateMs = (broadcastPeriodEstimateMs * 0.8) + (boundedDeltaMs * 0.2);
  }

  return broadcastPeriodEstimateMs;
}

class FakeAntTransport implements AntTransport {
  readonly mode = 'fake' as const;
  private config: FakeAntTransportConfig;
  private connected = false;
  private eventCount = 0;
  private sampleIndex = 0;
  private lastScanId: string | null = null;

  constructor(config: FakeAntTransportConfig) {
    this.config = config;
  }

  async scan(request: AntTransportScanRequest): Promise<AntTransportScanResult> {
    await sleep(this.config.scanDelayMs);
    if (!this.config.stickPresent) {
      throw new Error('ANT+ stick не найден');
    }

    const scanId = randomUUID();
    this.lastScanId = scanId;
    const candidateId = this.candidateId();
    return {
      scanId,
      candidates: [
        {
          candidateId,
          title: `Moxy ${this.config.candidateDeviceId}`,
          subtitle: request.profile === 'muscle-oxygen' ? 'Muscle Oxygen' : 'ANT+ устройство',
          details: {
            deviceId: this.config.candidateDeviceId,
            transmissionType: this.config.transmissionType,
          },
          connectFormData: {
            profile: request.profile ?? 'muscle-oxygen',
            scanId,
            candidateId,
            deviceId: this.config.candidateDeviceId,
          },
        },
      ],
    };
  }

  async connect(request: AntTransportConnectRequest): Promise<void> {
    if (!this.config.stickPresent) {
      throw new Error('ANT+ stick не найден');
    }
    if (request.scanId && this.lastScanId && request.scanId !== this.lastScanId) {
      throw new Error('Выбранный scanId больше не актуален');
    }
    if (request.candidateId && request.candidateId !== this.candidateId()) {
      throw new Error('Выбранное устройство не найдено в последнем scan');
    }
    this.connected = true;
    this.eventCount = 0;
    this.sampleIndex = 0;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  readPacket(): AntTransportPacket | null {
    if (!this.connected) return null;

    const phase = this.sampleIndex / 10;
    const smo2 = 70 + Math.sin(phase * 0.55) * 5 + Math.sin(phase * 0.12) * 1.5;
    const thb = 12 + Math.cos(phase * 0.33) * 0.8;
    const packet: AntTransportPacket = {
      eventCount: this.eventCount & 0xff,
      measurementIntervalMs: this.config.measurementIntervalMs,
      smo2: Math.round(smo2 * 10) / 10,
      thb: Math.round(thb * 100) / 100,
    };
    this.eventCount = (this.eventCount + 1) & 0xff;
    this.sampleIndex += 1;
    return packet;
  }

  takeConnectionSignal(): string | null {
    return null;
  }

  private candidateId(): string {
    return `moxy:${this.config.candidateDeviceId}:31:${this.config.transmissionType}`;
  }
}

class RealAntTransport implements AntTransport {
  readonly mode = 'real' as const;

  private api: AntPlusApi | null = null;
  private stick: AntPlusStick | null = null;
  private sensor: AntPlusSensor | null = null;
  private packetQueue: AntTransportPacket[] = [];
  private lastQueuedEventCount: number | null = null;
  private lastScanId: string | null = null;
  private lastScanDevices = new Map<string, number>();
  private rawPacketMetaByEventCount = new Map<number, RawMoxyPacketMeta>();
  private rawReadListener: ((...args: unknown[]) => void) | null = null;
  private oxygenDataListener: ((...args: unknown[]) => void) | null = null;
  private detachedListener: ((...args: unknown[]) => void) | null = null;
  private connectionSignal: string | null = null;

  private ensureApi(): AntPlusApi {
    if (this.api) return this.api;
    this.api = loadAntPlusApi();
    return this.api;
  }

  private async openStick(): Promise<AntPlusStick> {
    const api = this.ensureApi();
    const constructors = [api.GarminStick3, api.GarminStick2] as const;
    let lastError: unknown = null;

    for (const StickCtor of constructors) {
      const stick = new StickCtor();
      try {
        if (!stick.open()) {
          lastError = new Error('ANT+ stick не найден');
          continue;
        }
        await waitForEmitterEvent(stick, 'startup', 2_000, 'ANT+ stick не прислал startup');
        return stick;
      } catch (error) {
        lastError = error;
        await closeStickSafely(stick);
      }
    }

    throw (lastError instanceof Error ? lastError : new Error('ANT+ stick не найден'));
  }

  private async stopSensor(): Promise<void> {
    if (!this.sensor) return;
    const sensor = this.sensor;
    if (this.oxygenDataListener) {
      sensor.removeListener('oxygenData', this.oxygenDataListener);
      this.oxygenDataListener = null;
    }
    if (this.detachedListener) {
      sensor.removeListener('detached', this.detachedListener);
      this.detachedListener = null;
    }
    this.sensor = null;
    try {
      const detachedPromise = waitForEmitterEvent(sensor, 'detached', 1_000, 'ANT+ sensor не прислал detached');
      sensor.detach();
      await detachedPromise.catch(() => undefined);
    } catch {
      // Игнорируем detach-ошибки: после этого все равно закрываем stick.
    }
  }

  private forgetOldRawPacketMeta(): void {
    while (this.rawPacketMetaByEventCount.size > 64) {
      const firstKey = this.rawPacketMetaByEventCount.keys().next().value;
      if (firstKey === undefined) break;
      this.rawPacketMetaByEventCount.delete(firstKey);
    }
  }

  private installRawReadListener(stick: AntPlusStick, sensor: AntPlusSensor): void {
    if (this.rawReadListener) {
      stick.removeListener('read', this.rawReadListener);
      this.rawReadListener = null;
    }

    const listener = (...args: unknown[]) => {
      const data = args[0];
      if (!Buffer.isBuffer(data)) return;
      const meta = decodeRawMoxyPacketMeta(data, sensor.channel);
      if (!meta) return;
      this.rawPacketMetaByEventCount.set(meta.eventCount, meta);
      this.forgetOldRawPacketMeta();
    };

    this.rawReadListener = listener;
    if (typeof stick.prependListener === 'function') {
      stick.prependListener('read', listener);
      return;
    }
    stick.on('read', listener);
  }

  private uninstallRawReadListener(): void {
    if (!this.stick || !this.rawReadListener) return;
    this.stick.removeListener('read', this.rawReadListener);
    this.rawReadListener = null;
    this.rawPacketMetaByEventCount.clear();
  }

  async scan(request: AntTransportScanRequest): Promise<AntTransportScanResult> {
    await this.disconnect();

    const stick = await this.openStick();
    const api = this.ensureApi();
    const scanner = new api.MuscleOxygenScanner(stick);
    const scanId = randomUUID();
    const candidates = new Map<string, AdapterScanCandidate>();

    const onOxygenData = (...args: unknown[]) => {
      const state = args[0] as RealMuscleOxygenState | undefined;
      if (!state || typeof state.DeviceID !== 'number' || !Number.isFinite(state.DeviceID)) {
        return;
      }

      const candidateId = `moxy:${state.DeviceID}`;
      candidates.set(candidateId, {
        candidateId,
        title: `Moxy ${state.DeviceID}`,
        subtitle: request.profile === 'muscle-oxygen' ? 'Muscle Oxygen' : 'ANT+ устройство',
        details: {
          deviceId: state.DeviceID,
        },
        connectFormData: {
          profile: request.profile ?? 'muscle-oxygen',
          scanId,
          candidateId,
          deviceId: state.DeviceID,
        },
      });
    };

    scanner.on('oxygenData', onOxygenData);
    try {
      const attachedPromise = waitForEmitterEvent(scanner, 'attached', 1_500, 'ANT+ scanner не перешёл в scan');
      scanner.scan();
      await attachedPromise;
      await sleep(request.timeoutMs ?? 5_000);
    } finally {
      scanner.removeListener('oxygenData', onOxygenData);
      try {
        const detachedPromise = waitForEmitterEvent(scanner, 'detached', 1_000, 'ANT+ scanner не прислал detached');
        scanner.detach();
        await detachedPromise.catch(() => undefined);
      } catch {
        // Игнорируем: scan все равно завершаем закрытием stick.
      }
      await closeStickSafely(stick);
    }

    this.lastScanId = scanId;
    this.lastScanDevices = new Map(
      [...candidates.values()].map((candidate) => [candidate.candidateId, Number(candidate.connectFormData.deviceId)]),
    );

    return {
      scanId,
      candidates: [...candidates.values()],
    };
  }

  async connect(request: AntTransportConnectRequest): Promise<void> {
    if (request.scanId && this.lastScanId && request.scanId !== this.lastScanId) {
      throw new Error('Выбранный scanId больше не актуален');
    }

    await this.disconnect();

    const stick = await this.openStick();
    const api = this.ensureApi();
    const sensor = new api.MuscleOxygenSensor(stick);
    const fallbackDeviceId = request.candidateId ? this.lastScanDevices.get(request.candidateId) : undefined;
    if (request.candidateId && fallbackDeviceId === undefined && request.deviceId === undefined) {
      await closeStickSafely(stick);
      throw new Error('Выбранное устройство не найдено в последнем scan');
    }
    const deviceId = request.deviceId ?? fallbackDeviceId ?? 0;

    this.packetQueue = [];
    this.lastQueuedEventCount = null;
    this.rawPacketMetaByEventCount.clear();
    this.connectionSignal = null;

    let utcTimeSent = false;
    const onOxygenData = (...args: unknown[]) => {
      const state = args[0] as RealMuscleOxygenState | undefined;
      if (!state) return;

      if (!utcTimeSent && state.UTCTimeRequired === true && typeof sensor.setUTCTime === 'function') {
        utcTimeSent = true;
        try {
          sensor.setUTCTime();
        } catch {
          // Не роняем поток из-за неудачной синхронизации времени Moxy.
        }
      }

      const packet = realPacketFromState(
        state,
        this.rawPacketMetaByEventCount.get((state._EventCount ?? 0) & 0xff),
        {
          lastSignature: lastIntervalMismatchWarningSignature,
          lastAtMonoMs: lastIntervalMismatchWarningAtMonoMs,
          onWarn(payload) {
            console.warn('[ant-plus-adapter] Moxy profile interval field mismatch, используем raw packet field', payload);
          },
          mark(signature, atMonoMs) {
            lastIntervalMismatchWarningSignature = signature;
            lastIntervalMismatchWarningAtMonoMs = atMonoMs;
          },
        },
      );
      if (!packet) return;
      if (this.lastQueuedEventCount === packet.eventCount) return;
      this.lastQueuedEventCount = packet.eventCount;
      this.packetQueue.push(packet);
    };
    const onDetached = () => {
      this.connectionSignal = 'ANT+ sensor detached';
    };

    sensor.on('oxygenData', onOxygenData);
    sensor.on('detached', onDetached);
    this.oxygenDataListener = onOxygenData;
    this.detachedListener = onDetached;
    try {
      const attachedPromise = waitForEmitterEvent(sensor, 'attached', 1_500, 'ANT+ sensor не открыл канал');
      sensor.attach(0, deviceId);
      await attachedPromise;
      this.installRawReadListener(stick, sensor);
    } catch (error) {
      sensor.removeListener('oxygenData', onOxygenData);
      sensor.removeListener('detached', onDetached);
      this.oxygenDataListener = null;
      this.detachedListener = null;
      this.uninstallRawReadListener();
      await closeStickSafely(stick);
      throw error;
    }

    this.stick = stick;
    this.sensor = sensor;
  }

  async disconnect(): Promise<void> {
    this.uninstallRawReadListener();
    await this.stopSensor();
    await closeStickSafely(this.stick);
    this.stick = null;
    this.packetQueue = [];
    this.lastQueuedEventCount = null;
    this.connectionSignal = null;
  }

  readPacket(): AntTransportPacket | null {
    return this.packetQueue.shift() ?? null;
  }

  takeConnectionSignal(): string | null {
    const nextSignal = this.connectionSignal;
    this.connectionSignal = null;
    return nextSignal;
  }
}

function createTransport(): AntTransport {
  if (config.mode === 'real') {
    return new RealAntTransport();
  }
  return new FakeAntTransport({
    stickPresent: config.stickPresent,
    scanDelayMs: config.scanDelayMs,
    measurementIntervalMs: config.measurementIntervalMs,
    candidateDeviceId: config.candidateDeviceId,
    transmissionType: config.transmissionType,
  });
}

function resetPacketState(): void {
  lastEventCount = null;
  lastMeasurementTimeMs = null;
  lastPacketArrivalMonoMs = null;
  lastPacketSeenSessionMs = null;
  nextFakePacketDueSessionMs = null;
  lastDriftWarningAtSessionMs = null;
  lastIntervalMismatchWarningAtMonoMs = null;
  lastIntervalMismatchWarningSignature = null;
  lastPacketGapWarningAtSessionMs = null;
  lastBroadcastDeltaMs = null;
  broadcastPeriodEstimateMs = null;
  maxBroadcastGapMs = 0;
  broadcastGapCount = 0;
  approxMissingBroadcastsTotal = 0;
  lastEventAdvance = 1;
  lastProfileIntervalFieldMs = null;
}

function resetReconnectState(): void {
  reconnectAttempt = 0;
  reconnectReason = null;
  reconnectNextAttemptSessionMs = null;
}

function startPolling(ctx: PluginContext): void {
  // Для live ANT+ polling нужен только как мост из callback-очереди в runtime.
  // Держим его заметно чаще, чем в fake-режиме, чтобы не накапливать burst'ы в UI.
  const intervalMs = transport?.mode === 'real'
    ? Math.min(config.packetIntervalMs, 50)
    : config.packetIntervalMs;
  ctx.setTimer('ant-plus.poll', intervalMs, () => ({
    type: PacketPollType,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload: {},
  }));
}

function stopPolling(ctx: PluginContext): void {
  ctx.clearTimer('ant-plus.poll');
}

async function setAdapterRuntimeState(
  ctx: PluginContext,
  nextState: AdapterStateChangedPayload['state'],
  requestId?: string,
  message?: string,
): Promise<void> {
  runtimeState = nextState;
  await ctx.emit(adapterStateEvent(config.adapterId, nextState, message, requestId));
}

async function scheduleAutoReconnect(ctx: PluginContext, reason: string): Promise<void> {
  if (!transport || !config.autoReconnect || manualDisconnectRequested || lastConnectRequest === null) {
    return;
  }
  if (runtimeState === 'connecting' && reconnectNextAttemptSessionMs !== null) {
    return;
  }

  try {
    await transport.disconnect();
  } catch {
    // Игнорируем ошибки текущего транспорта: цель здесь дойти до следующей попытки connect.
  }
  resetPacketState();
  reconnectReason = reason;
  reconnectAttempt = 0;
  reconnectNextAttemptSessionMs = ctx.clock.nowSessionMs() + config.reconnectRetryDelayMs;
  await setAdapterRuntimeState(ctx, 'connecting', undefined, `Автопереподключение: ${reason}`);
}

async function tryPendingReconnect(ctx: PluginContext): Promise<void> {
  if (!transport || reconnectNextAttemptSessionMs === null || lastConnectRequest === null || manualDisconnectRequested) {
    return;
  }
  if (ctx.clock.nowSessionMs() < reconnectNextAttemptSessionMs) {
    return;
  }

  reconnectAttempt += 1;
  try {
    await transport.connect(lastConnectRequest);
    connectionStartedSessionMs = ctx.clock.nowSessionMs();
    resetPacketState();
    if (transport.mode === 'fake') {
      nextFakePacketDueSessionMs = ctx.clock.nowSessionMs();
    }
    resetReconnectState();
    await setAdapterRuntimeState(ctx, 'connected', undefined, 'Автопереподключение выполнено');
  } catch (error) {
    reconnectNextAttemptSessionMs = ctx.clock.nowSessionMs() + config.reconnectRetryDelayMs;
    await setAdapterRuntimeState(
      ctx,
      'connecting',
      undefined,
      `Автопереподключение #${reconnectAttempt}: ${normalizeError(error)}`,
    );
  }
}

async function handleScan(ctx: PluginContext, payload: AdapterScanRequestPayload): Promise<void> {
  if (!transport) {
    throw new Error('ANT+ transport не инициализирован');
  }
  if (scanInFlight) {
    return;
  }

  const scanRequest = buildAntTransportScanRequest(payload.formData, payload.timeoutMs);

  scanInFlight = true;
  await ctx.emit(adapterScanStateEvent(config.adapterId, true, payload.requestId));
  try {
    const result = await transport.scan(scanRequest);
    await ctx.emit(adapterScanCandidatesEvent(config.adapterId, result.scanId, result.candidates, payload.requestId));
    await ctx.emit(adapterScanStateEvent(config.adapterId, false, payload.requestId, result.scanId));
  } catch (error) {
    await ctx.emit(adapterScanStateEvent(config.adapterId, false, payload.requestId, undefined, normalizeError(error)));
  } finally {
    scanInFlight = false;
  }
}

async function handleConnect(ctx: PluginContext, payload: AdapterConnectRequestPayload): Promise<void> {
  if (!transport) {
    throw new Error('ANT+ transport не инициализирован');
  }
  if (runtimeState === 'connected' || runtimeState === 'connecting') {
    return;
  }

  const connectRequest = buildAntTransportConnectRequest(payload.formData);

  manualDisconnectRequested = false;
  lastConnectRequest = connectRequest;
  resetReconnectState();
  await setAdapterRuntimeState(ctx, 'connecting', payload.requestId);
  try {
    await transport.connect(connectRequest);
    connectionStartedSessionMs = ctx.clock.nowSessionMs();
    resetPacketState();
    if (transport.mode === 'fake') {
      nextFakePacketDueSessionMs = ctx.clock.nowSessionMs();
    }
    startPolling(ctx);
    await setAdapterRuntimeState(ctx, 'connected', payload.requestId);
  } catch (error) {
    stopPolling(ctx);
    resetPacketState();
    await setAdapterRuntimeState(ctx, 'failed', payload.requestId, normalizeError(error));
  }
}

async function handleDisconnect(ctx: PluginContext, payload: AdapterDisconnectRequestPayload): Promise<void> {
  if (!transport) {
    throw new Error('ANT+ transport не инициализирован');
  }
  if (runtimeState !== 'connected' && runtimeState !== 'failed' && runtimeState !== 'connecting') {
    return;
  }

  manualDisconnectRequested = true;
  lastConnectRequest = null;
  resetReconnectState();
  await setAdapterRuntimeState(ctx, 'disconnecting', payload.requestId);
  stopPolling(ctx);
  await transport.disconnect();
  connectionStartedSessionMs = null;
  resetPacketState();
  await setAdapterRuntimeState(ctx, 'disconnected', payload.requestId);
}

async function emitMoxyPacket(
  ctx: PluginContext,
  packet: AntTransportPacket,
  forcedTimestampMs?: number,
): Promise<void> {
  if (lastEventCount === packet.eventCount) {
    return;
  }

  let sampleTimestampMs: number;
  let emittedDtMs = packet.measurementIntervalMs;
  const eventDiff = lastEventCount === null ? 1 : ((packet.eventCount - lastEventCount) & 0xff) || 256;
  lastEventAdvance = eventDiff;
  lastProfileIntervalFieldMs = packet.rawMeasurementIntervalMs ?? packet.measurementIntervalMs;
  if (forcedTimestampMs !== undefined) {
    sampleTimestampMs = forcedTimestampMs;
  } else if (lastEventCount === null || lastMeasurementTimeMs === null) {
    sampleTimestampMs = ctx.clock.nowSessionMs();
  } else if (packet.arrivalMonoMs !== undefined && lastPacketArrivalMonoMs !== null) {
    const deltaMonoMs = Math.max(1, packet.arrivalMonoMs - lastPacketArrivalMonoMs);
    sampleTimestampMs = lastMeasurementTimeMs + deltaMonoMs;
    emittedDtMs = deltaMonoMs;
    lastBroadcastDeltaMs = deltaMonoMs;
    const expectedBroadcastPeriodMs = updateBroadcastPeriodEstimate(deltaMonoMs);
    if (config.logPacketTiming) {
      console.log('[ant-plus-adapter] Moxy packet', {
        eventCount: packet.eventCount,
        eventAdvance: eventDiff,
        deltaMonoMs,
        expectedBroadcastPeriodMs,
        profileIntervalFieldMs: packet.measurementIntervalMs,
        rawProfileIntervalFieldMs: packet.rawMeasurementIntervalMs,
      });
    }
    // Для MoxyMonitor `eventCount` растёт по внутренним измерениям сенсора, а не по ANT+ broadcast-кадрам.
    // Поэтому прыжок `eventCount > 1` сам по себе не означает потерю пакета.
    // Реальным признаком проблем связи считаем именно паузу между broadcast-кадрами
    // относительно наблюдаемого базового каденса.
    const radioGapThresholdMs = Math.max(expectedBroadcastPeriodMs * 1.7, expectedBroadcastPeriodMs + 120);
    if (deltaMonoMs > radioGapThresholdMs) {
      const nowSessionMs = ctx.clock.nowSessionMs();
      const canWarnAgain = lastPacketGapWarningAtSessionMs === null || (nowSessionMs - lastPacketGapWarningAtSessionMs) >= 5_000;
      const approxMissingBroadcasts = Math.max(1, Math.round(deltaMonoMs / expectedBroadcastPeriodMs) - 1);
      broadcastGapCount += 1;
      approxMissingBroadcastsTotal += approxMissingBroadcasts;
      maxBroadcastGapMs = Math.max(maxBroadcastGapMs, deltaMonoMs);
      if (canWarnAgain) {
        console.warn('[ant-plus-adapter] Пауза ANT+ broadcast для Moxy', {
          approxMissingBroadcasts,
          eventAdvance: eventDiff,
          eventCount: packet.eventCount,
          deltaMonoMs,
          expectedBroadcastPeriodMs,
          profileIntervalFieldMs: packet.measurementIntervalMs,
          rawProfileIntervalFieldMs: packet.rawMeasurementIntervalMs,
          rawHex: packet.rawHex,
        });
        lastPacketGapWarningAtSessionMs = nowSessionMs;
      }
    }
  } else {
    sampleTimestampMs = lastMeasurementTimeMs + Math.max(1, eventDiff) * packet.measurementIntervalMs;
    const nowSessionMs = ctx.clock.nowSessionMs();
    const leadMs = sampleTimestampMs - nowSessionMs;
    const warnThresholdMs = Math.max(packet.measurementIntervalMs * 3, 500);
    // Не подменяем device-time хостовым временем: это ломает даже небольшие расхождения.
    // Вместо этого только логируем случаи, когда профильная временная модель явно убегает вперёд.
    if (leadMs > warnThresholdMs) {
      const canWarnAgain = lastDriftWarningAtSessionMs === null || (nowSessionMs - lastDriftWarningAtSessionMs) >= 5_000;
      if (canWarnAgain) {
        console.warn('[ant-plus-adapter] Время Moxy заметно опережает session time', {
          leadMs,
          measurementIntervalMs: packet.measurementIntervalMs,
          eventCount: packet.eventCount,
          nowSessionMs,
          predictedSampleTimestampMs: sampleTimestampMs,
        });
        lastDriftWarningAtSessionMs = nowSessionMs;
      }
    }
  }

  lastEventCount = packet.eventCount;
  lastPacketSeenSessionMs = ctx.clock.nowSessionMs();
  if (packet.arrivalMonoMs !== undefined) {
    lastPacketArrivalMonoMs = packet.arrivalMonoMs;
  }
  lastMeasurementTimeMs = sampleTimestampMs;
  emitMoxyQualityMetrics(ctx);

  await ctx.emit(signalBatchEvent('moxy.smo2', 'moxy.smo2', packet.smo2, sampleTimestampMs, emittedDtMs, '%'));
  await ctx.emit(signalBatchEvent('moxy.thb', 'moxy.thb', packet.thb, sampleTimestampMs, emittedDtMs, 'g/dL'));
}

async function handlePacketPoll(ctx: PluginContext): Promise<void> {
  if (!transport) return;

  if (runtimeState === 'connecting' && reconnectNextAttemptSessionMs !== null) {
    await tryPendingReconnect(ctx);
    return;
  }
  if (runtimeState !== 'connected') return;

  const connectionSignal = transport.takeConnectionSignal();
  if (connectionSignal) {
    await scheduleAutoReconnect(ctx, connectionSignal);
    return;
  }

  if (transport.mode === 'fake') {
    if (nextFakePacketDueSessionMs === null) return;

    const nowSessionMs = ctx.clock.nowSessionMs();
    let emitted = 0;
    while (nextFakePacketDueSessionMs < nowSessionMs && emitted < 8) {
      const packet = transport.readPacket();
      if (!packet) break;
      await emitMoxyPacket(ctx, packet, nextFakePacketDueSessionMs);
      nextFakePacketDueSessionMs += packet.measurementIntervalMs;
      emitted += 1;
    }
    return;
  }

  let emitted = 0;
  let packet = transport.readPacket();
  while (packet && emitted < 32) {
    await emitMoxyPacket(ctx, packet);
    emitted += 1;
    packet = transport.readPacket();
  }

  if (transport.mode === 'real' && config.autoReconnect && !manualDisconnectRequested) {
    const expectedBroadcastPeriodMs = Math.max(1, broadcastPeriodEstimateMs ?? lastBroadcastDeltaMs ?? 500);
    // Базовая эвристика watchdog: ждём 10n + 5 секунд.
    // Этого хватает, чтобы не реагировать на короткие RF-провалы и не дёргать reconnect раньше времени.
    const silenceTimeoutMs =
      (expectedBroadcastPeriodMs * config.reconnectSilenceMultiplier)
      + config.reconnectMinSilenceMs;
    const baselineSessionMs = lastPacketSeenSessionMs ?? connectionStartedSessionMs;
    if (baselineSessionMs !== null) {
      const silenceMs = ctx.clock.nowSessionMs() - baselineSessionMs;
      if (silenceMs > silenceTimeoutMs) {
        await scheduleAutoReconnect(
          ctx,
          `нет пакетов ${Math.round(silenceMs)}ms (baseline ${Math.round(expectedBroadcastPeriodMs)}ms)`,
        );
      }
    }
  }
}

export default definePlugin({
  manifest: {
    id: 'ant-plus-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.adapterScanRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterConnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: PacketPollType, v: 1, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.adapterScanStateChanged, v: 1 },
      { type: EventTypes.adapterScanCandidates, v: 1 },
      { type: EventTypes.adapterStateChanged, v: 1 },
      { type: EventTypes.signalBatch, v: 1 },
      { type: PacketPollType, v: 1 },
    ],
  },
  async onInit(ctx) {
    config = resolveAntPlusConfig({
      ...(ctx.getConfig<AntPlusAdapterConfig>() ?? {}),
      ...readAntPlusEnvOverrides(process.env),
    });
    transport = createTransport();
    runtimeState = 'disconnected';
    scanInFlight = false;
    manualDisconnectRequested = false;
    lastConnectRequest = null;
    connectionStartedSessionMs = null;
    resetReconnectState();
    resetPacketState();
    await ctx.emit(adapterStateEvent(config.adapterId, 'disconnected'));
    await ctx.emit(adapterScanStateEvent(config.adapterId, false));
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.adapterScanRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await handleScan(ctx, payload);
      return;
    }

    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await handleConnect(ctx, payload);
      return;
    }

    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await handleDisconnect(ctx, payload);
      return;
    }

    if (event.type === PacketPollType) {
      await handlePacketPoll(ctx);
    }
  },
  async onShutdown(ctx) {
    stopPolling(ctx);
    if (transport) {
      await transport.disconnect();
      transport = null;
    }
    runtimeState = 'disconnected';
    scanInFlight = false;
    manualDisconnectRequested = false;
    lastConnectRequest = null;
    connectionStartedSessionMs = null;
    resetReconnectState();
    resetPacketState();
  },
});
