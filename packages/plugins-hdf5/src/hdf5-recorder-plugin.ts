import * as path from 'node:path';
import { mkdirSync } from 'node:fs';
import h5wasm from 'h5wasm/node';
import {
  type CommandRejectedPayload,
  defineRuntimeEventInput,
  EventTypes,
  type FrameKind,
  type PluginManifest,
  type RecordingChannelConfig,
  type RecordingErrorPayload,
  type RecordingMetadataScalar,
  type RecordingPausePayload,
  type RecordingResumePayload,
  type RecordingStartPayload,
  type RecordingStateChangedPayload,
  type RecordingStopPayload,
  type RuntimeEvent,
  type SampleFormat,
  type SignalBatchEvent,
} from '@sensync2/core';
import {
  definePlugin,
  type PluginContext,
  type TimelineResetRequestResultContext,
} from '@sensync2/plugin-sdk';

type SupportedValueArray = Float32Array | Float64Array | Int16Array;
type RecorderState = RecordingStateChangedPayload['state'];
type Primitive = string | number | boolean;

interface RecordingStartConditionsConfig {
  checks: RecordingStartCheck[];
}

interface RecordingStartCheck {
  kind: 'fact-field';
  event: { type: string; v: number };
  where?: Record<string, Primitive>;
  field: string;
  eq?: Primitive;
  oneOf?: Primitive[];
  message: string;
}

interface Hdf5RecorderPluginConfig {
  writerKey: string;
  outputDir: string;
  defaultFilenameTemplate?: string;
  trackOrder?: boolean;
  resetTimelineOnStart?: boolean;
  resetTimelineOnStop?: boolean;
  required?: boolean;
  startConditions?: RecordingStartConditionsConfig;
}

type H5File = InstanceType<typeof h5wasm.File>;
type H5Group = InstanceType<typeof h5wasm.Group>;
type H5Dataset = InstanceType<typeof h5wasm.Dataset>;

interface ChannelRuntimeState {
  config: RecordingChannelConfig;
  sampleFormat: SampleFormat | null;
  frameKind: FrameKind | null;
  sampleRateHz: number | null;
  streamId: string | null;
  units: string | null;
  timestampsChunks: Float64Array[];
  valueChunks: SupportedValueArray[];
  bufferedSamples: number;
  firstBufferedTsMs: number | null;
  lastBufferedTsMs: number | null;
  writtenSamples: number;
  group: H5Group | null;
  timestampsDataset: H5Dataset | null;
  valuesDataset: H5Dataset | null;
}

interface RecordingSessionState {
  file: H5File;
  filePath: string;
  channelsRoot: H5Group;
  recordingStartSessionMs: number;
  recordingStartWallMs: number;
  requestId?: string;
  filenameTemplate: string;
  metadata: Record<string, RecordingMetadataScalar>;
  channels: Map<string, ChannelRuntimeState>;
}

interface NormalizedFactFieldCheck {
  kind: 'fact-field';
  event: { type: string; v: number };
  where?: Record<string, Primitive>;
  field: string;
  eq?: Primitive;
  oneOf?: Primitive[];
  message: string;
}

interface NormalizedRecorderConfig {
  writerKey: string;
  outputDir: string;
  defaultFilenameTemplate?: string | undefined;
  trackOrder?: boolean | undefined;
  required: boolean;
  resetTimelineOnStart: boolean;
  resetTimelineOnStop: boolean;
  startConditions: {
    checks: NormalizedFactFieldCheck[];
  };
}

interface PendingStartRequest {
  payload: RecordingStartPayload;
  resetRequestId: string;
}

interface PendingPostStopReset {
  resetRequestId: string;
  requestId: string | undefined;
}

const DefaultConfig: Hdf5RecorderPluginConfig = {
  writerKey: 'local',
  outputDir: path.resolve(process.cwd(), 'recordings'),
  defaultFilenameTemplate: '{writer}-{startDateTime}',
  trackOrder: true,
  resetTimelineOnStart: false,
  resetTimelineOnStop: false,
  required: false,
  startConditions: {
    checks: [],
  },
};

const BaseManifest: PluginManifest = {
  id: 'hdf5-recorder',
  version: '0.1.0',
  required: false,
  subscriptions: [
    { type: EventTypes.recordingStart, v: 1, kind: 'command', priority: 'control' },
    { type: EventTypes.recordingStop, v: 1, kind: 'command', priority: 'control' },
    { type: EventTypes.recordingPause, v: 1, kind: 'command', priority: 'control' },
    { type: EventTypes.recordingResume, v: 1, kind: 'command', priority: 'control' },
    { type: EventTypes.signalBatch, v: 1, kind: 'data', priority: 'data' },
  ],
  mailbox: {
    controlCapacity: 128,
    dataCapacity: 512,
    dataPolicy: 'fail-fast',
  },
  emits: [
    { type: EventTypes.recordingStateChanged, v: 1 },
    { type: EventTypes.recordingError, v: 1 },
    { type: EventTypes.commandRejected, v: 1 },
  ],
};

const manifest: PluginManifest = {
  ...BaseManifest,
  subscriptions: [...BaseManifest.subscriptions],
  emits: [...(BaseManifest.emits ?? [])],
};

let pluginConfig: NormalizedRecorderConfig = { ...DefaultConfig } as NormalizedRecorderConfig;
let recorderState: RecorderState = 'idle';
let session: RecordingSessionState | null = null;
let pendingStartRequest: PendingStartRequest | null = null;
let pendingPostStopReset: PendingPostStopReset | null = null;
const latestFactsByCheckIndex = new Map<number, RuntimeEvent>();

function makeStateEvent(
  writer: string,
  state: RecorderState,
  filePath?: string,
  message?: string,
  requestId?: string,
) {
  const payload: RecordingStateChangedPayload = { writer, state };
  if (filePath !== undefined) payload.filePath = filePath;
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return defineRuntimeEventInput({
    type: EventTypes.recordingStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

function makeErrorEvent(
  writer: string,
  code: string,
  message: string,
  filePath?: string,
  requestId?: string,
) {
  const payload: RecordingErrorPayload = { writer, code, message };
  if (filePath !== undefined) payload.filePath = filePath;
  if (requestId !== undefined) payload.requestId = requestId;
  return defineRuntimeEventInput({
    type: EventTypes.recordingError,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

function isSupportedValueArray(values: SignalBatchEvent['payload']['values']): values is SupportedValueArray {
  return values instanceof Float32Array || values instanceof Float64Array || values instanceof Int16Array;
}

function dtypeForSampleFormat(sampleFormat: SampleFormat): string {
  if (sampleFormat === 'f32') return '<f';
  if (sampleFormat === 'f64') return '<d';
  return '<h';
}

function emptyValuesForSampleFormat(sampleFormat: SampleFormat): SupportedValueArray {
  if (sampleFormat === 'f32') return new Float32Array(0);
  if (sampleFormat === 'f64') return new Float64Array(0);
  return new Int16Array(0);
}

function concatFloat64Arrays(chunks: Float64Array[], totalLength: number): Float64Array {
  const out = new Float64Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function concatValueArrays(chunks: SupportedValueArray[], totalLength: number, sampleFormat: SampleFormat): SupportedValueArray {
  const out = emptyValuesForSampleFormat(sampleFormat);
  const target = out.length === totalLength ? out : (
    sampleFormat === 'f32'
      ? new Float32Array(totalLength)
      : sampleFormat === 'f64'
        ? new Float64Array(totalLength)
        : new Int16Array(totalLength)
  );

  let offset = 0;
  for (const chunk of chunks) {
    target.set(chunk, offset);
    offset += chunk.length;
  }
  return target;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatStartDate(startWallMs: number): { startDate: string; startDateTime: string; createdAtIso: string } {
  const date = new Date(startWallMs);
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return {
    startDate: `${yyyy}${mm}${dd}`,
    startDateTime: `${yyyy}${mm}${dd}-${hh}${mi}${ss}`,
    createdAtIso: date.toISOString(),
  };
}

function sanitizeFileNamePart(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/\.+$/g, '')
    .trim();
}

function renderFileNameTemplate(
  template: string,
  writer: string,
  metadata: Record<string, RecordingMetadataScalar>,
  startWallMs: number,
): string {
  const timeFields = formatStartDate(startWallMs);
  const fields: Record<string, string> = {
    writer,
    startDate: timeFields.startDate,
    startDateTime: timeFields.startDateTime,
  };

  for (const [key, value] of Object.entries(metadata)) {
    fields[key] = String(value);
  }

  const rendered = template.replace(/\{([^}]+)\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    return fields[key] ?? '';
  });

  const sanitized = sanitizeFileNamePart(rendered);
  return sanitized.length > 0 ? sanitized : `${writer}-${timeFields.startDateTime}`;
}

function createFilePath(
  outputDir: string,
  filenameTemplate: string,
  writer: string,
  metadata: Record<string, RecordingMetadataScalar>,
  recordingStartWallMs: number,
): string {
  const baseName = renderFileNameTemplate(filenameTemplate, writer, metadata, recordingStartWallMs);
  const withExtension = baseName.endsWith('.h5') ? baseName : `${baseName}.h5`;
  return path.join(outputDir, withExtension);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function normalizePrimitive(value: unknown, fieldName: string): Primitive {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  throw new Error(`${fieldName} должен быть string | number | boolean`);
}

function normalizeFactFieldCheck(rawCheck: unknown, index: number): NormalizedFactFieldCheck {
  if (!isRecord(rawCheck)) {
    throw new Error(`startConditions.checks[${index}] должен быть объектом`);
  }
  if (rawCheck.kind !== 'fact-field') {
    throw new Error(`startConditions.checks[${index}].kind должен быть "fact-field"`);
  }
  if (!isRecord(rawCheck.event) || typeof rawCheck.event.type !== 'string' || !Number.isInteger(rawCheck.event.v)) {
    throw new Error(`startConditions.checks[${index}].event должен содержать type:string и v:integer`);
  }
  if (typeof rawCheck.field !== 'string' || rawCheck.field.trim().length === 0) {
    throw new Error(`startConditions.checks[${index}].field должен быть непустой строкой`);
  }
  if (typeof rawCheck.message !== 'string' || rawCheck.message.trim().length === 0) {
    throw new Error(`startConditions.checks[${index}].message должен быть непустой строкой`);
  }

  const hasEq = rawCheck.eq !== undefined;
  const hasOneOf = rawCheck.oneOf !== undefined;
  if (hasEq === hasOneOf) {
    throw new Error(`startConditions.checks[${index}] должен задавать ровно одно из eq | oneOf`);
  }

  const normalized: NormalizedFactFieldCheck = {
    kind: 'fact-field',
    event: { type: rawCheck.event.type, v: Number(rawCheck.event.v) },
    field: rawCheck.field.trim(),
    message: rawCheck.message.trim(),
  };

  if (rawCheck.where !== undefined) {
    if (!isRecord(rawCheck.where)) {
      throw new Error(`startConditions.checks[${index}].where должен быть объектом`);
    }
    normalized.where = Object.fromEntries(
      Object.entries(rawCheck.where).map(([key, value]) => {
        return [key, normalizePrimitive(value, `startConditions.checks[${index}].where.${key}`)];
      }),
    );
  }

  if (hasEq) {
    normalized.eq = normalizePrimitive(rawCheck.eq, `startConditions.checks[${index}].eq`);
  }
  if (hasOneOf) {
    if (!Array.isArray(rawCheck.oneOf) || rawCheck.oneOf.length === 0) {
      throw new Error(`startConditions.checks[${index}].oneOf должен быть непустым массивом`);
    }
    normalized.oneOf = rawCheck.oneOf.map((value, oneOfIndex) => {
      return normalizePrimitive(value, `startConditions.checks[${index}].oneOf[${oneOfIndex}]`);
    });
  }

  return normalized;
}

function resolveRecorderConfig(rawConfig: Hdf5RecorderPluginConfig | undefined): NormalizedRecorderConfig {
  const merged = { ...DefaultConfig, ...(rawConfig ?? {}) };
  const rawChecks = merged.startConditions?.checks ?? [];

  return {
    writerKey: merged.writerKey,
    outputDir: path.resolve(merged.outputDir),
    defaultFilenameTemplate: merged.defaultFilenameTemplate,
    trackOrder: merged.trackOrder,
    resetTimelineOnStart: merged.resetTimelineOnStart === true,
    resetTimelineOnStop: merged.resetTimelineOnStop === true,
    required: merged.required === true,
    startConditions: {
      checks: rawChecks.map((check, index) => normalizeFactFieldCheck(check, index)),
    },
  };
}

function resetManifest(): void {
  manifest.required = BaseManifest.required;
  manifest.subscriptions = [...BaseManifest.subscriptions];
  manifest.emits = [...(BaseManifest.emits ?? [])];
}

function subscriptionKey(type: string, v: number): string {
  return `${type}@${v}`;
}

function applyConfigDependentManifest(config: NormalizedRecorderConfig): void {
  resetManifest();
  manifest.required = config.required;

  const knownSubscriptions = new Set(
    manifest.subscriptions.map((subscription) => subscriptionKey(subscription.type, subscription.v)),
  );

  for (const check of config.startConditions.checks) {
    const key = subscriptionKey(check.event.type, check.event.v);
    if (knownSubscriptions.has(key)) {
      continue;
    }
    manifest.subscriptions.push({
      type: check.event.type,
      v: check.event.v,
      kind: 'fact',
    });
    knownSubscriptions.add(key);
  }
}

function validateScalarMetadata(metadata: Record<string, unknown> | undefined): Record<string, RecordingMetadataScalar> {
  if (!metadata) return {};
  const out: Record<string, RecordingMetadataScalar> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`metadata.${key} должен быть string | number | boolean`);
    }
    out[key] = value;
  }
  return out;
}

function validateChannels(channels: RecordingChannelConfig[]): Map<string, ChannelRuntimeState> {
  if (channels.length === 0) {
    throw new Error('channels не может быть пустым');
  }

  const result = new Map<string, ChannelRuntimeState>();
  for (const item of channels) {
    if (!item.streamId) {
      throw new Error('streamId обязателен');
    }
    if (!(item.minSamples > 0)) {
      throw new Error(`minSamples для ${item.streamId} должен быть > 0`);
    }
    if (!(item.maxBufferedMs > 0)) {
      throw new Error(`maxBufferedMs для ${item.streamId} должен быть > 0`);
    }
    if (result.has(item.streamId)) {
      throw new Error(`Повторяющийся streamId в recording.start: ${item.streamId}`);
    }
    result.set(item.streamId, {
      config: item,
      sampleFormat: null,
      frameKind: null,
      sampleRateHz: null,
      streamId: null,
      units: null,
      timestampsChunks: [],
      valueChunks: [],
      bufferedSamples: 0,
      firstBufferedTsMs: null,
      lastBufferedTsMs: null,
      writtenSamples: 0,
      group: null,
      timestampsDataset: null,
      valuesDataset: null,
    });
  }

  return result;
}

function matchesWhereClause(
  payload: unknown,
  where: Record<string, Primitive> | undefined,
): boolean {
  if (!where) {
    return true;
  }
  if (!isRecord(payload)) {
    return false;
  }
  return Object.entries(where).every(([key, expected]) => payload[key] === expected);
}

function updateLatestFacts(event: RuntimeEvent): void {
  if (event.kind !== 'fact') {
    return;
  }
  pluginConfig.startConditions.checks.forEach((check, index) => {
    if (event.type !== check.event.type || event.v !== check.event.v) {
      return;
    }
    if (!matchesWhereClause(event.payload, check.where)) {
      return;
    }
    latestFactsByCheckIndex.set(index, event);
  });
}

function evaluateStartConditions(): string | null {
  const failures: string[] = [];
  for (let index = 0; index < pluginConfig.startConditions.checks.length; index += 1) {
    const check = pluginConfig.startConditions.checks[index]!;
    const event = latestFactsByCheckIndex.get(index);
    if (!event || !isRecord(event.payload)) {
      failures.push(check.message);
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    const fieldValue = payload[check.field];
    if (check.eq !== undefined) {
      if (fieldValue !== check.eq) {
        failures.push(check.message);
      }
      continue;
    }
    if (!check.oneOf?.includes(fieldValue as Primitive)) {
      failures.push(check.message);
    }
  }
  if (failures.length === 0) {
    return null;
  }
  return `Нельзя начать запись: не выполнены условия запуска теста\n- ${failures.join('\n- ')}`;
}

async function emitCommandRejected(
  ctx: PluginContext,
  commandType: string,
  code: string,
  message: string,
  requestId?: string,
  details?: Record<string, Primitive>,
): Promise<void> {
  const payload: CommandRejectedPayload = {
    commandType,
    commandVersion: 1,
    code,
    message,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(details ? { details } : {}),
  };
  await ctx.emit(defineRuntimeEventInput({
    type: EventTypes.commandRejected,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  }));
}

function materializeTimestamps(payload: SignalBatchEvent['payload']): Float64Array {
  if (payload.timestampsMs) {
    return new Float64Array(payload.timestampsMs);
  }
  if (payload.dtMs === undefined) {
    throw new Error(`Для streamId=${payload.streamId} отсутствуют и timestampsMs, и dtMs`);
  }

  const out = new Float64Array(payload.sampleCount);
  for (let index = 0; index < payload.sampleCount; index += 1) {
    out[index] = payload.t0Ms + index * payload.dtMs;
  }
  return out;
}

function appendChunk(channel: ChannelRuntimeState, payload: SignalBatchEvent['payload']): void {
  if (!isSupportedValueArray(payload.values)) {
    throw new Error(`Неподдерживаемый тип values для ${payload.streamId}`);
  }
  if (payload.sampleCount !== payload.values.length) {
    throw new Error(`sampleCount не совпадает с длиной values для ${payload.streamId}`);
  }

  const timestamps = materializeTimestamps(payload);
  if (timestamps.length !== payload.sampleCount) {
    throw new Error(`timestamps length не совпадает с sampleCount для ${payload.streamId}`);
  }

  if (channel.sampleFormat === null) {
    channel.sampleFormat = payload.sampleFormat;
  } else if (channel.sampleFormat !== payload.sampleFormat) {
    throw new Error(
      `sampleFormat для ${payload.streamId} изменился с ${channel.sampleFormat} на ${payload.sampleFormat}`,
    );
  }

  if (channel.frameKind === null) {
    channel.frameKind = payload.frameKind;
  } else if (channel.frameKind !== payload.frameKind) {
    throw new Error(
      `frameKind для ${payload.streamId} изменился с ${channel.frameKind} на ${payload.frameKind}`,
    );
  }

  if (channel.sampleRateHz === null && payload.sampleRateHz !== undefined) {
    channel.sampleRateHz = payload.sampleRateHz;
  }

  if (channel.streamId === null) {
    channel.streamId = payload.streamId;
  }

  if (channel.units === null && payload.units !== undefined) {
    channel.units = payload.units;
  }

  channel.timestampsChunks.push(timestamps);
  channel.valueChunks.push(payload.values);
  channel.bufferedSamples += payload.sampleCount;

  const firstTs = timestamps[0];
  const lastTs = timestamps[timestamps.length - 1];
  if (firstTs === undefined || lastTs === undefined) {
    throw new Error(`Пустой timestamps chunk для ${payload.streamId}`);
  }

  if (channel.firstBufferedTsMs === null) {
    channel.firstBufferedTsMs = firstTs;
  }
  channel.lastBufferedTsMs = lastTs;
}

function shouldFlushChannel(channel: ChannelRuntimeState): boolean {
  if (channel.bufferedSamples === 0) return false;
  if (channel.bufferedSamples >= channel.config.minSamples) return true;
  if (channel.firstBufferedTsMs === null || channel.lastBufferedTsMs === null) return false;
  return (channel.lastBufferedTsMs - channel.firstBufferedTsMs) >= channel.config.maxBufferedMs;
}

function createScalarAttribute(target: H5File | H5Group, name: string, value: RecordingMetadataScalar | string): void {
  if (typeof value === 'boolean') {
    // `h5wasm` не умеет принимать boolean напрямую как guessable input для create_attribute.
    target.create_attribute(name, value ? 'true' : 'false');
    return;
  }
  target.create_attribute(name, value);
}

function ensureChannelArtifacts(
  activeSession: RecordingSessionState,
  channel: ChannelRuntimeState,
): void {
  if (channel.sampleFormat === null || channel.frameKind === null || channel.streamId === null) {
    throw new Error(`Поток ${channel.config.streamId} ещё не инициализирован данными`);
  }
  if (channel.group && channel.timestampsDataset && channel.valuesDataset) {
    return;
  }

  const chunkSize = Math.max(channel.config.minSamples, 256);
  const group = activeSession.channelsRoot.create_group(channel.config.streamId, pluginConfig.trackOrder ?? true);
  createScalarAttribute(group, 'streamId', channel.streamId);
  createScalarAttribute(group, 'sampleFormat', channel.sampleFormat);
  createScalarAttribute(group, 'frameKind', channel.frameKind);
  createScalarAttribute(group, 'minSamples', channel.config.minSamples);
  createScalarAttribute(group, 'maxBufferedMs', channel.config.maxBufferedMs);
  if (channel.sampleRateHz !== null) {
    createScalarAttribute(group, 'sampleRateHz', channel.sampleRateHz);
  }
  if (channel.units !== null) {
    createScalarAttribute(group, 'units', channel.units);
  }

  channel.timestampsDataset = group.create_dataset({
    name: 'timestamps',
    data: new Float64Array(0),
    shape: [0],
    maxshape: [null],
    chunks: [chunkSize],
    dtype: '<d',
  });
  channel.valuesDataset = group.create_dataset({
    name: 'values',
    data: emptyValuesForSampleFormat(channel.sampleFormat),
    shape: [0],
    maxshape: [null],
    chunks: [chunkSize],
    dtype: dtypeForSampleFormat(channel.sampleFormat),
  });
  channel.group = group;
}

function flushChannel(activeSession: RecordingSessionState, channel: ChannelRuntimeState): void {
  if (channel.bufferedSamples === 0) return;
  if (channel.sampleFormat === null) {
    throw new Error(`Нельзя flush потока ${channel.config.streamId} без sampleFormat`);
  }

  ensureChannelArtifacts(activeSession, channel);
  if (!channel.timestampsDataset || !channel.valuesDataset) {
    throw new Error(`Datasets не созданы для ${channel.config.streamId}`);
  }

  const timestamps = concatFloat64Arrays(channel.timestampsChunks, channel.bufferedSamples);
  const values = concatValueArrays(channel.valueChunks, channel.bufferedSamples, channel.sampleFormat);
  const from = channel.writtenSamples;
  const to = from + channel.bufferedSamples;

  channel.timestampsDataset.resize([to]);
  channel.timestampsDataset.write_slice([[from, to]], timestamps);
  channel.valuesDataset.resize([to]);
  channel.valuesDataset.write_slice([[from, to]], values);
  activeSession.file.flush();

  channel.timestampsChunks = [];
  channel.valueChunks = [];
  channel.bufferedSamples = 0;
  channel.firstBufferedTsMs = null;
  channel.lastBufferedTsMs = null;
  channel.writtenSamples = to;
}

function flushAllChannels(activeSession: RecordingSessionState): void {
  let flushedAny = false;
  for (const channel of activeSession.channels.values()) {
    if (channel.bufferedSamples === 0) continue;
    flushChannel(activeSession, channel);
    flushedAny = true;
  }
  if (flushedAny) {
    activeSession.file.flush();
  }
}

function closeSession(): void {
  if (!session) return;
  try {
    session.file.flush();
  } catch {
    // Игнорируем вторичную ошибку при аварийном закрытии.
  }
  try {
    session.file.close();
  } catch {
    // Игнорируем вторичную ошибку при аварийном закрытии.
  }
  session = null;
}

async function setRecorderState(
  ctx: PluginContext,
  nextState: RecorderState,
  message?: string,
  requestId?: string,
): Promise<void> {
  recorderState = nextState;
  await ctx.emit(makeStateEvent(pluginConfig.writerKey, nextState, session?.filePath, message, requestId));
}

async function failRecording(
  ctx: PluginContext,
  code: string,
  message: string,
  requestId?: string,
): Promise<void> {
  const filePath = session?.filePath;
  closeSession();
  recorderState = 'failed';
  await ctx.emit(makeErrorEvent(pluginConfig.writerKey, code, message, filePath, requestId));
  await ctx.emit(makeStateEvent(pluginConfig.writerKey, 'failed', filePath, message, requestId));
}

async function openRecordingSession(ctx: PluginContext, payload: RecordingStartPayload): Promise<void> {
  try {
    const metadata = validateScalarMetadata(payload.metadata);
    const channels = validateChannels(payload.channels);
    const filenameTemplate = payload.filenameTemplate || pluginConfig.defaultFilenameTemplate || DefaultConfig.defaultFilenameTemplate!;
    const outputDir = path.resolve(pluginConfig.outputDir);
    const recordingStartSessionMs = ctx.clock.nowSessionMs();
    const recordingStartWallMs = ctx.clock.sessionStartWallMs() + recordingStartSessionMs;
    mkdirSync(outputDir, { recursive: true });

    await setRecorderState(ctx, 'starting', undefined, payload.requestId);

    const filePath = createFilePath(
      outputDir,
      filenameTemplate,
      payload.writer,
      metadata,
      recordingStartWallMs,
    );

    const file = new h5wasm.File(filePath, 'w', { track_order: pluginConfig.trackOrder ?? true });
    const channelsRoot = file.create_group('channels', pluginConfig.trackOrder ?? true);

    createScalarAttribute(file, 'writer', payload.writer);
    createScalarAttribute(file, 'sessionStartWallMs', ctx.clock.sessionStartWallMs());
    createScalarAttribute(file, 'recordingStartWallMs', recordingStartWallMs);
    createScalarAttribute(file, 'recordingStartSessionMs', recordingStartSessionMs);
    createScalarAttribute(file, 'createdAt', new Date(recordingStartWallMs).toISOString());
    createScalarAttribute(file, 'filenameTemplate', filenameTemplate);
    createScalarAttribute(file, 'recorderPluginId', 'hdf5-recorder');
    for (const [key, value] of Object.entries(metadata)) {
      createScalarAttribute(file, key, value);
    }

    session = {
      file,
      filePath,
      channelsRoot,
      recordingStartSessionMs,
      recordingStartWallMs,
      filenameTemplate,
      metadata,
      channels,
    };
    if (payload.requestId !== undefined) {
      session.requestId = payload.requestId;
    }

    await setRecorderState(ctx, 'recording', undefined, payload.requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRecording(ctx, 'start_failed', message, payload.requestId);
  }
}

function canStartRecording(): boolean {
  return recorderState === 'idle' || recorderState === 'failed';
}

function hasPendingResetFlow(): boolean {
  return pendingStartRequest !== null || pendingPostStopReset !== null;
}

async function startRecording(ctx: PluginContext, payload: RecordingStartPayload): Promise<void> {
  if (!canStartRecording()) {
    await emitCommandRejected(
      ctx,
      EventTypes.recordingStart,
      'invalid_state',
      `Нельзя выполнить start из состояния ${recorderState}`,
      payload.requestId,
      { writer: payload.writer },
    );
    return;
  }
  if (hasPendingResetFlow()) {
    await emitCommandRejected(
      ctx,
      EventTypes.recordingStart,
      'pending_timeline_reset',
      'Нельзя выполнить start: recorder ещё не завершил предыдущий reset-flow',
      payload.requestId,
      { writer: payload.writer },
    );
    return;
  }

  const startConditionFailure = evaluateStartConditions();
  if (startConditionFailure) {
    await emitCommandRejected(
      ctx,
      EventTypes.recordingStart,
      'recording_start_preflight_failed',
      startConditionFailure,
      payload.requestId,
      { writer: payload.writer },
    );
    return;
  }

  if (!pluginConfig.resetTimelineOnStart) {
    await openRecordingSession(ctx, payload);
    return;
  }

  const resetRequestId = ctx.requestTimelineReset(`recording.start:${pluginConfig.writerKey}`);
  if (!resetRequestId) {
    await emitCommandRejected(
      ctx,
      EventTypes.recordingStart,
      'timeline_reset_request_unavailable',
      'Запись не началась: не удалось отправить запрос на сброс timeline',
      payload.requestId,
      { writer: payload.writer },
    );
    return;
  }

  pendingStartRequest = { payload, resetRequestId };
  await setRecorderState(ctx, 'starting', undefined, payload.requestId);
}

async function pauseRecording(ctx: PluginContext, payload: RecordingPausePayload): Promise<void> {
  if (recorderState !== 'recording' || !session) {
    await ctx.emit(makeErrorEvent(pluginConfig.writerKey, 'invalid_state', `Нельзя выполнить pause из состояния ${recorderState}`, undefined, payload.requestId));
    return;
  }

  try {
    flushAllChannels(session);
    await setRecorderState(ctx, 'paused', undefined, payload.requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRecording(ctx, 'pause_failed', message, payload.requestId);
  }
}

async function resumeRecording(ctx: PluginContext, payload: RecordingResumePayload): Promise<void> {
  if (recorderState !== 'paused' || !session) {
    await ctx.emit(makeErrorEvent(pluginConfig.writerKey, 'invalid_state', `Нельзя выполнить resume из состояния ${recorderState}`, undefined, payload.requestId));
    return;
  }

  await setRecorderState(ctx, 'recording', undefined, payload.requestId);
}

async function stopRecording(ctx: PluginContext, payload: RecordingStopPayload): Promise<void> {
  if ((recorderState !== 'recording' && recorderState !== 'paused') || !session) {
    await ctx.emit(makeErrorEvent(pluginConfig.writerKey, 'invalid_state', `Нельзя выполнить stop из состояния ${recorderState}`, undefined, payload.requestId));
    return;
  }

  try {
    await setRecorderState(ctx, 'stopping', undefined, payload.requestId);
    flushAllChannels(session);
    closeSession();
    await setRecorderState(ctx, 'idle', undefined, payload.requestId);
    if (pluginConfig.resetTimelineOnStop) {
      const resetRequestId = ctx.requestTimelineReset(`recording.stop:${pluginConfig.writerKey}`);
      if (!resetRequestId) {
        await emitCommandRejected(
          ctx,
          EventTypes.recordingStop,
          'recording_stop_post_reset_unavailable',
          'Запись остановлена, но не удалось отправить запрос на сброс timeline, рекомендуется перезапустить приложение',
          payload.requestId,
          { writer: pluginConfig.writerKey },
        );
        return;
      }
      pendingPostStopReset = { resetRequestId, requestId: payload.requestId };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRecording(ctx, 'stop_failed', message, payload.requestId);
  }
}

function buildStartResetFailureMessage(result: TimelineResetRequestResultContext): string {
  if (result.status === 'rejected') {
    return `Запись не началась: ${result.message}`;
  }
  return 'Запись не началась: не удалось сбросить timeline';
}

function resolveStartResetFailureCode(result: TimelineResetRequestResultContext): string {
  return result.status === 'rejected' ? result.code : 'timeline_reset_failed';
}

function buildPostStopResetFailureMessage(result: TimelineResetRequestResultContext): string {
  if (result.status === 'rejected') {
    return `Запись остановлена, но ${result.message.toLowerCase()}, рекомендуется перезапустить приложение`;
  }
  return 'Запись остановлена, но не удалось сбросить timeline, рекомендуется перезапустить приложение';
}

async function handleSignalBatch(ctx: PluginContext, event: SignalBatchEvent): Promise<void> {
  if (recorderState !== 'recording' || !session) return;
  const channel = session.channels.get(event.payload.streamId);
  if (!channel) return;

  try {
    appendChunk(channel, event.payload);
    if (shouldFlushChannel(channel)) {
      flushChannel(session, channel);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRecording(ctx, 'write_failed', message, session.requestId);
  }
}

export default definePlugin({
  manifest,
  async onInit(ctx) {
    pluginConfig = resolveRecorderConfig(ctx.getConfig<Hdf5RecorderPluginConfig>() ?? undefined);
    applyConfigDependentManifest(pluginConfig);
    mkdirSync(pluginConfig.outputDir, { recursive: true });
    await h5wasm.ready;
    session = null;
    recorderState = 'idle';
    pendingStartRequest = null;
    pendingPostStopReset = null;
    latestFactsByCheckIndex.clear();
    await ctx.emit(makeStateEvent(pluginConfig.writerKey, 'idle'));
  },
  async onEvent(event: RuntimeEvent, ctx) {
    updateLatestFacts(event);

    if (event.type === EventTypes.recordingStart) {
      const payload: RecordingStartPayload = event.payload;
      if (payload.writer !== pluginConfig.writerKey) return;
      await startRecording(ctx, payload);
      return;
    }

    if (event.type === EventTypes.recordingPause) {
      const payload: RecordingPausePayload = event.payload;
      if (payload.writer !== pluginConfig.writerKey) return;
      await pauseRecording(ctx, payload);
      return;
    }

    if (event.type === EventTypes.recordingResume) {
      const payload: RecordingResumePayload = event.payload;
      if (payload.writer !== pluginConfig.writerKey) return;
      await resumeRecording(ctx, payload);
      return;
    }

    if (event.type === EventTypes.recordingStop) {
      const payload: RecordingStopPayload = event.payload;
      if (payload.writer !== pluginConfig.writerKey) return;
      await stopRecording(ctx, payload);
      return;
    }

    if (event.type === EventTypes.signalBatch) {
      await handleSignalBatch(ctx, event);
    }
  },
  async onTimelineResetPrepare() {},
  async onTimelineResetAbort(input, ctx) {
    void input;
    void ctx;
  },
  async onTimelineResetCommit(_input, ctx) {
    void ctx;
  },
  async onTimelineResetRequestResult(input, ctx) {
    if (pendingStartRequest && pendingStartRequest.resetRequestId === input.requestId) {
      const pendingPayload = pendingStartRequest.payload;
      pendingStartRequest = null;
      if (input.status === 'succeeded') {
        await openRecordingSession(ctx, pendingPayload);
        return;
      }

      recorderState = 'idle';
      await emitCommandRejected(
        ctx,
        EventTypes.recordingStart,
        resolveStartResetFailureCode(input),
        buildStartResetFailureMessage(input),
        pendingPayload.requestId,
        { writer: pendingPayload.writer },
      );
      await ctx.emit(makeStateEvent(pluginConfig.writerKey, 'idle', undefined, undefined, pendingPayload.requestId));
      return;
    }

    if (pendingPostStopReset && pendingPostStopReset.resetRequestId === input.requestId) {
      const requestId = pendingPostStopReset.requestId;
      pendingPostStopReset = null;
      if (input.status === 'succeeded') {
        return;
      }
      await emitCommandRejected(
        ctx,
        EventTypes.recordingStop,
        'recording_stop_post_reset_failed',
        buildPostStopResetFailureMessage(input),
        requestId,
        { writer: pluginConfig.writerKey },
      );
    }
  },
  async onShutdown(ctx) {
    pendingStartRequest = null;
    pendingPostStopReset = null;
    latestFactsByCheckIndex.clear();
    if (!session) return;
    try {
      flushAllChannels(session);
      closeSession();
      recorderState = 'idle';
      await ctx.emit(makeStateEvent(pluginConfig.writerKey, 'idle'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      closeSession();
      await ctx.emit(makeErrorEvent(pluginConfig.writerKey, 'shutdown_failed', message));
      recorderState = 'failed';
    }
  },
});
