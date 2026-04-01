import type { DecodedUiSignalFrame, UiStreamDeclaration } from '@sensync2/core';
import type { StreamBufferStore, StreamWindowData, StreamWindowOptions } from './types.ts';

interface StreamRing {
  capacity: number;
  time: Float64Array;
  value: Float32Array;
  writeIndex: number;
  size: number;
}

function createRing(capacity: number): StreamRing {
  return {
    capacity,
    time: new Float64Array(capacity),
    value: new Float32Array(capacity),
    writeIndex: 0,
    size: 0,
  };
}

function latestTimeOfRing(ring: StreamRing): number | null {
  if (ring.size === 0) return null;
  const latestIdx = (ring.writeIndex - 1 + ring.capacity) % ring.capacity;
  return ring.time[latestIdx] ?? null;
}

export class TypedArrayRingBufferStore implements StreamBufferStore {
  private rings = new Map<string, StreamRing>();
  private defaultCapacity: number;

  // Увеличиваем дефолтный размер кольцевого буфера для более длинных окон/меньших перезаписей.
  constructor(defaultCapacity = 240_000) {
    this.defaultCapacity = defaultCapacity;
  }

  ensureStream(stream: UiStreamDeclaration): void {
    if (this.rings.has(stream.streamId)) return;
    this.rings.set(stream.streamId, createRing(this.defaultCapacity));
  }

  appendFrame(stream: UiStreamDeclaration, frame: DecodedUiSignalFrame): void {
    this.ensureStream(stream);
    const ring = this.rings.get(stream.streamId)!;
    const timestampsMs = frame.timestampsMs;

    for (let i = 0; i < frame.sampleCount; i += 1) {
      const idx = ring.writeIndex;
      // Для irregular потока доверяем явным timestamps, а не реконструируем время из `t0 + dt`.
      ring.time[idx] = timestampsMs ? timestampsMs[i]! : (frame.t0Ms + frame.dtMs * i);
      ring.value[idx] = Number(frame.values[i]);

      ring.writeIndex = (ring.writeIndex + 1) % ring.capacity;
      ring.size = Math.min(ring.size + 1, ring.capacity);
    }
  }

  getVisibleWindow(streamId: string, rangeMs: number, endMs?: number, options?: StreamWindowOptions): StreamWindowData {
    const ring = this.rings.get(streamId);
    if (!ring || ring.size === 0) {
      return { x: new Float64Array(0), y: new Float32Array(0), length: 0 };
    }

    const latestTime = latestTimeOfRing(ring);
    if (latestTime === null) {
      return { x: new Float64Array(0), y: new Float32Array(0), length: 0 };
    }
    const windowEndMs = endMs ?? latestTime;
    const threshold = windowEndMs - rangeMs;
    const includeLastSampleBeforeStart = options?.includeLastSampleBeforeStart === true;

    let lastIdxBeforeThreshold: number | null = null;
    if (includeLastSampleBeforeStart) {
      for (let i = 0; i < ring.size; i += 1) {
        const idx = (ring.writeIndex - ring.size + i + ring.capacity) % ring.capacity;
        if (ring.time[idx]! < threshold) {
          lastIdxBeforeThreshold = idx;
          continue;
        }
        break;
      }
    }

    // Сначала считаем размер окна, затем выделяем итоговые массивы.
    let count = lastIdxBeforeThreshold === null ? 0 : 1;
    for (let i = 0; i < ring.size; i += 1) {
      const idx = (ring.writeIndex - ring.size + i + ring.capacity) % ring.capacity;
      if (ring.time[idx]! >= threshold) count += 1;
    }

    const x = new Float64Array(count);
    const y = new Float32Array(count);
    let out = 0;
    if (lastIdxBeforeThreshold !== null) {
      x[out] = ring.time[lastIdxBeforeThreshold]!;
      y[out] = ring.value[lastIdxBeforeThreshold]!;
      out += 1;
    }
    for (let i = 0; i < ring.size; i += 1) {
      const idx = (ring.writeIndex - ring.size + i + ring.capacity) % ring.capacity;
      const t = ring.time[idx]!;
      if (t < threshold) continue;
      x[out] = t;
      y[out] = ring.value[idx]!;
      out += 1;
    }

    return { x, y, length: out };
  }

  getLatestTime(streamId: string): number | null {
    const ring = this.rings.get(streamId);
    if (!ring) return null;
    return latestTimeOfRing(ring);
  }

  clear(): void {
    this.rings.clear();
  }
}
