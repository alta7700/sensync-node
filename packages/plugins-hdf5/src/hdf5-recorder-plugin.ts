import * as path from 'node:path';
import { mkdirSync } from 'node:fs';
import h5wasm from 'h5wasm/node';
import {
  defineRuntimeEventInput,
  EventTypes,
  type FrameKind,
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
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';

type SupportedValueArray = Float32Array | Float64Array | Int16Array;
type RecorderState = RecordingStateChangedPayload['state'];

interface Hdf5RecorderPluginConfig {
  writerKey: string;
  outputDir: string;
  defaultFilenameTemplate?: string;
  trackOrder?: boolean;
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

const DefaultConfig: Hdf5RecorderPluginConfig = {
  writerKey: 'local',
  outputDir: path.resolve(process.cwd(), 'recordings'),
  defaultFilenameTemplate: '{writer}-{startDateTime}',
  trackOrder: true,
};

let pluginConfig: Hdf5RecorderPluginConfig = { ...DefaultConfig };
let recorderState: RecorderState = 'idle';
let session: RecordingSessionState | null = null;

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
    if (!item.channelId) {
      throw new Error('channelId обязателен');
    }
    if (!(item.minSamples > 0)) {
      throw new Error(`minSamples для ${item.channelId} должен быть > 0`);
    }
    if (!(item.maxBufferedMs > 0)) {
      throw new Error(`maxBufferedMs для ${item.channelId} должен быть > 0`);
    }
    if (result.has(item.channelId)) {
      throw new Error(`Повторяющийся channelId в recording.start: ${item.channelId}`);
    }
    result.set(item.channelId, {
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

function materializeTimestamps(payload: SignalBatchEvent['payload']): Float64Array {
  if (payload.timestampsMs) {
    return new Float64Array(payload.timestampsMs);
  }
  if (payload.dtMs === undefined) {
    throw new Error(`Для channelId=${payload.channelId} отсутствуют и timestampsMs, и dtMs`);
  }

  const out = new Float64Array(payload.sampleCount);
  for (let index = 0; index < payload.sampleCount; index += 1) {
    out[index] = payload.t0Ms + index * payload.dtMs;
  }
  return out;
}

function appendChunk(channel: ChannelRuntimeState, payload: SignalBatchEvent['payload']): void {
  if (!isSupportedValueArray(payload.values)) {
    throw new Error(`Неподдерживаемый тип values для ${payload.channelId}`);
  }
  if (payload.sampleCount !== payload.values.length) {
    throw new Error(`sampleCount не совпадает с длиной values для ${payload.channelId}`);
  }

  const timestamps = materializeTimestamps(payload);
  if (timestamps.length !== payload.sampleCount) {
    throw new Error(`timestamps length не совпадает с sampleCount для ${payload.channelId}`);
  }

  if (channel.sampleFormat === null) {
    channel.sampleFormat = payload.sampleFormat;
  } else if (channel.sampleFormat !== payload.sampleFormat) {
    throw new Error(
      `sampleFormat для ${payload.channelId} изменился с ${channel.sampleFormat} на ${payload.sampleFormat}`,
    );
  }

  if (channel.frameKind === null) {
    channel.frameKind = payload.frameKind;
  } else if (channel.frameKind !== payload.frameKind) {
    throw new Error(
      `frameKind для ${payload.channelId} изменился с ${channel.frameKind} на ${payload.frameKind}`,
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
    throw new Error(`Пустой timestamps chunk для ${payload.channelId}`);
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
    throw new Error(`Канал ${channel.config.channelId} ещё не инициализирован данными`);
  }
  if (channel.group && channel.timestampsDataset && channel.valuesDataset) {
    return;
  }

  const chunkSize = Math.max(channel.config.minSamples, 256);
  const group = activeSession.channelsRoot.create_group(channel.config.channelId, pluginConfig.trackOrder ?? true);
  createScalarAttribute(group, 'channelId', channel.config.channelId);
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
    throw new Error(`Нельзя flush канала ${channel.config.channelId} без sampleFormat`);
  }

  ensureChannelArtifacts(activeSession, channel);
  if (!channel.timestampsDataset || !channel.valuesDataset) {
    throw new Error(`Datasets не созданы для ${channel.config.channelId}`);
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

async function startRecording(ctx: PluginContext, payload: RecordingStartPayload): Promise<void> {
  if (recorderState === 'recording' || recorderState === 'paused' || recorderState === 'starting' || recorderState === 'stopping') {
    await ctx.emit(makeErrorEvent(pluginConfig.writerKey, 'invalid_state', `Нельзя выполнить start из состояния ${recorderState}`, undefined, payload.requestId));
    return;
  }

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRecording(ctx, 'stop_failed', message, payload.requestId);
  }
}

async function handleSignalBatch(ctx: PluginContext, event: SignalBatchEvent): Promise<void> {
  if (recorderState !== 'recording' || !session) return;
  const channel = session.channels.get(event.payload.channelId);
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
  manifest: {
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
    ],
  },
  async onInit(ctx) {
    pluginConfig = { ...DefaultConfig, ...(ctx.getConfig<Hdf5RecorderPluginConfig>() ?? {}) };
    pluginConfig.outputDir = path.resolve(pluginConfig.outputDir);
    mkdirSync(pluginConfig.outputDir, { recursive: true });
    await h5wasm.ready;
    session = null;
    recorderState = 'idle';
    await ctx.emit(makeStateEvent(pluginConfig.writerKey, 'idle'));
  },
  async onEvent(event: RuntimeEvent, ctx) {
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
  async onShutdown(ctx) {
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
