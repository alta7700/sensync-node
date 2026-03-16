import { EventTypes } from './event-types.ts';
import type {
  AdapterConnectRequestPayload,
  AdapterDisconnectRequestPayload,
  AdapterScanRequestPayload,
  LabelMarkRequestPayload,
  RecordingChannelConfig,
  RecordingMetadataScalar,
  RecordingPausePayload,
  RecordingResumePayload,
  RecordingStartPayload,
  RecordingStopPayload,
  ShapeGenerateRequestPayload,
  SimulationPauseRequestPayload,
  SimulationResumeRequestPayload,
  SimulationSpeedSetRequestPayload,
  RuntimeEventInput,
  RuntimeEventInputOf,
  TimelineResetRequestPayload,
} from './events.ts';
import type { EventRef } from './event-contracts.ts';

export type UiCommandRuntimeEvent = Extract<RuntimeEventInput, { kind: 'command' }>;

export interface UiCommandBoundaryGuard<TEvent extends UiCommandRuntimeEvent = UiCommandRuntimeEvent> extends EventRef<TEvent['type'], TEvent['v']> {
  isPayload(input: unknown): input is TEvent['payload'];
}

export type UiCommandBoundaryEvent<TGuards extends readonly UiCommandBoundaryGuard[] = readonly UiCommandBoundaryGuard[]> =
  TGuards[number] extends UiCommandBoundaryGuard<infer TEvent> ? TEvent : never;

export function defineUiCommandBoundaryGuard<TEvent extends UiCommandRuntimeEvent>(
  guard: UiCommandBoundaryGuard<TEvent>,
): UiCommandBoundaryGuard<TEvent> {
  return guard;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isOptionalString(input: unknown): input is string | undefined {
  return input === undefined || typeof input === 'string';
}

function isOptionalNumber(input: unknown): input is number | undefined {
  return input === undefined || (typeof input === 'number' && Number.isFinite(input));
}

function isFormData(input: unknown): input is Record<string, unknown> | undefined {
  return input === undefined || isRecord(input);
}

function isAdapterConnectPayload(input: unknown): input is AdapterConnectRequestPayload {
  if (!isRecord(input)) return false;
  return typeof input.adapterId === 'string'
    && isFormData(input.formData)
    && isOptionalString(input.requestId);
}

function isAdapterDisconnectPayload(input: unknown): input is AdapterDisconnectRequestPayload {
  if (!isRecord(input)) return false;
  return typeof input.adapterId === 'string' && isOptionalString(input.requestId);
}

function isAdapterScanPayload(input: unknown): input is AdapterScanRequestPayload {
  if (!isRecord(input)) return false;
  return typeof input.adapterId === 'string'
    && isOptionalNumber(input.timeoutMs)
    && isFormData(input.formData)
    && isOptionalString(input.requestId);
}

function isSimulationPausePayload(input: unknown): input is SimulationPauseRequestPayload {
  return isAdapterDisconnectPayload(input);
}

function isSimulationResumePayload(input: unknown): input is SimulationResumeRequestPayload {
  return isAdapterDisconnectPayload(input);
}

function isSimulationSpeedPayload(input: unknown): input is SimulationSpeedSetRequestPayload {
  if (!isRecord(input)) return false;
  return typeof input.adapterId === 'string'
    && typeof input.speed === 'number'
    && Number.isFinite(input.speed)
    && isOptionalString(input.requestId);
}

function isRecordingChannelConfig(input: unknown): input is RecordingChannelConfig {
  if (!isRecord(input)) return false;
  return typeof input.streamId === 'string'
    && typeof input.minSamples === 'number'
    && Number.isFinite(input.minSamples)
    && typeof input.maxBufferedMs === 'number'
    && Number.isFinite(input.maxBufferedMs);
}

function isRecordingMetadataValue(input: unknown): input is RecordingMetadataScalar {
  return typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean';
}

function isRecordingMetadata(input: unknown): input is Record<string, RecordingMetadataScalar> | undefined {
  if (input === undefined) return true;
  if (!isRecord(input)) return false;
  return Object.values(input).every((value) => isRecordingMetadataValue(value));
}

function isRecordingStartPayload(input: unknown): input is RecordingStartPayload {
  if (!isRecord(input)) return false;
  return typeof input.writer === 'string'
    && typeof input.filenameTemplate === 'string'
    && Array.isArray(input.channels)
    && input.channels.every((item) => isRecordingChannelConfig(item))
    && isRecordingMetadata(input.metadata)
    && isOptionalString(input.requestId);
}

function isRecordingPausePayload(input: unknown): input is RecordingPausePayload {
  if (!isRecord(input)) return false;
  return typeof input.writer === 'string' && isOptionalString(input.requestId);
}

function isRecordingResumePayload(input: unknown): input is RecordingResumePayload {
  return isRecordingPausePayload(input);
}

function isRecordingStopPayload(input: unknown): input is RecordingStopPayload {
  return isRecordingPausePayload(input);
}

function isShapeGeneratePayload(input: unknown): input is ShapeGenerateRequestPayload {
  if (!isRecord(input)) return false;
  return isOptionalString(input.shapeName);
}

function isLabelMarkRequestPayload(input: unknown): input is LabelMarkRequestPayload {
  if (!isRecord(input)) return false;
  return typeof input.labelId === 'string'
    && typeof input.value === 'number'
    && Number.isFinite(input.value)
    && isOptionalNumber(input.atTimeMs)
    && isOptionalString(input.requestId);
}

function isTimelineResetRequestPayload(input: unknown): input is TimelineResetRequestPayload {
  if (!isRecord(input)) return false;
  return isOptionalString(input.reason) && isOptionalString(input.requestId);
}

export const sharedUiCommandBoundaryGuards = [
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.adapterScanRequest, 1>>({
    type: EventTypes.adapterScanRequest,
    v: 1,
    isPayload: isAdapterScanPayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.adapterConnectRequest, 1>>({
    type: EventTypes.adapterConnectRequest,
    v: 1,
    isPayload: isAdapterConnectPayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.adapterDisconnectRequest, 1>>({
    type: EventTypes.adapterDisconnectRequest,
    v: 1,
    isPayload: isAdapterDisconnectPayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.simulationPauseRequest, 1>>({
    type: EventTypes.simulationPauseRequest,
    v: 1,
    isPayload: isSimulationPausePayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.simulationResumeRequest, 1>>({
    type: EventTypes.simulationResumeRequest,
    v: 1,
    isPayload: isSimulationResumePayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.simulationSpeedSetRequest, 1>>({
    type: EventTypes.simulationSpeedSetRequest,
    v: 1,
    isPayload: isSimulationSpeedPayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.recordingStart, 1>>({
    type: EventTypes.recordingStart,
    v: 1,
    isPayload: isRecordingStartPayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.recordingPause, 1>>({
    type: EventTypes.recordingPause,
    v: 1,
    isPayload: isRecordingPausePayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.recordingResume, 1>>({
    type: EventTypes.recordingResume,
    v: 1,
    isPayload: isRecordingResumePayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.recordingStop, 1>>({
    type: EventTypes.recordingStop,
    v: 1,
    isPayload: isRecordingStopPayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.shapeGenerateRequest, 1>>({
    type: EventTypes.shapeGenerateRequest,
    v: 1,
    isPayload: isShapeGeneratePayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.labelMarkRequest, 1>>({
    type: EventTypes.labelMarkRequest,
    v: 1,
    isPayload: isLabelMarkRequestPayload,
  }),
  defineUiCommandBoundaryGuard<RuntimeEventInputOf<typeof EventTypes.timelineResetRequest, 1>>({
    type: EventTypes.timelineResetRequest,
    v: 1,
    isPayload: isTimelineResetRequestPayload,
  }),
] as const;

export type SharedUiCommandBoundaryEvent = UiCommandBoundaryEvent<typeof sharedUiCommandBoundaryGuards>;

type SharedUiCommandBoundaryEntry<
  TType extends SharedUiCommandBoundaryEvent['type'],
  TVersion extends Extract<SharedUiCommandBoundaryEvent, { type: TType }>['v'],
> = Extract<SharedUiCommandBoundaryEvent, { type: TType; v: TVersion }>;

/**
 * Расширяемая карта UI-команд.
 *
 * Shared-команды объявлены здесь, а plugin-specific пакеты могут
 * достраивать union через module augmentation на `@sensync2/core`.
 */
export interface UiCommandBoundaryEventMap {
  'adapter.scan.request@1': SharedUiCommandBoundaryEntry<typeof EventTypes.adapterScanRequest, 1>;
  'adapter.connect.request@1': SharedUiCommandBoundaryEntry<typeof EventTypes.adapterConnectRequest, 1>;
  'adapter.disconnect.request@1': SharedUiCommandBoundaryEntry<typeof EventTypes.adapterDisconnectRequest, 1>;
  'simulation.pause.request@1': SharedUiCommandBoundaryEntry<typeof EventTypes.simulationPauseRequest, 1>;
  'simulation.resume.request@1': SharedUiCommandBoundaryEntry<typeof EventTypes.simulationResumeRequest, 1>;
  'simulation.speed.set.request@1': SharedUiCommandBoundaryEntry<typeof EventTypes.simulationSpeedSetRequest, 1>;
  'recording.start@1': SharedUiCommandBoundaryEntry<typeof EventTypes.recordingStart, 1>;
  'recording.pause@1': SharedUiCommandBoundaryEntry<typeof EventTypes.recordingPause, 1>;
  'recording.resume@1': SharedUiCommandBoundaryEntry<typeof EventTypes.recordingResume, 1>;
  'recording.stop@1': SharedUiCommandBoundaryEntry<typeof EventTypes.recordingStop, 1>;
  'shape.generate.request@1': SharedUiCommandBoundaryEntry<typeof EventTypes.shapeGenerateRequest, 1>;
  'label.mark.request@1': SharedUiCommandBoundaryEntry<typeof EventTypes.labelMarkRequest, 1>;
  'timeline.reset.request@1': SharedUiCommandBoundaryEntry<typeof EventTypes.timelineResetRequest, 1>;
}

export type UiCommandBoundaryKnownEvent = UiCommandBoundaryEventMap[keyof UiCommandBoundaryEventMap];

export function findUiCommandBoundaryGuard<TGuards extends readonly UiCommandBoundaryGuard[]>(
  guards: TGuards,
  ref: EventRef,
): TGuards[number] | undefined {
  return guards.find((candidate) => candidate.type === ref.type && candidate.v === ref.v);
}
