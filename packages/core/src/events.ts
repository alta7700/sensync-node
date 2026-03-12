export type EventSeq = bigint;
export type PluginId = string;
export type EventType = string;
export type EventPriority = 'control' | 'data' | 'system';
export type EventKind = 'command' | 'fact' | 'data' | 'system';

/**
 * Базовый контракт runtime-события.
 *
 * `seq` и `tsMonoMs` назначаются только рантаймом.
 */
export interface RuntimeEventBase<TType extends EventType = EventType> {
  seq: EventSeq;
  type: TType;
  tsMonoMs: number;
  sourcePluginId: PluginId | 'runtime' | 'external-ui';
  correlationId?: string;
  causationSeq?: EventSeq;
  priority: EventPriority;
  kind: EventKind;
}

export interface CommandEvent<TPayload = unknown, TType extends EventType = EventType>
  extends RuntimeEventBase<TType> {
  kind: 'command';
  payload: TPayload;
}

export interface FactEvent<TPayload = unknown, TType extends EventType = EventType>
  extends RuntimeEventBase<TType> {
  kind: 'fact';
  payload: TPayload;
}

export type SampleFormat = 'f32' | 'f64' | 'i16';
export type FrameKind = 'uniform-signal-batch' | 'irregular-signal-batch' | 'label-batch';
export type SignalValues = Float32Array | Float64Array | Int16Array;

export interface SignalBatchPayload {
  streamId: string;
  channelId: string;
  sampleFormat: SampleFormat;
  frameKind: FrameKind;
  /**
   * Отметка начала батча в миллисекундах от старта сессии (`session time`).
   * Не использовать wall-clock как источник истины для data-path.
   */
  t0Ms: number;
  dtMs?: number;
  sampleRateHz?: number;
  sampleCount: number;
  values: SignalValues;
  timestampsMs?: Float64Array;
  flags?: Uint8Array;
  units?: string;
}

export interface SignalBatchEvent extends RuntimeEventBase<'signal.batch'> {
  kind: 'data';
  priority: 'data';
  payload: SignalBatchPayload;
}

export type RuntimeEvent = CommandEvent | FactEvent | SignalBatchEvent;

export interface AdapterConnectRequestPayload {
  adapterId: string;
  formData?: Record<string, unknown>;
  requestId: string;
}

export interface AdapterDisconnectRequestPayload {
  adapterId: string;
  requestId: string;
}

export interface AdapterStateChangedPayload {
  adapterId: string;
  state: 'disconnected' | 'connecting' | 'connected' | 'paused' | 'disconnecting' | 'failed';
  requestId?: string;
  message?: string;
}

export interface SimulationPauseRequestPayload {
  adapterId: string;
  requestId?: string;
}

export interface SimulationResumeRequestPayload {
  adapterId: string;
  requestId?: string;
}

export interface SimulationSpeedSetRequestPayload {
  adapterId: string;
  speed: number;
  requestId?: string;
}

export interface SimulationStateChangedPayload {
  adapterId: string;
  state: 'disconnected' | 'connecting' | 'connected' | 'paused' | 'disconnecting' | 'failed';
  speed: number;
  batchMs: number;
  filePath: string;
  requestId?: string;
  message?: string;
}

export type RecordingMetadataScalar = string | number | boolean;

export interface RecordingChannelConfig {
  channelId: string;
  minSamples: number;
  maxBufferedMs: number;
}

export interface RecordingStartPayload {
  writer: string;
  filenameTemplate: string;
  channels: RecordingChannelConfig[];
  metadata?: Record<string, RecordingMetadataScalar>;
  requestId?: string;
}

export interface RecordingStopPayload {
  writer: string;
  requestId?: string;
}

export interface RecordingPausePayload {
  writer: string;
  requestId?: string;
}

export interface RecordingResumePayload {
  writer: string;
  requestId?: string;
}

export interface RecordingStateChangedPayload {
  writer: string;
  state: 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'failed';
  requestId?: string;
  filePath?: string;
  message?: string;
}

export interface RecordingErrorPayload {
  writer: string;
  code: string;
  message: string;
  requestId?: string;
  filePath?: string;
}

/**
 * Создает копию typed array с сохранением типа.
 * Это нужно при fan-out в несколько worker'ов в `v1`.
 */
export function cloneSignalValues(values: SignalValues): SignalValues {
  if (values instanceof Float32Array) return new Float32Array(values);
  if (values instanceof Float64Array) return new Float64Array(values);
  return new Int16Array(values);
}

export function cloneSignalBatchPayload(payload: SignalBatchPayload): SignalBatchPayload {
  const cloned: SignalBatchPayload = {
    ...payload,
    values: cloneSignalValues(payload.values),
  };
  if (payload.timestampsMs) cloned.timestampsMs = new Float64Array(payload.timestampsMs);
  if (payload.flags) cloned.flags = new Uint8Array(payload.flags);
  return cloned;
}

/** Возвращает массив передаваемых буферов для `postMessage(..., transferList)`. */
export function getSignalBatchTransferables(payload: SignalBatchPayload): ArrayBuffer[] {
  const list: ArrayBuffer[] = [payload.values.buffer as ArrayBuffer];
  if (payload.timestampsMs) list.push(payload.timestampsMs.buffer as ArrayBuffer);
  if (payload.flags) list.push(payload.flags.buffer as ArrayBuffer);
  return list;
}
