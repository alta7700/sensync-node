import { describe, expect, it } from 'vitest';
import type { UiStreamDeclaration } from '@sensync2/core';
import { TypedArrayRingBufferStore } from './ring-buffer-store.ts';

describe('TypedArrayRingBufferStore', () => {
  it('может возвращать последнюю точку до начала окна для ступенчатых графиков', () => {
    const store = new TypedArrayRingBufferStore(16);
    const stream: UiStreamDeclaration = {
      streamId: 'power.label',
      numericId: 1,
      label: 'Power',
      sampleFormat: 'f32',
      frameKind: 'label-batch',
      units: 'W',
    };

    store.ensureStream(stream);
    store.appendFrame(stream, {
      version: 1,
      frameType: 1,
      streamNumericId: 1,
      seq: 1n,
      sampleFormat: 'f32',
      t0Ms: 10_000,
      dtMs: 0,
      sampleCount: 1,
      values: new Float32Array([150]),
      timestampsMs: new Float64Array([10_000]),
    });
    store.appendFrame(stream, {
      version: 1,
      frameType: 1,
      streamNumericId: 1,
      seq: 2n,
      sampleFormat: 'f32',
      t0Ms: 30_000,
      dtMs: 0,
      sampleCount: 1,
      values: new Float32Array([180]),
      timestampsMs: new Float64Array([30_000]),
    });

    const window = store.getVisibleWindow('power.label', 5_000, 30_000, {
      includeLastSampleBeforeStart: true,
    });

    expect(Array.from(window.x)).toEqual([10_000, 30_000]);
    expect(Array.from(window.y)).toEqual([150, 180]);
  });

  it('возвращает несколько последних значений потока в обратном хронологическом порядке', () => {
    const store = new TypedArrayRingBufferStore(16);
    const stream: UiStreamDeclaration = {
      streamId: 'lactate.label',
      numericId: 2,
      label: 'Lactate',
      sampleFormat: 'f32',
      frameKind: 'label-batch',
      units: 'mmol/L',
    };

    store.ensureStream(stream);
    store.appendFrame(stream, {
      version: 1,
      frameType: 1,
      streamNumericId: 2,
      seq: 1n,
      sampleFormat: 'f32',
      t0Ms: 10_000,
      dtMs: 0,
      sampleCount: 1,
      values: new Float32Array([1.2]),
      timestampsMs: new Float64Array([10_000]),
    });
    store.appendFrame(stream, {
      version: 1,
      frameType: 1,
      streamNumericId: 2,
      seq: 2n,
      sampleFormat: 'f32',
      t0Ms: 20_000,
      dtMs: 0,
      sampleCount: 1,
      values: new Float32Array([1.5]),
      timestampsMs: new Float64Array([20_000]),
    });

    expect(store.getLatestValues('lactate.label', 2)[0]).toBeCloseTo(1.5, 5);
    expect(store.getLatestValues('lactate.label', 2)[1]).toBeCloseTo(1.2, 5);
    expect(store.getLatestValues('lactate.label', 1)).toEqual([1.5]);
    const entries = store.getLatestEntries('lactate.label', 2);
    expect(entries[0]).toMatchObject({ timeMs: 20_000 });
    expect(entries[0]!.value).toBeCloseTo(1.5, 5);
    expect(entries[1]).toMatchObject({ timeMs: 10_000 });
    expect(entries[1]!.value).toBeCloseTo(1.2, 5);
  });
});
