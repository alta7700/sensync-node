import * as path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import h5wasm from 'h5wasm/node';
import {
  defineRuntimeEventInput,
  EventTypes,
  type FrameKind,
  type RuntimeEventInputOf,
  type SampleFormat,
} from '@sensync2/core';

export type SupportedValueArray = Float32Array | Float64Array | Int16Array;
export type H5File = InstanceType<typeof h5wasm.File>;
export type H5Group = InstanceType<typeof h5wasm.Group>;
export type H5Dataset = InstanceType<typeof h5wasm.Dataset>;

export interface Hdf5SimulationAdapterConfig {
  adapterId?: string;
  filePath?: string;
  allowConnectFilePathOverride?: boolean;
  streamIds?: string[];
  batchMs?: number;
  speed?: number;
  readChunkSamples?: number;
}

export interface ChannelReaderState {
  streamId: string;
  frameKind: FrameKind;
  sampleFormat: SampleFormat;
  sampleRateHz?: number;
  units?: string;
  sampleCount: number;
  cursor: number;
  readChunkSamples: number;
  timestampsDataset: H5Dataset;
  valuesDataset: H5Dataset;
  bufferStartIndex: number;
  bufferEndIndex: number;
  bufferedTimestamps: Float64Array;
  bufferedValues: SupportedValueArray;
}

export interface SimulationSessionState {
  file: H5File;
  filePath: string;
  channels: ChannelReaderState[];
  missingStreamIds: string[];
  dataStartMs: number;
  dataEndMs: number;
  currentWindowStartMs: number;
  cycleIndex: number;
}

export const AllowedSimulationSpeeds = [0.25, 0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8] as const;
export const DefaultHdf5SimulationConfig: Required<Hdf5SimulationAdapterConfig> = {
  adapterId: 'hdf5-simulation',
  filePath: '',
  allowConnectFilePathOverride: false,
  streamIds: [],
  batchMs: 50,
  speed: 1,
  readChunkSamples: 4096,
};

export function normalizeHdf5SimulationFilePath(rawFilePath: string): string {
  const nextFilePath = rawFilePath.trim();
  if (nextFilePath.length === 0) {
    throw new Error('Не задан filePath для hdf5-simulation-adapter');
  }
  return path.resolve(nextFilePath);
}

export function isAllowedSimulationSpeed(value: number): boolean {
  return AllowedSimulationSpeeds.includes(value as (typeof AllowedSimulationSpeeds)[number]);
}

export function resolveHdf5SimulationConfig(
  rawConfig: Hdf5SimulationAdapterConfig | undefined,
): Required<Hdf5SimulationAdapterConfig> {
  const next = { ...DefaultHdf5SimulationConfig, ...(rawConfig ?? {}) };
  next.adapterId = typeof next.adapterId === 'string' && next.adapterId.length > 0
    ? next.adapterId
    : DefaultHdf5SimulationConfig.adapterId;

  const rawFilePath = typeof next.filePath === 'string' ? next.filePath.trim() : '';
  if (rawFilePath.length === 0 && !next.allowConnectFilePathOverride) {
    throw new Error('Не задан filePath для hdf5-simulation-adapter');
  }
  next.filePath = rawFilePath.length > 0 ? normalizeHdf5SimulationFilePath(rawFilePath) : '';
  next.streamIds = Array.isArray(next.streamIds)
    ? [...new Set(next.streamIds.map((value) => String(value).trim()).filter((value) => value.length > 0))]
    : [];
  next.batchMs = Math.max(1, Math.trunc(next.batchMs));
  next.readChunkSamples = Math.max(1, Math.trunc(next.readChunkSamples));

  if (!isAllowedSimulationSpeed(next.speed)) {
    throw new Error(`speed=${next.speed} не входит в допустимый набор ${AllowedSimulationSpeeds.join(', ')}`);
  }

  return next;
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

  const endIndex = Math.min(channel.sampleCount, startIndex + channel.readChunkSamples);
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
    throw new Error(`В ${channel.streamId} длины timestamps и values не совпадают`);
  }

  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index]! < timestamps[index - 1]!) {
      throw new Error(`timestamps для ${channel.streamId} не монотонны внутри chunk`);
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

function buildSignalEvent(
  channel: ChannelReaderState,
  timestamps: Float64Array,
  values: SupportedValueArray,
): RuntimeEventInputOf<typeof EventTypes.signalBatch, 1> {
  const payload: RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>['payload'] = {
    streamId: channel.streamId,
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
    return defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload,
    });
  }

  payload.frameKind = channel.frameKind === 'uniform-signal-batch' ? 'irregular-signal-batch' : channel.frameKind;
  payload.dtMs = 0;
  payload.timestampsMs = timestamps;
  if (channel.sampleRateHz !== undefined) payload.sampleRateHz = channel.sampleRateHz;
  return defineRuntimeEventInput({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    payload,
  });
}

export function readSimulationWindowForChannel(
  channel: ChannelReaderState,
  windowEndMs: number,
): RuntimeEventInputOf<typeof EventTypes.signalBatch, 1> | null {
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

export function resetHdf5SimulationSessionCursor(activeSession: SimulationSessionState): void {
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

export function closeHdf5SimulationSession(activeSession: SimulationSessionState | null): void {
  if (!activeSession) return;
  activeSession.file.close();
}

export function loadHdf5SimulationSession(
  filePath: string,
  selectedStreamIds: readonly string[],
  readChunkSamples: number,
): SimulationSessionState {
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
  const selectedSet = selectedStreamIds.length > 0 ? new Set(selectedStreamIds) : null;
  const missingStreamIds = selectedSet ? [...selectedStreamIds] : [];
  let globalStartMs = Number.POSITIVE_INFINITY;
  let globalEndMs = Number.NEGATIVE_INFINITY;

  try {
    for (const channelKey of channelsRoot.keys()) {
      const channelGroup = channelsRoot.get(channelKey);
      if (!(channelGroup instanceof h5wasm.Group)) {
        continue;
      }

      const streamId = readOptionalStringAttribute(channelGroup, 'streamId')
        ?? channelKey;
      if (selectedSet && !selectedSet.has(streamId)) {
        continue;
      }
      const sampleFormat = readSampleFormatAttribute(channelGroup);
      const frameKind = readFrameKindAttribute(channelGroup);
      const units = readOptionalStringAttribute(channelGroup, 'units');
      const sampleRateHz = readOptionalNumberAttribute(channelGroup, 'sampleRateHz');
      const timestampsDataset = requireDataset(channelGroup, 'timestamps');
      const valuesDataset = requireDataset(channelGroup, 'values');
      const sampleCount = requireOneDimensionalLength(timestampsDataset);
      const valuesCount = requireOneDimensionalLength(valuesDataset);

      if (sampleCount !== valuesCount) {
        throw new Error(`В канале ${streamId} длины timestamps и values не совпадают`);
      }
      if (sampleCount === 0) {
        continue;
      }

      const firstTs = readTimestampBoundary(timestampsDataset, 0);
      const lastTs = readTimestampBoundary(timestampsDataset, sampleCount - 1);
      if (lastTs < firstTs) {
        throw new Error(`В канале ${streamId} last timestamp меньше first timestamp`);
      }

      globalStartMs = Math.min(globalStartMs, firstTs);
      globalEndMs = Math.max(globalEndMs, lastTs);
      if (selectedSet) {
        const missingIndex = missingStreamIds.indexOf(streamId);
        if (missingIndex >= 0) {
          missingStreamIds.splice(missingIndex, 1);
        }
      }

      channels.push({
        streamId,
        frameKind,
        sampleFormat,
        ...(sampleRateHz !== undefined ? { sampleRateHz } : {}),
        ...(units !== undefined ? { units } : {}),
        sampleCount,
        cursor: 0,
        readChunkSamples,
        timestampsDataset,
        valuesDataset,
        bufferStartIndex: 0,
        bufferEndIndex: 0,
        bufferedTimestamps: new Float64Array(0),
        bufferedValues: emptyValues(sampleFormat),
      });
    }

    if (selectedSet) {
      const order = new Map(selectedStreamIds.map((streamId, index) => [streamId, index]));
      channels.sort((left, right) => (order.get(left.streamId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.streamId) ?? Number.MAX_SAFE_INTEGER));
    }

    if (channels.length === 0) {
      if (selectedSet) {
        throw new Error(`В файле ${filePath} не найден ни один из выбранных потоков: ${selectedStreamIds.join(', ')}`);
      }
      throw new Error(`В файле ${filePath} не найдено ни одного непустого потока`);
    }

    return {
      file,
      filePath,
      channels,
      missingStreamIds,
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
