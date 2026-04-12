import { createRequire } from 'node:module';

export interface AntPlusAdapterConfig {
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

export interface AntTransportScanRequest {
  profile?: string;
  deviceType?: number;
  timeoutMs?: number;
}

export interface AntTransportConnectRequest {
  profile?: string;
  scanId?: string;
  candidateId?: string;
  deviceId?: number;
  deviceType?: number;
}

export interface AntTransportPacket {
  eventCount: number;
  measurementIntervalMs: number;
  smo2: number;
  thb: number;
  rawMeasurementIntervalMs?: number;
  arrivalMonoMs?: number;
  rawHex?: string;
}

export interface FakeAntTransportConfig {
  stickPresent: boolean;
  scanDelayMs: number;
  measurementIntervalMs: number;
  candidateDeviceId: number;
  transmissionType: number;
}

export interface AntEventEmitterLike {
  on(eventName: string, listener: (...args: unknown[]) => void): unknown;
  prependListener?(eventName: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(eventName: string, listener: (...args: unknown[]) => void): unknown;
}

export interface AntPlusStick extends AntEventEmitterLike {
  open(): boolean;
  close(): void;
}

export interface AntPlusScanner extends AntEventEmitterLike {
  scan(): void;
  detach(): void;
}

export interface AntPlusSensor extends AntEventEmitterLike {
  channel?: number;
  attach(channel: number, deviceId: number): void;
  detach(): void;
  setUTCTime?(cbk?: (result: boolean) => void): void;
}

export interface AntPlusApi {
  GarminStick2: new () => AntPlusStick;
  GarminStick3: new () => AntPlusStick;
  MuscleOxygenScanner: new (stick: AntPlusStick) => AntPlusScanner;
  MuscleOxygenSensor: new (stick: AntPlusStick) => AntPlusSensor;
}

export interface RealMuscleOxygenState {
  DeviceID: number;
  _EventCount?: number;
  MeasurementInterval?: 0.25 | 0.5 | 1 | 2;
  TotalHemoglobinConcentration?: number | 'AmbientLightTooHigh' | 'Invalid';
  PreviousSaturatedHemoglobinPercentage?: number | 'AmbientLightTooHigh' | 'Invalid';
  CurrentSaturatedHemoglobinPercentage?: number | 'AmbientLightTooHigh' | 'Invalid';
  UTCTimeRequired?: boolean;
}

export interface RawMoxyPacketMeta {
  eventCount: number;
  arrivalMonoMs: number;
  rawMeasurementIntervalMs?: number;
  rawHex: string;
}

const require = createRequire(import.meta.url);

export const DefaultAntPlusConfig: Required<AntPlusAdapterConfig> = {
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

export function envBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === undefined || rawValue === '') return fallback;
  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function envNumber(rawValue: string | undefined, fallback: number): number {
  if (rawValue === undefined || rawValue === '') return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveAntPlusConfig(rawConfig: AntPlusAdapterConfig | undefined): Required<AntPlusAdapterConfig> {
  const merged = { ...DefaultAntPlusConfig, ...(rawConfig ?? {}) };
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

export function readAntPlusEnvOverrides(env: NodeJS.ProcessEnv): Partial<AntPlusAdapterConfig> {
  const envMode = env.SENSYNC2_ANT_PLUS_MODE;

  return {
    ...((envMode === 'fake' || envMode === 'real')
      ? { mode: envMode }
      : {}),
    ...(env.SENSYNC2_ANT_PLUS_STICK_PRESENT !== undefined
      ? { stickPresent: envBoolean(env.SENSYNC2_ANT_PLUS_STICK_PRESENT, DefaultAntPlusConfig.stickPresent) }
      : {}),
    ...(env.SENSYNC2_ANT_PLUS_SCAN_DELAY_MS !== undefined
      ? { scanDelayMs: envNumber(env.SENSYNC2_ANT_PLUS_SCAN_DELAY_MS, DefaultAntPlusConfig.scanDelayMs) }
      : {}),
    ...(env.SENSYNC2_ANT_PLUS_PACKET_INTERVAL_MS !== undefined
      ? { packetIntervalMs: envNumber(env.SENSYNC2_ANT_PLUS_PACKET_INTERVAL_MS, DefaultAntPlusConfig.packetIntervalMs) }
      : {}),
    ...(env.SENSYNC2_ANT_PLUS_MEASUREMENT_INTERVAL_MS !== undefined
      ? { measurementIntervalMs: envNumber(env.SENSYNC2_ANT_PLUS_MEASUREMENT_INTERVAL_MS, DefaultAntPlusConfig.measurementIntervalMs) }
      : {}),
    ...(env.SENSYNC2_ANT_PLUS_AUTO_RECONNECT !== undefined
      ? { autoReconnect: envBoolean(env.SENSYNC2_ANT_PLUS_AUTO_RECONNECT, DefaultAntPlusConfig.autoReconnect) }
      : {}),
    ...(env.SENSYNC2_ANT_PLUS_RECONNECT_RETRY_DELAY_MS !== undefined
      ? { reconnectRetryDelayMs: envNumber(env.SENSYNC2_ANT_PLUS_RECONNECT_RETRY_DELAY_MS, DefaultAntPlusConfig.reconnectRetryDelayMs) }
      : {}),
    ...(env.SENSYNC2_ANT_PLUS_RECONNECT_SILENCE_MULTIPLIER !== undefined
      ? { reconnectSilenceMultiplier: envNumber(env.SENSYNC2_ANT_PLUS_RECONNECT_SILENCE_MULTIPLIER, DefaultAntPlusConfig.reconnectSilenceMultiplier) }
      : {}),
    ...(env.SENSYNC2_ANT_PLUS_RECONNECT_MIN_SILENCE_MS !== undefined
      ? { reconnectMinSilenceMs: envNumber(env.SENSYNC2_ANT_PLUS_RECONNECT_MIN_SILENCE_MS, DefaultAntPlusConfig.reconnectMinSilenceMs) }
      : {}),
    ...(env.SENSYNC2_ANT_PLUS_LOG_PACKET_TIMING !== undefined
      ? { logPacketTiming: envBoolean(env.SENSYNC2_ANT_PLUS_LOG_PACKET_TIMING, DefaultAntPlusConfig.logPacketTiming) }
      : {}),
  };
}

export function loadAntPlusApi(): AntPlusApi {
  try {
    return require('ant-plus') as AntPlusApi;
  } catch {
    throw new Error(
      'Режим real требует установленный пакет `ant-plus`. '
      + 'Запусти `npm install` в корне репозитория и проверь установку нативной зависимости usb.',
    );
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
  mismatchTracker?: {
    lastSignature: string | null;
    lastAtMonoMs: number | null;
    onWarn?: (payload: { profileIntervalFieldMs: number; rawProfileIntervalFieldMs: number }) => void;
    mark(signature: string, atMonoMs: number): void;
  },
): number {
  if (rawMeasurementIntervalMs === undefined) {
    return libraryMeasurementIntervalMs;
  }

  const deltaMs = Math.abs(rawMeasurementIntervalMs - libraryMeasurementIntervalMs);
  const mismatchThresholdMs = Math.max(250, libraryMeasurementIntervalMs * 0.4);
  if (deltaMs >= mismatchThresholdMs) {
    const signature = `${libraryMeasurementIntervalMs}:${rawMeasurementIntervalMs}`;
    const nowMonoMs = performance.now();
    const canWarnAgain = mismatchTracker
      ? mismatchTracker.lastSignature !== signature
        || mismatchTracker.lastAtMonoMs === null
        || (nowMonoMs - mismatchTracker.lastAtMonoMs) >= 5_000
      : false;
    if (canWarnAgain) {
      mismatchTracker?.onWarn?.({
        profileIntervalFieldMs: libraryMeasurementIntervalMs,
        rawProfileIntervalFieldMs: rawMeasurementIntervalMs,
      });
      mismatchTracker?.mark(signature, nowMonoMs);
    }
    return rawMeasurementIntervalMs;
  }

  return rawMeasurementIntervalMs;
}

export function realPacketFromState(
  state: RealMuscleOxygenState,
  meta?: RawMoxyPacketMeta,
  mismatchTracker?: {
    lastSignature: string | null;
    lastAtMonoMs: number | null;
    onWarn?: (payload: { profileIntervalFieldMs: number; rawProfileIntervalFieldMs: number }) => void;
    mark(signature: string, atMonoMs: number): void;
  },
): AntTransportPacket | null {
  const eventCount = state._EventCount;
  const current = state.CurrentSaturatedHemoglobinPercentage;
  const total = state.TotalHemoglobinConcentration;

  if (typeof eventCount !== 'number') return null;
  if (typeof current !== 'number') return null;
  if (typeof total !== 'number') return null;

  const measurementIntervalMs = Math.max(1, Math.round((state.MeasurementInterval ?? 0.25) * 1000));
  return {
    eventCount: eventCount & 0xff,
    measurementIntervalMs: chooseMeasurementIntervalMs(measurementIntervalMs, meta?.rawMeasurementIntervalMs, mismatchTracker),
    smo2: Math.round(current) / 10,
    thb: Math.round(total) / 100,
    ...(meta?.rawMeasurementIntervalMs !== undefined ? { rawMeasurementIntervalMs: meta.rawMeasurementIntervalMs } : {}),
    arrivalMonoMs: meta?.arrivalMonoMs ?? performance.now(),
    ...(meta?.rawHex !== undefined ? { rawHex: meta.rawHex } : {}),
  };
}

export function decodeRawMoxyPacketMeta(
  data: Buffer,
  sensorChannel: number | undefined,
): RawMoxyPacketMeta | null {
  if (typeof sensorChannel !== 'number') return null;
  if (data.length < 12) return null;

  const messageType = data.readUInt8(2);
  if (messageType !== 0x4e && messageType !== 0x4f && messageType !== 0x50) return null;
  if (data.readUInt8(3) !== sensorChannel) return null;

  const payload = data.subarray(4, 12);
  if (payload.readUInt8(0) !== 0x01) return null;

  const eventCount = payload.readUInt8(1);
  const rawMeasurementIntervalMs = decodeLegacyMeasurementIntervalMs(payload);
  return {
    eventCount,
    arrivalMonoMs: performance.now(),
    rawHex: payload.toString('hex'),
    ...(rawMeasurementIntervalMs !== undefined ? { rawMeasurementIntervalMs } : {}),
  };
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

function selectedDeviceType(formData: Record<string, unknown> | undefined): number | undefined {
  const rawValue = formData?.deviceType;
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

export function buildAntTransportScanRequest(
  formData: Record<string, unknown> | undefined,
  timeoutMs?: number,
): AntTransportScanRequest {
  const request: AntTransportScanRequest = {};
  const profile = selectedProfile(formData);
  const deviceType = selectedDeviceType(formData);
  if (profile !== undefined) request.profile = profile;
  if (deviceType !== undefined) request.deviceType = deviceType;
  if (timeoutMs !== undefined) request.timeoutMs = timeoutMs;
  return request;
}

export function buildAntTransportConnectRequest(
  formData: Record<string, unknown> | undefined,
): AntTransportConnectRequest {
  const request: AntTransportConnectRequest = {};
  const profile = selectedProfile(formData);
  const scanId = selectedScanId(formData);
  const candidateId = selectedCandidateId(formData);
  const deviceId = selectedDeviceId(formData);
  const deviceType = selectedDeviceType(formData);

  if (profile !== undefined) request.profile = profile;
  if (scanId !== undefined) request.scanId = scanId;
  if (candidateId !== undefined) request.candidateId = candidateId;
  if (deviceId !== undefined) request.deviceId = deviceId;
  if (deviceType !== undefined) request.deviceType = deviceType;
  return request;
}
