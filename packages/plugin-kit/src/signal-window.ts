import type { RuntimeEventOf, SignalBatchPayload } from '@sensync2/core';
import type {
  SignalInputDescriptor,
  SignalWindowSlice,
  SignalWindowStore,
} from './types.ts';

type SignalEvent = RuntimeEventOf<'signal.batch', 1>;
type SignalPayload = SignalEvent['payload'];

interface StoredBatch {
  payload: SignalPayload;
}

function createClonedPayload(
  payload: SignalPayload,
  values: SignalPayload['values'],
  overrides: Partial<SignalBatchPayload>,
): SignalPayload {
  const cloned: SignalBatchPayload = {
    streamId: payload.streamId,
    sampleFormat: payload.sampleFormat,
    frameKind: payload.frameKind,
    t0Ms: payload.t0Ms,
    sampleCount: payload.sampleCount,
    values,
  };

  if (payload.dtMs !== undefined) {
    cloned.dtMs = payload.dtMs;
  }
  if (payload.sampleRateHz !== undefined) {
    cloned.sampleRateHz = payload.sampleRateHz;
  }
  if (payload.timestampsMs !== undefined) {
    cloned.timestampsMs = payload.timestampsMs;
  }
  if (payload.flags !== undefined) {
    cloned.flags = payload.flags;
  }
  if (payload.units !== undefined) {
    cloned.units = payload.units;
  }

  Object.assign(cloned, overrides);
  return cloned;
}

function cloneValues(values: SignalPayload['values'], start = 0, end = values.length): SignalPayload['values'] {
  return values.slice(start, end);
}

function cloneTimestamps(timestampsMs: Float64Array | undefined, start = 0, end = timestampsMs?.length ?? 0): Float64Array | undefined {
  return timestampsMs?.slice(start, end);
}

function sampleTimeAt(payload: SignalPayload, sampleIndex: number): number {
  if (payload.frameKind === 'uniform-signal-batch') {
    if (payload.dtMs === undefined) {
      throw new Error(`uniform-signal-batch ${payload.streamId} должен содержать dtMs`);
    }
    return payload.t0Ms + (payload.dtMs * sampleIndex);
  }
  return payload.timestampsMs?.[sampleIndex] ?? payload.t0Ms;
}

function payloadT1Ms(payload: SignalPayload): number {
  if (payload.sampleCount === 0) {
    return payload.t0Ms;
  }
  return sampleTimeAt(payload, payload.sampleCount - 1);
}

function normalizeEvent(event: SignalEvent): SignalPayload {
  const { payload } = event;
  if (payload.sampleCount !== payload.values.length) {
    throw new Error(`sampleCount не совпадает с длиной values для ${payload.streamId}`);
  }
  if (payload.frameKind === 'uniform-signal-batch') {
    const clonedPayload = createClonedPayload(
      payload,
      cloneValues(payload.values),
      {},
    );
    if (payload.dtMs === undefined) {
      throw new Error(`uniform-signal-batch ${payload.streamId} должен содержать dtMs`);
    }
    if (payload.timestampsMs) {
      clonedPayload.timestampsMs = payload.timestampsMs.slice();
    }
    if (payload.flags) {
      clonedPayload.flags = payload.flags.slice();
    }
    return clonedPayload;
  }
  if (!payload.timestampsMs || payload.timestampsMs.length !== payload.sampleCount) {
    throw new Error(`${payload.frameKind} ${payload.streamId} должен содержать timestampsMs длины sampleCount`);
  }
  const clonedPayload = createClonedPayload(
    payload,
    cloneValues(payload.values),
    {},
  );
  clonedPayload.timestampsMs = payload.timestampsMs.slice();
  if (payload.flags) {
    clonedPayload.flags = payload.flags.slice();
  }
  return clonedPayload;
}

function slicePayload(payload: SignalPayload, startIndex: number, endIndex = payload.sampleCount): SignalPayload {
  const sampleCount = Math.max(0, endIndex - startIndex);
  const values = cloneValues(payload.values, startIndex, endIndex);
  if (payload.frameKind === 'uniform-signal-batch') {
    const slicedPayload = createClonedPayload(
      payload,
      values,
      {
        sampleCount,
        t0Ms: sampleCount === 0 ? payload.t0Ms : sampleTimeAt(payload, startIndex),
      },
    );
    if (payload.timestampsMs) {
      slicedPayload.timestampsMs = payload.timestampsMs.slice(startIndex, endIndex);
    } else {
      delete slicedPayload.timestampsMs;
    }
    if (payload.flags) {
      slicedPayload.flags = payload.flags.slice(startIndex, endIndex);
    } else {
      delete slicedPayload.flags;
    }
    return slicedPayload;
  }
  const timestampsMs = cloneTimestamps(payload.timestampsMs, startIndex, endIndex) ?? new Float64Array();
  const slicedPayload = createClonedPayload(
    payload,
    values,
    {
      sampleCount,
      t0Ms: timestampsMs[0] ?? payload.t0Ms,
      timestampsMs,
    },
  );
  if (payload.flags) {
    slicedPayload.flags = payload.flags.slice(startIndex, endIndex);
  } else {
    delete slicedPayload.flags;
  }
  return slicedPayload;
}

function findFirstIndexAtOrAfter(payload: SignalPayload, cutoffMs: number): number {
  if (payload.frameKind === 'uniform-signal-batch') {
    if (payload.dtMs === undefined || payload.dtMs <= 0) {
      return 0;
    }
    const relativeIndex = Math.ceil((cutoffMs - payload.t0Ms) / payload.dtMs);
    return Math.max(0, Math.min(payload.sampleCount, relativeIndex));
  }
  const timestampsMs = payload.timestampsMs ?? new Float64Array();
  for (let index = 0; index < timestampsMs.length; index += 1) {
    if (timestampsMs[index]! >= cutoffMs) {
      return index;
    }
  }
  return payload.sampleCount;
}

function createSlice(batches: StoredBatch[], ranges: Array<{ batchIndex: number; startIndex: number; endIndex: number }>): SignalWindowSlice | null {
  if (ranges.length === 0) return null;
  const firstPayload = batches[ranges[0]!.batchIndex]!.payload;
  const totalSampleCount = ranges.reduce((sum, range) => sum + (range.endIndex - range.startIndex), 0);
  if (totalSampleCount <= 0) return null;

  const values = cloneValues(firstPayload.values, 0, 0);
  const outputValues = new (values.constructor as typeof Float32Array)(totalSampleCount) as SignalPayload['values'];
  const needsTimestamps = firstPayload.frameKind !== 'uniform-signal-batch';
  const outputTimestamps = needsTimestamps ? new Float64Array(totalSampleCount) : undefined;

  let offset = 0;
  for (const range of ranges) {
    const payload = batches[range.batchIndex]!.payload;
    const slice = slicePayload(payload, range.startIndex, range.endIndex);
    outputValues.set(slice.values, offset);
    if (outputTimestamps && slice.timestampsMs) {
      outputTimestamps.set(slice.timestampsMs, offset);
    }
    offset += slice.sampleCount;
  }

  const firstRange = ranges[0]!;
  const lastRange = ranges[ranges.length - 1]!;
  const firstRangePayload = batches[firstRange.batchIndex]!.payload;
  const lastRangePayload = batches[lastRange.batchIndex]!.payload;

  return {
    streamId: firstPayload.streamId,
    frameKind: firstPayload.frameKind,
    sampleFormat: firstPayload.sampleFormat,
    sampleCount: totalSampleCount,
    values: outputValues,
    t0Ms: sampleTimeAt(firstRangePayload, firstRange.startIndex),
    t1Ms: sampleTimeAt(lastRangePayload, lastRange.endIndex - 1),
    ...(outputTimestamps ? { timestampsMs: outputTimestamps } : {}),
    ...(firstPayload.units !== undefined ? { units: firstPayload.units } : {}),
  };
}

export function createSignalWindowStore(
  descriptor: SignalInputDescriptor,
): SignalWindowStore {
  const batches: StoredBatch[] = [];
  let latestEvent: SignalEvent | null = null;
  let retainedSampleCount = 0;
  let streamFrameKind: SignalPayload['frameKind'] | null = null;
  let streamSampleFormat: SignalPayload['sampleFormat'] | null = null;

  function clear(): void {
    batches.length = 0;
    latestEvent = null;
    retainedSampleCount = 0;
    streamFrameKind = null;
    streamSampleFormat = null;
  }

  function trimBySamples(limit: number): void {
    while (retainedSampleCount > limit && batches.length > 0) {
      const overflow = retainedSampleCount - limit;
      const first = batches[0]!.payload;
      if (overflow >= first.sampleCount) {
        retainedSampleCount -= first.sampleCount;
        batches.shift();
        continue;
      }
      batches[0] = { payload: slicePayload(first, overflow) };
      retainedSampleCount -= overflow;
      break;
    }
  }

  function trimByDuration(limitMs: number): void {
    const lastPayload = batches[batches.length - 1]?.payload;
    if (!lastPayload) return;
    const cutoffMs = payloadT1Ms(lastPayload) - limitMs;
    while (batches.length > 0) {
      const first = batches[0]!.payload;
      const firstT1Ms = payloadT1Ms(first);
      if (firstT1Ms < cutoffMs) {
        retainedSampleCount -= first.sampleCount;
        batches.shift();
        continue;
      }
      if (sampleTimeAt(first, 0) >= cutoffMs) {
        break;
      }
      const startIndex = findFirstIndexAtOrAfter(first, cutoffMs);
      if (startIndex >= first.sampleCount) {
        retainedSampleCount -= first.sampleCount;
        batches.shift();
        continue;
      }
      batches[0] = { payload: slicePayload(first, startIndex) };
      retainedSampleCount -= startIndex;
      break;
    }
  }

  function trim(): void {
    if (descriptor.retain.by === 'samples') {
      trimBySamples(descriptor.retain.value);
      return;
    }
    trimByDuration(descriptor.retain.value);
  }

  function ensureCompatible(payload: SignalPayload): void {
    if (streamFrameKind !== null && streamFrameKind !== payload.frameKind) {
      throw new Error(`streamId "${payload.streamId}" сменил frameKind с ${streamFrameKind} на ${payload.frameKind}`);
    }
    if (streamSampleFormat !== null && streamSampleFormat !== payload.sampleFormat) {
      throw new Error(`streamId "${payload.streamId}" сменил sampleFormat с ${streamSampleFormat} на ${payload.sampleFormat}`);
    }
  }

  function latestSamples(count: number): SignalWindowSlice | null {
    if (!(count > 0) || retainedSampleCount === 0) return null;
    let remaining = Math.min(count, retainedSampleCount);
    const ranges: Array<{ batchIndex: number; startIndex: number; endIndex: number }> = [];

    for (let batchIndex = batches.length - 1; batchIndex >= 0 && remaining > 0; batchIndex -= 1) {
      const payload = batches[batchIndex]!.payload;
      const take = Math.min(remaining, payload.sampleCount);
      ranges.unshift({
        batchIndex,
        startIndex: payload.sampleCount - take,
        endIndex: payload.sampleCount,
      });
      remaining -= take;
    }

    return createSlice(batches, ranges);
  }

  function windowMs(durationMs: number): SignalWindowSlice | null {
    if (!(durationMs >= 0) || retainedSampleCount === 0) return null;
    const lastPayload = batches[batches.length - 1]!.payload;
    const cutoffMs = payloadT1Ms(lastPayload) - durationMs;
    const ranges: Array<{ batchIndex: number; startIndex: number; endIndex: number }> = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const payload = batches[batchIndex]!.payload;
      if (payloadT1Ms(payload) < cutoffMs) {
        continue;
      }
      const startIndex = Math.max(0, findFirstIndexAtOrAfter(payload, cutoffMs));
      if (startIndex >= payload.sampleCount) continue;
      ranges.push({
        batchIndex,
        startIndex,
        endIndex: payload.sampleCount,
      });
    }

    return createSlice(batches, ranges);
  }

  return {
    descriptor() {
      return descriptor;
    },
    push(event) {
      if (event.payload.streamId !== descriptor.streamId) {
        return false;
      }

      const normalizedPayload = normalizeEvent(event);
      ensureCompatible(normalizedPayload);
      streamFrameKind = normalizedPayload.frameKind;
      streamSampleFormat = normalizedPayload.sampleFormat;
      latestEvent = event;
      batches.push({ payload: normalizedPayload });
      retainedSampleCount += normalizedPayload.sampleCount;
      trim();
      return true;
    },
    clear,
    sampleCount() {
      return retainedSampleCount;
    },
    latestBatch() {
      return latestEvent;
    },
    latestSamples,
    windowMs,
  };
}
