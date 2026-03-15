import type { EventVersion } from './event-contracts.ts';

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
  v: EventVersion;
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
  v: 1;
  payload: SignalBatchPayload;
}

/**
 * Карта конкретных событий runtime.
 *
 * Shared-слой и plugin-specific пакеты расширяют её через module augmentation.
 */
export interface RuntimeEventMap {}

export type RuntimeEvent = RuntimeEventMap[keyof RuntimeEventMap];
export type RuntimeEventInput = RuntimeEvent extends infer TEvent
  ? TEvent extends RuntimeEvent
    ? Omit<TEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'>
    : never
  : never;
export type RuntimeEventOf<
  TType extends RuntimeEvent['type'],
  TVersion extends Extract<RuntimeEvent, { type: TType }>['v'] = Extract<RuntimeEvent, { type: TType }>['v'],
> = Extract<RuntimeEvent, { type: TType; v: TVersion }>;
export type RuntimeEventInputOf<
  TType extends RuntimeEvent['type'],
  TVersion extends Extract<RuntimeEvent, { type: TType }>['v'] = Extract<RuntimeEvent, { type: TType }>['v'],
> = Omit<RuntimeEventOf<TType, TVersion>, 'seq' | 'tsMonoMs' | 'sourcePluginId'>;

/**
 * Сохраняет точный literal-тип события при создании input-объектов для `emit()` и runtime publish.
 */
export function defineRuntimeEventInput<TEvent extends RuntimeEventInput>(event: TEvent): TEvent {
  return event;
}

export function attachRuntimeEventEnvelope<TEvent extends RuntimeEventInput>(
  event: TEvent,
  seq: EventSeq,
  tsMonoMs: number,
  sourcePluginId: RuntimeEvent['sourcePluginId'],
): RuntimeEventOf<TEvent['type'], TEvent['v']> {
  return {
    ...event,
    seq,
    tsMonoMs,
    sourcePluginId,
  } as unknown as RuntimeEventOf<TEvent['type'], TEvent['v']>;
}

export function isSignalBatchEventInput(event: RuntimeEventInput): event is RuntimeEventInputOf<'signal.batch', 1> {
  return event.type === 'signal.batch';
}

export function isSignalBatchEvent(event: RuntimeEvent): event is SignalBatchEvent {
  return event.type === 'signal.batch';
}

export interface AdapterConnectRequestPayload {
  adapterId: string;
  formData?: Record<string, unknown>;
  requestId?: string;
}

export interface AdapterDisconnectRequestPayload {
  adapterId: string;
  requestId?: string;
}

export interface AdapterScanRequestPayload {
  adapterId: string;
  timeoutMs?: number;
  formData?: Record<string, unknown>;
  requestId?: string;
}

export interface AdapterScanStateChangedPayload {
  adapterId: string;
  scanning: boolean;
  requestId?: string;
  scanId?: string;
  message?: string;
}

export type AdapterScanCandidateDetailValue = string | number | boolean | null;

export interface AdapterScanCandidate {
  candidateId: string;
  title: string;
  subtitle?: string;
  details?: Record<string, AdapterScanCandidateDetailValue>;
  connectFormData: Record<string, unknown>;
}

export interface AdapterScanCandidatesPayload {
  adapterId: string;
  requestId?: string;
  scanId: string;
  candidates: AdapterScanCandidate[];
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

export interface RuntimeStartedPayload {}

export interface ShapeGenerateRequestPayload {
  shapeName?: string;
}

export interface ShapeGeneratedPayload {
  shapeName: string;
}

export interface IntervalCommandPayload {
  requestId?: string;
}

export type RecordingMetadataScalar = string | number | boolean;

export interface RecordingChannelConfig {
  streamId: string;
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
