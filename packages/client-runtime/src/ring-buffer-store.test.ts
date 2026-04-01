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
});
