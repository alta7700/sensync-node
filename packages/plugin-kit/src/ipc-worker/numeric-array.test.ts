import { describe, expect, it } from 'vitest';
import { decodeNumericArray, encodeNumericArray, sampleFormatFromTypedArray } from './numeric-array.ts';

describe('ipc-worker numeric-array', () => {
  it('определяет sampleFormat по typed array', () => {
    expect(sampleFormatFromTypedArray(new Float32Array())).toBe('f32');
    expect(sampleFormatFromTypedArray(new Float64Array())).toBe('f64');
    expect(sampleFormatFromTypedArray(new Int16Array())).toBe('i16');
  });

  it('сохраняет точные байты typed array через protobuf payload', () => {
    const values = new Float64Array([1.5, 2.5, 3.5]);
    const decoded = decodeNumericArray(encodeNumericArray(values));

    expect(decoded).toBeInstanceOf(Float64Array);
    expect(Array.from(decoded)).toEqual([1.5, 2.5, 3.5]);
  });
});
