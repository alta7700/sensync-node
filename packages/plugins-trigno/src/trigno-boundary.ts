import {
  defineUiCommandBoundaryGuard,
  type UiCommandBoundaryGuard,
} from '@sensync2/core';

export const TrignoEventTypes = {
  streamStartRequest: 'trigno.stream.start.request',
  streamStopRequest: 'trigno.stream.stop.request',
  statusRefreshRequest: 'trigno.status.refresh.request',
  statusReported: 'trigno.status.reported',
  poll: 'trigno.poll',
} as const;

export interface TrignoAdapterConfig {
  adapterId?: string;
  mode?: 'real';
  backwardsCompatibility?: boolean;
  upsampling?: boolean;
  commandPort?: number;
  emgPort?: number;
  auxPort?: number;
  dataSocketReadyDelayMs?: number;
  connectCooldownMs?: number;
  autoReconnect?: boolean;
  reconnectRetryDelayMs?: number;
  pollIntervalMs?: number;
  dataSilenceTimeoutMs?: number;
  commandTimeoutMs?: number;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
}

export interface TrignoConnectRequest {
  host: string;
  sensorSlot: number;
}

export interface TrignoCommandRequestPayload {
  adapterId: string;
  requestId?: string;
}

export interface TrignoChannelSnapshot {
  rateHz: number;
  samplesPerFrame: number;
  units: string;
  gain: number;
}

export interface TrignoStatusSnapshot {
  host: string;
  sensorSlot: number;
  banner: string;
  protocolVersion: string | null;
  paired: boolean;
  mode: number;
  startIndex: number;
  channelCount: number;
  emgChannelCount: number;
  auxChannelCount: number;
  backwardsCompatibility: boolean;
  upsampling: boolean;
  frameInterval: number;
  maxSamplesEmg: number;
  maxSamplesAux: number;
  serial: string | null;
  firmware: string | null;
  emg: TrignoChannelSnapshot;
  gyro: TrignoChannelSnapshot;
}

export interface TrignoStatusReportedPayload {
  adapterId: string;
  status: TrignoStatusSnapshot;
  requestId?: string;
}

export interface TrignoStreamStartRequestInput {
  type: typeof TrignoEventTypes.streamStartRequest;
  v: 1;
  kind: 'command';
  priority: 'control';
  payload: TrignoCommandRequestPayload;
}

export interface TrignoStreamStopRequestInput {
  type: typeof TrignoEventTypes.streamStopRequest;
  v: 1;
  kind: 'command';
  priority: 'control';
  payload: TrignoCommandRequestPayload;
}

export interface TrignoStatusRefreshRequestInput {
  type: typeof TrignoEventTypes.statusRefreshRequest;
  v: 1;
  kind: 'command';
  priority: 'control';
  payload: TrignoCommandRequestPayload;
}

export interface TrignoExpectedStartSnapshot {
  mode: number;
  channelCount: number;
  emgChannelCount: number;
  auxChannelCount: number;
  backwardsCompatibility: boolean;
  upsampling: boolean;
  frameInterval: number;
  maxSamplesEmg: number;
  maxSamplesAux: number;
  emgRateHz: number;
  emgSamplesPerFrame: number;
  emgUnits: string;
  emgGain: number;
  gyroRateHz: number;
  gyroSamplesPerFrame: number;
  gyroUnits: string;
  gyroGain: number;
}

export interface TrignoSnapshotMismatch {
  field: string;
  expected: string | number | boolean;
  actual: string | number | boolean;
}

export const DefaultTrignoAdapterConfig: Required<TrignoAdapterConfig> = {
  adapterId: 'trigno',
  mode: 'real',
  backwardsCompatibility: false,
  upsampling: false,
  commandPort: 50040,
  emgPort: 50043,
  auxPort: 50044,
  dataSocketReadyDelayMs: 350,
  connectCooldownMs: 3_500,
  autoReconnect: true,
  reconnectRetryDelayMs: 1_500,
  pollIntervalMs: 250,
  dataSilenceTimeoutMs: 5_000,
  commandTimeoutMs: 2_500,
  startTimeoutMs: 5_000,
  stopTimeoutMs: 5_000,
};

export function buildTrignoExpectedStartSnapshot(
  config: Pick<TrignoAdapterConfig, 'backwardsCompatibility' | 'upsampling'> = DefaultTrignoAdapterConfig,
): TrignoExpectedStartSnapshot {
  return {
    mode: 7,
    channelCount: 4,
    emgChannelCount: 1,
    auxChannelCount: 3,
    backwardsCompatibility: config.backwardsCompatibility ?? DefaultTrignoAdapterConfig.backwardsCompatibility,
    upsampling: config.upsampling ?? DefaultTrignoAdapterConfig.upsampling,
    frameInterval: 0.0135,
    maxSamplesEmg: 26,
    maxSamplesAux: 2,
    emgRateHz: 1925.92592592593,
    emgSamplesPerFrame: 26,
    emgUnits: 'V',
    emgGain: 300,
    gyroRateHz: 148.148148148148,
    gyroSamplesPerFrame: 2,
    gyroUnits: 'deg/s',
    gyroGain: 16.4,
  };
}

export const DefaultTrignoExpectedStartSnapshot: TrignoExpectedStartSnapshot = buildTrignoExpectedStartSnapshot();

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isOptionalString(input: unknown): input is string | undefined {
  return input === undefined || typeof input === 'string';
}

function stringField(formData: Record<string, unknown> | undefined, key: string): string | undefined {
  const rawValue = formData?.[key];
  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    return rawValue.trim();
  }
  return undefined;
}

function numberField(formData: Record<string, unknown> | undefined, key: string): number | undefined {
  const rawValue = formData?.[key];
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue;
  }
  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function isTrignoCommandRequestPayload(input: unknown): input is TrignoCommandRequestPayload {
  if (!isRecord(input)) return false;
  return typeof input.adapterId === 'string' && isOptionalString(input.requestId);
}

export function resolveTrignoAdapterConfig(rawConfig: TrignoAdapterConfig | undefined): Required<TrignoAdapterConfig> {
  const merged = { ...DefaultTrignoAdapterConfig, ...(rawConfig ?? {}) };
  return {
    adapterId: merged.adapterId,
    mode: 'real',
    backwardsCompatibility: merged.backwardsCompatibility,
    upsampling: merged.upsampling,
    commandPort: Math.max(1, Math.trunc(merged.commandPort)),
    emgPort: Math.max(1, Math.trunc(merged.emgPort)),
    auxPort: Math.max(1, Math.trunc(merged.auxPort)),
    dataSocketReadyDelayMs: Math.max(0, Math.trunc(merged.dataSocketReadyDelayMs)),
    connectCooldownMs: Math.max(0, Math.trunc(merged.connectCooldownMs)),
    autoReconnect: merged.autoReconnect,
    reconnectRetryDelayMs: Math.max(250, Math.trunc(merged.reconnectRetryDelayMs)),
    pollIntervalMs: Math.max(100, Math.trunc(merged.pollIntervalMs)),
    dataSilenceTimeoutMs: Math.max(1_000, Math.trunc(merged.dataSilenceTimeoutMs)),
    commandTimeoutMs: Math.max(250, Math.trunc(merged.commandTimeoutMs)),
    startTimeoutMs: Math.max(500, Math.trunc(merged.startTimeoutMs)),
    stopTimeoutMs: Math.max(1_000, Math.trunc(merged.stopTimeoutMs)),
  };
}

export function buildTrignoConnectRequest(formData: Record<string, unknown> | undefined): TrignoConnectRequest {
  const host = stringField(formData, 'host');
  if (!host) {
    throw new Error('Для подключения Trigno нужен host');
  }

  const sensorSlotRaw = numberField(formData, 'sensorSlot');
  const sensorSlot = sensorSlotRaw === undefined ? 1 : Math.trunc(sensorSlotRaw);
  if (!Number.isFinite(sensorSlot) || sensorSlot < 1 || sensorSlot > 16) {
    throw new Error('sensorSlot должен быть в диапазоне 1..16');
  }

  return { host, sensorSlot };
}

export function normalizeTrignoUnits(units: string): string {
  const trimmed = units.trim();
  if (trimmed === '?/s') return 'deg/s';
  return trimmed;
}

function equalsNumber(left: number, right: number, epsilon = 1e-6): boolean {
  return Math.abs(left - right) <= epsilon;
}

export function diffTrignoExpectedStartSnapshot(
  snapshot: TrignoStatusSnapshot,
  expected: TrignoExpectedStartSnapshot = DefaultTrignoExpectedStartSnapshot,
): TrignoSnapshotMismatch[] {
  const mismatches: TrignoSnapshotMismatch[] = [];

  const pushNumber = (field: string, actual: number, target: number, epsilon = 1e-6) => {
    if (!equalsNumber(actual, target, epsilon)) {
      mismatches.push({ field, expected: target, actual });
    }
  };

  const pushExact = (field: string, actual: string | number | boolean, target: string | number | boolean) => {
    if (actual !== target) {
      mismatches.push({ field, expected: target, actual });
    }
  };

  pushExact('paired', snapshot.paired, true);
  pushExact('mode', snapshot.mode, expected.mode);
  pushExact('channelCount', snapshot.channelCount, expected.channelCount);
  pushExact('emgChannelCount', snapshot.emgChannelCount, expected.emgChannelCount);
  pushExact('auxChannelCount', snapshot.auxChannelCount, expected.auxChannelCount);
  pushExact('backwardsCompatibility', snapshot.backwardsCompatibility, expected.backwardsCompatibility);
  pushExact('upsampling', snapshot.upsampling, expected.upsampling);
  pushNumber('frameInterval', snapshot.frameInterval, expected.frameInterval, 1e-9);
  pushExact('maxSamplesEmg', snapshot.maxSamplesEmg, expected.maxSamplesEmg);
  pushExact('maxSamplesAux', snapshot.maxSamplesAux, expected.maxSamplesAux);
  pushNumber('emg.rateHz', snapshot.emg.rateHz, expected.emgRateHz);
  pushExact('emg.samplesPerFrame', snapshot.emg.samplesPerFrame, expected.emgSamplesPerFrame);
  pushExact('emg.units', snapshot.emg.units, expected.emgUnits);
  pushNumber('emg.gain', snapshot.emg.gain, expected.emgGain);
  pushNumber('gyro.rateHz', snapshot.gyro.rateHz, expected.gyroRateHz);
  pushExact('gyro.samplesPerFrame', snapshot.gyro.samplesPerFrame, expected.gyroSamplesPerFrame);
  pushExact('gyro.units', snapshot.gyro.units, expected.gyroUnits);
  pushNumber('gyro.gain', snapshot.gyro.gain, expected.gyroGain);

  return mismatches;
}

export function formatTrignoSnapshotMismatchMessage(mismatches: readonly TrignoSnapshotMismatch[]): string {
  if (mismatches.length === 0) {
    return 'Ожидаемый live snapshot совпадает';
  }
  return mismatches
    .map((item) => `${item.field}: ожидалось ${String(item.expected)}, получено ${String(item.actual)}`)
    .join('; ');
}

export const trignoUiCommandBoundaryGuards = [
  defineUiCommandBoundaryGuard({
    type: TrignoEventTypes.streamStartRequest,
    v: 1,
    isPayload: isTrignoCommandRequestPayload,
  } as UiCommandBoundaryGuard),
  defineUiCommandBoundaryGuard({
    type: TrignoEventTypes.streamStopRequest,
    v: 1,
    isPayload: isTrignoCommandRequestPayload,
  } as UiCommandBoundaryGuard),
  defineUiCommandBoundaryGuard({
    type: TrignoEventTypes.statusRefreshRequest,
    v: 1,
    isPayload: isTrignoCommandRequestPayload,
  } as UiCommandBoundaryGuard),
] as const satisfies readonly UiCommandBoundaryGuard[];

declare module '@sensync2/core' {
  interface UiCommandBoundaryEventMap {
    'trigno.stream.start.request@1': TrignoStreamStartRequestInput;
    'trigno.stream.stop.request@1': TrignoStreamStopRequestInput;
    'trigno.status.refresh.request@1': TrignoStatusRefreshRequestInput;
  }
}
