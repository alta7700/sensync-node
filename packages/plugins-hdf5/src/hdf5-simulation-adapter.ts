import * as path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import h5wasm from 'h5wasm/node';
import {
  EventTypes,
  type AdapterConnectRequestPayload,
  type AdapterDisconnectRequestPayload,
  type AdapterStateChangedPayload,
  type CommandEvent,
  type FactEvent,
  type FrameKind,
  type RuntimeEvent,
  type SampleFormat,
  type SignalBatchEvent,
  type SimulationPauseRequestPayload,
  type SimulationResumeRequestPayload,
  type SimulationSpeedSetRequestPayload,
  type SimulationStateChangedPayload,
} from '@sensync2/core';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';

type SupportedValueArray = Float32Array | Float64Array | Int16Array;
type H5File = InstanceType<typeof h5wasm.File>;
type H5Group = InstanceType<typeof h5wasm.Group>;
type H5Dataset = InstanceType<typeof h5wasm.Dataset>;
type SimulationRuntimeState = SimulationStateChangedPayload['state'];

interface Hdf5SimulationAdapterConfig {
  adapterId?: string;
  filePath: string;
  channelIds?: string[];
  batchMs?: number;
  speed?: number;
  readChunkSamples?: number;
}

interface ChannelReaderState {
  channelId: string;
  streamId: string;
  frameKind: FrameKind;
  sampleFormat: SampleFormat;
  sampleRateHz?: number;
  units?: string;
  sampleCount: number;
  cursor: number;
  timestampsDataset: H5Dataset;
  valuesDataset: H5Dataset;
  bufferStartIndex: number;
  bufferEndIndex: number;
  bufferedTimestamps: Float64Array;
  bufferedValues: SupportedValueArray;
}

interface SimulationSessionState {
  file: H5File;
  filePath: string;
  channels: ChannelReaderState[];
  missingChannelIds: string[];
  dataStartMs: number;
  dataEndMs: number;
  currentWindowStartMs: number;
  cycleIndex: number;
}

const AllowedSimulationSpeeds = [0.25, 0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8] as const;
const SimulationTickType = 'hdf5.simulation.tick';
const DefaultConfig: Required<Hdf5SimulationAdapterConfig> = {
  adapterId: 'hdf5-simulation',
  filePath: '',
  channelIds: [],
  batchMs: 50,
  speed: 1,
  readChunkSamples: 4096,
};

let config: Required<Hdf5SimulationAdapterConfig> = { ...DefaultConfig };
let session: SimulationSessionState | null = null;
let runtimeState: SimulationRuntimeState = 'disconnected';

function isAllowedSimulationSpeed(value: number): boolean {
  return AllowedSimulationSpeeds.includes(value as (typeof AllowedSimulationSpeeds)[number]);
}

function makeAdapterStateEvent(
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

function makeSimulationStateEvent(
  adapterId: string,
  state: SimulationRuntimeState,
  speed: number,
  batchMs: number,
  filePath: string,
  message?: string,
  requestId?: string,
): Omit<FactEvent<SimulationStateChangedPayload>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: SimulationStateChangedPayload = {
    adapterId,
    state,
    speed,
    batchMs,
    filePath,
  };
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return {
    type: EventTypes.simulationStateChanged,
    kind: 'fact',
    priority: 'system',
    payload,
  };
}

async function emitRuntimeState(ctx: PluginContext, nextState: SimulationRuntimeState, message?: string, requestId?: string): Promise<void> {
  runtimeState = nextState;
  await ctx.emit(makeAdapterStateEvent(config.adapterId, nextState, message, requestId));
  await ctx.emit(makeSimulationStateEvent(config.adapterId, nextState, config.speed, config.batchMs, config.filePath, message, requestId));
}

async function emitSimulationSnapshot(ctx: PluginContext, message?: string, requestId?: string): Promise<void> {
  await ctx.emit(makeSimulationStateEvent(config.adapterId, runtimeState, config.speed, config.batchMs, config.filePath, message, requestId));
}

function emptyValues(sampleFormat: SampleFormat): SupportedValueArray {
  if (sampleFormat === 'f32') return new Float32Array(0);
  if (sampleFormat === 'f64') return new Float64Array(0);
  return new Int16Array(0);
}

function concatValues(chunks: SupportedValueArray[], totalLength: number, sampleFormat: SampleFormat): SupportedValueArray {
  if (sampleFormat === 'f32') {
    const out = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk as Float32Array, offset);
      offset += chunk.length;
    }
    return out;
  }
  if (sampleFormat === 'f64') {
    const out = new Float64Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk as Float64Array, offset);
      offset += chunk.length;
    }
    return out;
  }
  const out = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk as Int16Array, offset);
    offset += chunk.length;
  }
  return out;
}

function concatTimestamps(chunks: Float64Array[], totalLength: number): Float64Array {
  const out = new Float64Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function requireStringAttribute(group: H5Group, name: string): string {
  const attr = group.attrs[name];
  if (!attr) {
    throw new Error(`В ${group.path} отсутствует обязательный attr ${name}`);
  }
  const value = attr.json_value;
  if (typeof value !== 'string') {
    throw new Error(`Attr ${group.path}/${name} должен быть string`);
  }
  return value;
}

function readOptionalStringAttribute(group: H5Group, name: string): string | undefined {
  const attr = group.attrs[name];
  if (!attr) return undefined;
  const value = attr.json_value;
  if (typeof value !== 'string') {
    throw new Error(`Attr ${group.path}/${name} должен быть string`);
  }
  return value;
}

function readOptionalNumberAttribute(group: H5Group, name: string): number | undefined {
  const attr = group.attrs[name];
  if (!attr) return undefined;
  const value = attr.json_value;
  if (typeof value !== 'number') {
    throw new Error(`Attr ${group.path}/${name} должен быть number`);
  }
  return value;
}

function readFrameKindAttribute(group: H5Group): FrameKind {
  const value = requireStringAttribute(group, 'frameKind');
  if (value === 'uniform-signal-batch' || value === 'irregular-signal-batch' || value === 'label-batch') {
    return value;
  }
  throw new Error(`Attr ${group.path}/frameKind содержит неподдерживаемое значение ${value}`);
}

function readSampleFormatAttribute(group: H5Group): SampleFormat {
  const value = requireStringAttribute(group, 'sampleFormat');
  if (value === 'f32' || value === 'f64' || value === 'i16') {
    return value;
  }
  throw new Error(`Attr ${group.path}/sampleFormat содержит неподдерживаемое значение ${value}`);
}

function requireDataset(group: H5Group, name: string): H5Dataset {
  const entity = group.get(name);
  if (!(entity instanceof h5wasm.Dataset)) {
    throw new Error(`В ${group.path} отсутствует dataset ${name}`);
  }
  return entity;
}

function requireTypedSlice(dataset: H5Dataset, start: number, end: number): SupportedValueArray | Float64Array {
  const sliced = dataset.slice([[start, end]]);
  if (
    sliced instanceof Float32Array
    || sliced instanceof Float64Array
    || sliced instanceof Int16Array
  ) {
    return sliced;
  }
  throw new Error(`Dataset ${dataset.path} вернул неподдерживаемый тип slice`);
}

function assertValueArrayMatchesSampleFormat(values: SupportedValueArray, sampleFormat: SampleFormat, datasetPath: string): void {
  if (sampleFormat === 'f32' && !(values instanceof Float32Array)) {
    throw new Error(`Dataset ${datasetPath} должен читать Float32Array для sampleFormat=f32`);
  }
  if (sampleFormat === 'f64' && !(values instanceof Float64Array)) {
    throw new Error(`Dataset ${datasetPath} должен читать Float64Array для sampleFormat=f64`);
  }
  if (sampleFormat === 'i16' && !(values instanceof Int16Array)) {
    throw new Error(`Dataset ${datasetPath} должен читать Int16Array для sampleFormat=i16`);
  }
}

function requireOneDimensionalLength(dataset: H5Dataset): number {
  const shape = dataset.shape;
  if (!shape || shape.length !== 1) {
    throw new Error(`Dataset ${dataset.path} должен быть одномерным`);
  }
  const [length] = shape;
  if (typeof length !== 'number' || length < 0) {
    throw new Error(`Dataset ${dataset.path} имеет некорректную длину`);
  }
  return length;
}

function readTimestampBoundary(dataset: H5Dataset, index: number): number {
  const value = requireTypedSlice(dataset, index, index + 1);
  if (!(value instanceof Float64Array) || value.length !== 1) {
    throw new Error(`Dataset ${dataset.path} должен возвращать Float64Array для timestamps`);
  }
  return value[0]!;
}

function upperBoundInBuffer(buffer: Float64Array, fromIndex: number, toIndex: number, targetTsMs: number): number {
  let lo = fromIndex;
  let hi = toIndex;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (buffer[mid]! < targetTsMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function loadBuffer(channel: ChannelReaderState, startIndex: number): void {
  if (startIndex >= channel.sampleCount) {
    channel.bufferStartIndex = channel.sampleCount;
    channel.bufferEndIndex = channel.sampleCount;
    channel.bufferedTimestamps = new Float64Array(0);
    channel.bufferedValues = emptyValues(channel.sampleFormat);
    return;
  }

  const endIndex = Math.min(channel.sampleCount, startIndex + config.readChunkSamples);
  const timestamps = requireTypedSlice(channel.timestampsDataset, startIndex, endIndex);
  const values = requireTypedSlice(channel.valuesDataset, startIndex, endIndex);

  if (!(timestamps instanceof Float64Array)) {
    throw new Error(`Dataset ${channel.timestampsDataset.path} должен возвращать Float64Array`);
  }
  if (!(values instanceof Float32Array || values instanceof Float64Array || values instanceof Int16Array)) {
    throw new Error(`Dataset ${channel.valuesDataset.path} вернул неподдерживаемый тип values`);
  }
  assertValueArrayMatchesSampleFormat(values, channel.sampleFormat, channel.valuesDataset.path);
  if (timestamps.length !== values.length) {
    throw new Error(`В ${channel.channelId} длины timestamps и values не совпадают`);
  }

  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index]! < timestamps[index - 1]!) {
      throw new Error(`timestamps для ${channel.channelId} не монотонны внутри chunk`);
    }
  }

  channel.bufferStartIndex = startIndex;
  channel.bufferEndIndex = endIndex;
  channel.bufferedTimestamps = timestamps;
  channel.bufferedValues = values;
}

function ensureBufferForCursor(channel: ChannelReaderState): void {
  if (channel.cursor >= channel.sampleCount) return;
  if (channel.cursor < channel.bufferStartIndex || channel.cursor >= channel.bufferEndIndex) {
    loadBuffer(channel, channel.cursor);
  }
}

function buildSignalEvent(channel: ChannelReaderState, timestamps: Float64Array, values: SupportedValueArray): Omit<SignalBatchEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: SignalBatchEvent['payload'] = {
    streamId: channel.streamId,
    channelId: channel.channelId,
    sampleFormat: channel.sampleFormat,
    frameKind: channel.frameKind,
    t0Ms: timestamps[0] ?? 0,
    sampleCount: values.length,
    values,
  };

  if (channel.units !== undefined) payload.units = channel.units;

  if (channel.frameKind === 'uniform-signal-batch' && channel.sampleRateHz !== undefined && timestamps.length > 0) {
    payload.dtMs = 1000 / channel.sampleRateHz;
    payload.sampleRateHz = channel.sampleRateHz;
    return {
      type: 'signal.batch',
      kind: 'data',
      priority: 'data',
      payload,
    };
  }

  payload.frameKind = channel.frameKind === 'uniform-signal-batch' ? 'irregular-signal-batch' : channel.frameKind;
  payload.dtMs = 0;
  payload.timestampsMs = timestamps;
  if (channel.sampleRateHz !== undefined) payload.sampleRateHz = channel.sampleRateHz;
  return {
    type: 'signal.batch',
    kind: 'data',
    priority: 'data',
    payload,
  };
}

function readWindowForChannel(channel: ChannelReaderState, windowEndMs: number): Omit<SignalBatchEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'> | null {
  if (channel.cursor >= channel.sampleCount) return null;

  const timestampParts: Float64Array[] = [];
  const valueParts: SupportedValueArray[] = [];
  let totalSamples = 0;

  while (channel.cursor < channel.sampleCount) {
    ensureBufferForCursor(channel);
    if (channel.bufferedTimestamps.length === 0) break;

    const localStart = channel.cursor - channel.bufferStartIndex;
    const firstTs = channel.bufferedTimestamps[localStart];
    if (firstTs === undefined || firstTs >= windowEndMs) {
      break;
    }

    const localEnd = upperBoundInBuffer(
      channel.bufferedTimestamps,
      localStart,
      channel.bufferedTimestamps.length,
      windowEndMs,
    );
    if (localEnd <= localStart) {
      break;
    }

    timestampParts.push(channel.bufferedTimestamps.slice(localStart, localEnd));
    valueParts.push(channel.bufferedValues.slice(localStart, localEnd) as SupportedValueArray);
    totalSamples += localEnd - localStart;
    channel.cursor += localEnd - localStart;

    if (localEnd < channel.bufferedTimestamps.length) {
      break;
    }
  }

  if (totalSamples === 0) return null;

  const timestamps = concatTimestamps(timestampParts, totalSamples);
  const values = concatValues(valueParts, totalSamples, channel.sampleFormat);
  return buildSignalEvent(channel, timestamps, values);
}

function resetSessionCursor(activeSession: SimulationSessionState): void {
  activeSession.currentWindowStartMs = activeSession.dataStartMs;
  activeSession.cycleIndex = 0;
  for (const channel of activeSession.channels) {
    channel.cursor = 0;
    channel.bufferStartIndex = 0;
    channel.bufferEndIndex = 0;
    channel.bufferedTimestamps = new Float64Array(0);
    channel.bufferedValues = emptyValues(channel.sampleFormat);
  }
}

function stopTimer(ctx: PluginContext): void {
  ctx.clearTimer('hdf5.simulation.timer');
}

function startTimer(ctx: PluginContext): void {
  const intervalMs = Math.max(1, Math.round(config.batchMs / config.speed));
  ctx.setTimer('hdf5.simulation.timer', intervalMs, () => ({
    type: SimulationTickType,
    kind: 'fact',
    priority: 'system',
    payload: {},
  }));
}

function resolveConfig(rawConfig: Hdf5SimulationAdapterConfig | undefined): Required<Hdf5SimulationAdapterConfig> {
  const next = { ...DefaultConfig, ...(rawConfig ?? {}) };
  next.adapterId = typeof next.adapterId === 'string' && next.adapterId.length > 0 ? next.adapterId : DefaultConfig.adapterId;
  const rawFilePath = typeof next.filePath === 'string' ? next.filePath.trim() : '';
  if (rawFilePath.length === 0) {
    throw new Error('Не задан filePath для hdf5-simulation-adapter');
  }
  next.filePath = path.resolve(rawFilePath);
  next.channelIds = Array.isArray(next.channelIds)
    ? [...new Set(next.channelIds.map((value) => String(value).trim()).filter((value) => value.length > 0))]
    : [];
  next.batchMs = Math.max(1, Math.trunc(next.batchMs));
  next.readChunkSamples = Math.max(1, Math.trunc(next.readChunkSamples));
  if (!isAllowedSimulationSpeed(next.speed)) {
    throw new Error(`speed=${next.speed} не входит в допустимый набор ${AllowedSimulationSpeeds.join(', ')}`);
  }
  return next;
}

function loadSession(filePath: string, selectedChannelIds: readonly string[]): SimulationSessionState {
  if (!existsSync(filePath)) {
    throw new Error(`HDF5 файл не найден: ${filePath}`);
  }
  if (!statSync(filePath).isFile()) {
    throw new Error(`HDF5 путь должен указывать на файл, а не на директорию: ${filePath}`);
  }

  const file = new h5wasm.File(filePath, 'r');
  const channelsRoot = file.get('channels');
  if (!(channelsRoot instanceof h5wasm.Group)) {
    file.close();
    throw new Error(`В файле ${filePath} отсутствует группа /channels`);
  }

  const channels: ChannelReaderState[] = [];
  const selectedSet = selectedChannelIds.length > 0 ? new Set(selectedChannelIds) : null;
  const missingChannelIds = selectedSet ? [...selectedChannelIds] : [];
  let globalStartMs = Number.POSITIVE_INFINITY;
  let globalEndMs = Number.NEGATIVE_INFINITY;

  try {
    for (const channelKey of channelsRoot.keys()) {
      const channelGroup = channelsRoot.get(channelKey);
      if (!(channelGroup instanceof h5wasm.Group)) {
        continue;
      }

      const channelId = requireStringAttribute(channelGroup, 'channelId');
      if (selectedSet && !selectedSet.has(channelId)) {
        continue;
      }
      const streamId = requireStringAttribute(channelGroup, 'streamId');
      const sampleFormat = readSampleFormatAttribute(channelGroup);
      const frameKind = readFrameKindAttribute(channelGroup);
      const units = readOptionalStringAttribute(channelGroup, 'units');
      const sampleRateHz = readOptionalNumberAttribute(channelGroup, 'sampleRateHz');
      const timestampsDataset = requireDataset(channelGroup, 'timestamps');
      const valuesDataset = requireDataset(channelGroup, 'values');
      const sampleCount = requireOneDimensionalLength(timestampsDataset);
      const valuesCount = requireOneDimensionalLength(valuesDataset);

      if (sampleCount !== valuesCount) {
        throw new Error(`В канале ${channelId} длины timestamps и values не совпадают`);
      }
      if (sampleCount === 0) {
        continue;
      }

      const firstTs = readTimestampBoundary(timestampsDataset, 0);
      const lastTs = readTimestampBoundary(timestampsDataset, sampleCount - 1);
      if (lastTs < firstTs) {
        throw new Error(`В канале ${channelId} last timestamp меньше first timestamp`);
      }

      globalStartMs = Math.min(globalStartMs, firstTs);
      globalEndMs = Math.max(globalEndMs, lastTs);
      if (selectedSet) {
        const missingIndex = missingChannelIds.indexOf(channelId);
        if (missingIndex >= 0) {
          missingChannelIds.splice(missingIndex, 1);
        }
      }

      channels.push({
        channelId,
        streamId,
        frameKind,
        sampleFormat,
        ...(sampleRateHz !== undefined ? { sampleRateHz } : {}),
        ...(units !== undefined ? { units } : {}),
        sampleCount,
        cursor: 0,
        timestampsDataset,
        valuesDataset,
        bufferStartIndex: 0,
        bufferEndIndex: 0,
        bufferedTimestamps: new Float64Array(0),
        bufferedValues: emptyValues(sampleFormat),
      });
    }

    if (selectedSet) {
      const order = new Map(selectedChannelIds.map((channelId, index) => [channelId, index]));
      channels.sort((left, right) => (order.get(left.channelId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.channelId) ?? Number.MAX_SAFE_INTEGER));
    }

    if (channels.length === 0) {
      if (selectedSet) {
        throw new Error(`В файле ${filePath} не найден ни один из выбранных каналов: ${selectedChannelIds.join(', ')}`);
      }
      throw new Error(`В файле ${filePath} не найдено ни одного непустого канала`);
    }

    return {
      file,
      filePath,
      channels,
      missingChannelIds,
      dataStartMs: globalStartMs,
      dataEndMs: globalEndMs,
      currentWindowStartMs: globalStartMs,
      cycleIndex: 0,
    };
  } catch (error) {
    file.close();
    throw error;
  }
}

function closeSession(): void {
  if (!session) return;
  session.file.close();
  session = null;
}

async function pauseSimulation(ctx: PluginContext, payload: SimulationPauseRequestPayload): Promise<void> {
  if (runtimeState !== 'connected') {
    await emitSimulationSnapshot(ctx, `Нельзя выполнить pause из состояния ${runtimeState}`, payload.requestId);
    return;
  }
  stopTimer(ctx);
  await emitRuntimeState(ctx, 'paused', undefined, payload.requestId);
}

async function resumeSimulation(ctx: PluginContext, payload: SimulationResumeRequestPayload): Promise<void> {
  if (runtimeState !== 'paused') {
    await emitSimulationSnapshot(ctx, `Нельзя выполнить resume из состояния ${runtimeState}`, payload.requestId);
    return;
  }
  startTimer(ctx);
  await emitRuntimeState(ctx, 'connected', undefined, payload.requestId);
}

async function setSimulationSpeed(ctx: PluginContext, payload: SimulationSpeedSetRequestPayload): Promise<void> {
  if (!isAllowedSimulationSpeed(payload.speed)) {
    await emitSimulationSnapshot(ctx, `Недопустимая скорость ${payload.speed}`, payload.requestId);
    return;
  }

  config.speed = payload.speed;
  if (runtimeState === 'connected') {
    startTimer(ctx);
  }
  await emitSimulationSnapshot(ctx, undefined, payload.requestId);
}

async function connectSimulation(ctx: PluginContext, payload: AdapterConnectRequestPayload): Promise<void> {
  if (!session) {
    await emitRuntimeState(ctx, 'failed', 'Файл симуляции не загружен', payload.requestId);
    return;
  }
  if (runtimeState === 'connected' || runtimeState === 'paused' || runtimeState === 'connecting' || runtimeState === 'disconnecting') {
    return;
  }

  await emitRuntimeState(ctx, 'connecting', undefined, payload.requestId);
  resetSessionCursor(session);
  startTimer(ctx);
  await emitRuntimeState(ctx, 'connected', undefined, payload.requestId);
}

async function disconnectSimulation(ctx: PluginContext, payload: AdapterDisconnectRequestPayload): Promise<void> {
  if (runtimeState !== 'connected' && runtimeState !== 'paused') {
    return;
  }

  await emitRuntimeState(ctx, 'disconnecting', undefined, payload.requestId);
  stopTimer(ctx);
  if (session) {
    resetSessionCursor(session);
  }
  await emitRuntimeState(ctx, 'disconnected', undefined, payload.requestId);
}

async function emitSimulationTick(ctx: PluginContext): Promise<void> {
  if (runtimeState !== 'connected' || !session) return;

  const windowEndMs = session.currentWindowStartMs + config.batchMs;
  for (const channel of session.channels) {
    const event = readWindowForChannel(channel, windowEndMs);
    if (!event) continue;
    await ctx.emit(event);
  }

  session.currentWindowStartMs = windowEndMs;
  session.cycleIndex += 1;

  const finished = session.channels.every((channel) => channel.cursor >= channel.sampleCount);
  if (finished && session.currentWindowStartMs >= session.dataEndMs) {
    stopTimer(ctx);
    await emitRuntimeState(ctx, 'disconnected', 'Симуляция завершена');
  }
}

export default definePlugin({
  manifest: {
    id: 'hdf5-simulation-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.adapterConnectRequest, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, kind: 'command', priority: 'control' },
      { type: EventTypes.simulationPauseRequest, kind: 'command', priority: 'control' },
      { type: EventTypes.simulationResumeRequest, kind: 'command', priority: 'control' },
      { type: EventTypes.simulationSpeedSetRequest, kind: 'command', priority: 'control' },
      { type: SimulationTickType, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
    emits: [
      EventTypes.adapterStateChanged,
      EventTypes.simulationStateChanged,
      'signal.batch',
    ],
  },
  async onInit(ctx) {
    await h5wasm.ready;
    config = resolveConfig(ctx.getConfig<Hdf5SimulationAdapterConfig>());
    session = loadSession(config.filePath, config.channelIds);
    runtimeState = 'disconnected';
    const missingMessage = session.missingChannelIds.length > 0
      ? `Часть каналов не найдена в файле: ${session.missingChannelIds.join(', ')}`
      : undefined;
    await emitRuntimeState(ctx, 'disconnected', missingMessage);
  },
  async onEvent(event: RuntimeEvent, ctx) {
    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = (event as CommandEvent<AdapterConnectRequestPayload>).payload;
      if (payload.adapterId !== config.adapterId) return;
      await connectSimulation(ctx, payload);
      return;
    }

    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = (event as CommandEvent<AdapterDisconnectRequestPayload>).payload;
      if (payload.adapterId !== config.adapterId) return;
      await disconnectSimulation(ctx, payload);
      return;
    }

    if (event.type === EventTypes.simulationPauseRequest) {
      const payload = (event as CommandEvent<SimulationPauseRequestPayload>).payload;
      if (payload.adapterId !== config.adapterId) return;
      await pauseSimulation(ctx, payload);
      return;
    }

    if (event.type === EventTypes.simulationResumeRequest) {
      const payload = (event as CommandEvent<SimulationResumeRequestPayload>).payload;
      if (payload.adapterId !== config.adapterId) return;
      await resumeSimulation(ctx, payload);
      return;
    }

    if (event.type === EventTypes.simulationSpeedSetRequest) {
      const payload = (event as CommandEvent<SimulationSpeedSetRequestPayload>).payload;
      if (payload.adapterId !== config.adapterId) return;
      await setSimulationSpeed(ctx, payload);
      return;
    }

    if (event.type === SimulationTickType) {
      await emitSimulationTick(ctx);
    }
  },
  async onShutdown(ctx) {
    stopTimer(ctx);
    closeSession();
    runtimeState = 'disconnected';
  },
});
