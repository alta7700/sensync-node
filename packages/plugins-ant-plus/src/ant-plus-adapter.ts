import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  EventTypes,
  type AdapterConnectRequestPayload,
  type AdapterDisconnectRequestPayload,
  type AdapterScanCandidate,
  type AdapterScanCandidatesPayload,
  type AdapterScanRequestPayload,
  type AdapterScanStateChangedPayload,
  type AdapterStateChangedPayload,
  type CommandEvent,
  type FactEvent,
  type SignalBatchEvent,
} from '@sensync2/core';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';

interface AntPlusAdapterConfig {
  adapterId?: string;
  mode?: 'fake' | 'real';
  stickPresent?: boolean;
  scanDelayMs?: number;
  packetIntervalMs?: number;
  measurementIntervalMs?: number;
  candidateDeviceId?: number;
  transmissionType?: number;
  autoReconnect?: boolean;
  reconnectRetryDelayMs?: number;
  reconnectSilenceMultiplier?: number;
  reconnectMinSilenceMs?: number;
  logPacketTiming?: boolean;
}

interface AntTransportScanRequest {
  profile?: string;
  timeoutMs?: number;
}

interface AntTransportScanResult {
  scanId: string;
  candidates: AdapterScanCandidate[];
}

interface AntTransportConnectRequest {
  profile?: string;
  scanId?: string;
  candidateId?: string;
  deviceId?: number;
}

interface AntTransportPacket {
  eventCount: number;
  measurementIntervalMs: number;
  smo2: number;
  thb: number;
  rawMeasurementIntervalMs?: number;
  arrivalMonoMs?: number;
  rawHex?: string;
}

interface AntTransport {
  readonly mode: 'fake' | 'real';
  scan(request: AntTransportScanRequest): Promise<AntTransportScanResult>;
  connect(request: AntTransportConnectRequest): Promise<void>;
  disconnect(): Promise<void>;
  readPacket(): AntTransportPacket | null;
  takeConnectionSignal(): string | null;
}

interface FakeAntTransportConfig {
  stickPresent: boolean;
  scanDelayMs: number;
  measurementIntervalMs: number;
  candidateDeviceId: number;
  transmissionType: number;
}

interface AntEventEmitterLike {
  on(eventName: string, listener: (...args: unknown[]) => void): unknown;
  prependListener?(eventName: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(eventName: string, listener: (...args: unknown[]) => void): unknown;
}

interface AntPlusStick extends AntEventEmitterLike {
  open(): boolean;
  close(): void;
}

interface AntPlusScanner extends AntEventEmitterLike {
  scan(): void;
  detach(): void;
}

interface AntPlusSensor extends AntEventEmitterLike {
  channel?: number;
  attach(channel: number, deviceId: number): void;
  detach(): void;
  setUTCTime?(cbk?: (result: boolean) => void): void;
}

interface AntPlusApi {
  GarminStick2: new () => AntPlusStick;
  GarminStick3: new () => AntPlusStick;
  MuscleOxygenScanner: new (stick: AntPlusStick) => AntPlusScanner;
  MuscleOxygenSensor: new (stick: AntPlusStick) => AntPlusSensor;
}

interface RealMuscleOxygenState {
  DeviceID: number;
  _EventCount?: number;
  MeasurementInterval?: 0.25 | 0.5 | 1 | 2;
  TotalHemoglobinConcentration?: number | 'AmbientLightTooHigh' | 'Invalid';
  PreviousSaturatedHemoglobinPercentage?: number | 'AmbientLightTooHigh' | 'Invalid';
  CurrentSaturatedHemoglobinPercentage?: number | 'AmbientLightTooHigh' | 'Invalid';
  UTCTimeRequired?: boolean;
}

interface RawMoxyPacketMeta {
  eventCount: number;
  arrivalMonoMs: number;
  rawMeasurementIntervalMs?: number;
  rawHex: string;
}

const PacketPollType = 'ant-plus.packet.poll';
const require = createRequire(import.meta.url);
const DefaultConfig: Required<AntPlusAdapterConfig> = {
  adapterId: 'ant-plus',
  mode: 'fake',
  stickPresent: true,
  scanDelayMs: 700,
  packetIntervalMs: 250,
  measurementIntervalMs: 250,
  candidateDeviceId: 12345,
  transmissionType: 1,
  autoReconnect: true,
  reconnectRetryDelayMs: 1_500,
  reconnectSilenceMultiplier: 10,
  reconnectMinSilenceMs: 5_000,
  logPacketTiming: false,
};

let config: Required<AntPlusAdapterConfig> = { ...DefaultConfig };
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

function envBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === undefined || rawValue === '') return fallback;
  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function envNumber(rawValue: string | undefined, fallback: number): number {
  if (rawValue === undefined || rawValue === '') return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveConfig(rawConfig: AntPlusAdapterConfig | undefined): Required<AntPlusAdapterConfig> {
  const merged = { ...DefaultConfig, ...(rawConfig ?? {}) };
  return {
    adapterId: merged.adapterId,
    mode: merged.mode,
    stickPresent: merged.stickPresent,
    scanDelayMs: Math.max(0, Math.trunc(merged.scanDelayMs)),
    packetIntervalMs: Math.max(1, Math.trunc(merged.packetIntervalMs)),
    measurementIntervalMs: Math.max(1, Math.trunc(merged.measurementIntervalMs)),
    candidateDeviceId: Math.max(1, Math.trunc(merged.candidateDeviceId)),
    transmissionType: Math.max(0, Math.trunc(merged.transmissionType)),
    autoReconnect: merged.autoReconnect,
    reconnectRetryDelayMs: Math.max(100, Math.trunc(merged.reconnectRetryDelayMs)),
    reconnectSilenceMultiplier: Math.max(2, merged.reconnectSilenceMultiplier),
    reconnectMinSilenceMs: Math.max(1_000, Math.trunc(merged.reconnectMinSilenceMs)),
    logPacketTiming: merged.logPacketTiming,
  };
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

function loadAntPlusApi(): AntPlusApi {
  try {
    return require('ant-plus') as AntPlusApi;
  } catch (error) {
    throw new Error(
      'Режим real требует установленный пакет `ant-plus`. '
      + 'Запусти `npm install` в корне репозитория и проверь установку нативной зависимости usb.',
    );
  }
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

function decodeLegacyMeasurementIntervalMs(data: Buffer): number | undefined {
  if (data.length < 8) return undefined;
  const intervalRaw = data.readUInt16LE(2);
  if (intervalRaw <= 0) return undefined;
  const decodedMs = Math.round((intervalRaw / 1024) * 1000);
  if (!Number.isFinite(decodedMs) || decodedMs <= 0) return undefined;
  return decodedMs;
}

function chooseMeasurementIntervalMs(
  libraryMeasurementIntervalMs: number,
  rawMeasurementIntervalMs: number | undefined,
): number {
  if (rawMeasurementIntervalMs === undefined) {
    return libraryMeasurementIntervalMs;
  }

  // Для MoxyMonitor библиотека `ant-plus` в реальности может отдавать интервал,
  // который расходится с сырым page 0x01. Предпочитаем значение из устройства.
  const deltaMs = Math.abs(rawMeasurementIntervalMs - libraryMeasurementIntervalMs);
  const mismatchThresholdMs = Math.max(250, libraryMeasurementIntervalMs * 0.4);
  if (deltaMs >= mismatchThresholdMs) {
    const signature = `${libraryMeasurementIntervalMs}:${rawMeasurementIntervalMs}`;
    const nowMonoMs = performance.now();
    const canWarnAgain = lastIntervalMismatchWarningSignature !== signature
      || lastIntervalMismatchWarningAtMonoMs === null
      || (nowMonoMs - lastIntervalMismatchWarningAtMonoMs) >= 5_000;
    if (canWarnAgain) {
      console.warn('[ant-plus-adapter] Moxy profile interval field mismatch, используем raw packet field', {
        profileIntervalFieldMs: libraryMeasurementIntervalMs,
        rawProfileIntervalFieldMs: rawMeasurementIntervalMs,
      });
      lastIntervalMismatchWarningSignature = signature;
      lastIntervalMismatchWarningAtMonoMs = nowMonoMs;
    }
    return rawMeasurementIntervalMs;
  }

  return rawMeasurementIntervalMs;
}

function realPacketFromState(state: RealMuscleOxygenState, meta?: RawMoxyPacketMeta): AntTransportPacket | null {
  const eventCount = state._EventCount;
  const current = state.CurrentSaturatedHemoglobinPercentage;
  const total = state.TotalHemoglobinConcentration;

  if (typeof eventCount !== 'number') return null;
  if (typeof current !== 'number') return null;
  if (typeof total !== 'number') return null;

  const measurementIntervalMs = Math.max(1, Math.round((state.MeasurementInterval ?? 0.25) * 1000));
  return {
    eventCount: eventCount & 0xff,
    measurementIntervalMs: chooseMeasurementIntervalMs(measurementIntervalMs, meta?.rawMeasurementIntervalMs),
    smo2: Math.round(current) / 10,
    thb: Math.round(total) / 100,
    ...(meta?.rawMeasurementIntervalMs !== undefined ? { rawMeasurementIntervalMs: meta.rawMeasurementIntervalMs } : {}),
    arrivalMonoMs: meta?.arrivalMonoMs ?? performance.now(),
    ...(meta?.rawHex !== undefined ? { rawHex: meta.rawHex } : {}),
  };
}

function adapterStateEvent(
  adapterId: string,
  state: AdapterStateChangedPayload['state'],
  message?: string,
  requestId?: string,
): Omit<FactEvent<AdapterStateChangedPayload>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: AdapterStateChangedPayload = { adapterId, state };
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return {
    type: EventTypes.adapterStateChanged,
    kind: 'fact',
    priority: 'system',
    payload,
  };
}

function adapterScanStateEvent(
  adapterId: string,
  scanning: boolean,
  requestId?: string,
  scanId?: string,
  message?: string,
): Omit<FactEvent<AdapterScanStateChangedPayload>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: AdapterScanStateChangedPayload = { adapterId, scanning };
  if (requestId !== undefined) payload.requestId = requestId;
  if (scanId !== undefined) payload.scanId = scanId;
  if (message !== undefined) payload.message = message;
  return {
    type: EventTypes.adapterScanStateChanged,
    kind: 'fact',
    priority: 'system',
    payload,
  };
}

function adapterScanCandidatesEvent(
  adapterId: string,
  scanId: string,
  candidates: AdapterScanCandidate[],
  requestId?: string,
): Omit<FactEvent<AdapterScanCandidatesPayload>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: AdapterScanCandidatesPayload = {
    adapterId,
    scanId,
    candidates,
  };
  if (requestId !== undefined) payload.requestId = requestId;
  return {
    type: EventTypes.adapterScanCandidates,
    kind: 'fact',
    priority: 'system',
    payload,
  };
}

function signalBatchEvent(
  streamId: string,
  channelId: string,
  value: number,
  t0Ms: number,
  dtMs: number,
  units: string,
): Omit<SignalBatchEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  return {
    type: 'signal.batch',
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
  };
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
      if (typeof sensor.channel !== 'number') return;
      if (data.length < 12) return;

      const messageType = data.readUInt8(2);
      if (messageType !== 0x4e && messageType !== 0x4f && messageType !== 0x50) return;
      if (data.readUInt8(3) !== sensor.channel) return;

      const payload = data.subarray(4, 12);
      if (payload.readUInt8(0) !== 0x01) return;

      const eventCount = payload.readUInt8(1);
      const rawMeasurementIntervalMs = decodeLegacyMeasurementIntervalMs(payload);
      this.rawPacketMetaByEventCount.set(eventCount, {
        eventCount,
        arrivalMonoMs: performance.now(),
        rawHex: payload.toString('hex'),
        ...(rawMeasurementIntervalMs !== undefined ? { rawMeasurementIntervalMs } : {}),
      });
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

      const packet = realPacketFromState(state, this.rawPacketMetaByEventCount.get((state._EventCount ?? 0) & 0xff));
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

function selectedProfile(formData: Record<string, unknown> | undefined): string | undefined {
  const rawValue = formData?.profile;
  return typeof rawValue === 'string' && rawValue.length > 0 ? rawValue : undefined;
}

function selectedCandidateId(formData: Record<string, unknown> | undefined): string | undefined {
  const rawValue = formData?.candidateId;
  return typeof rawValue === 'string' && rawValue.length > 0 ? rawValue : undefined;
}

function selectedScanId(formData: Record<string, unknown> | undefined): string | undefined {
  const rawValue = formData?.scanId;
  return typeof rawValue === 'string' && rawValue.length > 0 ? rawValue : undefined;
}

function selectedDeviceId(formData: Record<string, unknown> | undefined): number | undefined {
  const rawValue = formData?.deviceId;
  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 0) {
    return Math.trunc(rawValue);
  }
  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

async function handleScan(ctx: PluginContext, payload: AdapterScanRequestPayload): Promise<void> {
  if (!transport) {
    throw new Error('ANT+ transport не инициализирован');
  }
  if (scanInFlight) {
    return;
  }

  const profile = selectedProfile(payload.formData);
  const scanRequest: AntTransportScanRequest = {};
  if (profile !== undefined) scanRequest.profile = profile;
  if (payload.timeoutMs !== undefined) scanRequest.timeoutMs = payload.timeoutMs;

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

  const profile = selectedProfile(payload.formData);
  const scanId = selectedScanId(payload.formData);
  const candidateId = selectedCandidateId(payload.formData);
  const deviceId = selectedDeviceId(payload.formData);
  const connectRequest: AntTransportConnectRequest = {};
  if (profile !== undefined) connectRequest.profile = profile;
  if (scanId !== undefined) connectRequest.scanId = scanId;
  if (candidateId !== undefined) connectRequest.candidateId = candidateId;
  if (deviceId !== undefined) connectRequest.deviceId = deviceId;

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
      { type: EventTypes.adapterScanRequest, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterConnectRequest, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, kind: 'command', priority: 'control' },
      { type: PacketPollType, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
    emits: [
      EventTypes.adapterScanStateChanged,
      EventTypes.adapterScanCandidates,
      EventTypes.adapterStateChanged,
      'signal.batch',
    ],
  },
  async onInit(ctx) {
    const envMode = process.env.SENSYNC2_ANT_PLUS_MODE;
    config = resolveConfig({
      ...(ctx.getConfig<AntPlusAdapterConfig>() ?? {}),
      ...((envMode === 'fake' || envMode === 'real')
        ? { mode: envMode }
        : {}),
      ...(process.env.SENSYNC2_ANT_PLUS_STICK_PRESENT !== undefined
        ? { stickPresent: envBoolean(process.env.SENSYNC2_ANT_PLUS_STICK_PRESENT, DefaultConfig.stickPresent) }
        : {}),
      ...(process.env.SENSYNC2_ANT_PLUS_SCAN_DELAY_MS !== undefined
        ? { scanDelayMs: envNumber(process.env.SENSYNC2_ANT_PLUS_SCAN_DELAY_MS, DefaultConfig.scanDelayMs) }
        : {}),
      ...(process.env.SENSYNC2_ANT_PLUS_PACKET_INTERVAL_MS !== undefined
        ? { packetIntervalMs: envNumber(process.env.SENSYNC2_ANT_PLUS_PACKET_INTERVAL_MS, DefaultConfig.packetIntervalMs) }
        : {}),
      ...(process.env.SENSYNC2_ANT_PLUS_MEASUREMENT_INTERVAL_MS !== undefined
        ? { measurementIntervalMs: envNumber(process.env.SENSYNC2_ANT_PLUS_MEASUREMENT_INTERVAL_MS, DefaultConfig.measurementIntervalMs) }
        : {}),
      ...(process.env.SENSYNC2_ANT_PLUS_AUTO_RECONNECT !== undefined
        ? { autoReconnect: envBoolean(process.env.SENSYNC2_ANT_PLUS_AUTO_RECONNECT, DefaultConfig.autoReconnect) }
        : {}),
      ...(process.env.SENSYNC2_ANT_PLUS_RECONNECT_RETRY_DELAY_MS !== undefined
        ? { reconnectRetryDelayMs: envNumber(process.env.SENSYNC2_ANT_PLUS_RECONNECT_RETRY_DELAY_MS, DefaultConfig.reconnectRetryDelayMs) }
        : {}),
      ...(process.env.SENSYNC2_ANT_PLUS_RECONNECT_SILENCE_MULTIPLIER !== undefined
        ? { reconnectSilenceMultiplier: envNumber(process.env.SENSYNC2_ANT_PLUS_RECONNECT_SILENCE_MULTIPLIER, DefaultConfig.reconnectSilenceMultiplier) }
        : {}),
      ...(process.env.SENSYNC2_ANT_PLUS_RECONNECT_MIN_SILENCE_MS !== undefined
        ? { reconnectMinSilenceMs: envNumber(process.env.SENSYNC2_ANT_PLUS_RECONNECT_MIN_SILENCE_MS, DefaultConfig.reconnectMinSilenceMs) }
        : {}),
      ...(process.env.SENSYNC2_ANT_PLUS_LOG_PACKET_TIMING !== undefined
        ? { logPacketTiming: envBoolean(process.env.SENSYNC2_ANT_PLUS_LOG_PACKET_TIMING, DefaultConfig.logPacketTiming) }
        : {}),
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
      const payload = (event as CommandEvent<AdapterScanRequestPayload>).payload;
      if (payload.adapterId !== config.adapterId) return;
      await handleScan(ctx, payload);
      return;
    }

    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = (event as CommandEvent<AdapterConnectRequestPayload>).payload;
      if (payload.adapterId !== config.adapterId) return;
      await handleConnect(ctx, payload);
      return;
    }

    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = (event as CommandEvent<AdapterDisconnectRequestPayload>).payload;
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
