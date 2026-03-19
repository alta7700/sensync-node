import { describe, expect, it } from 'vitest';
import { createFrameDecoder, encodeFrame } from './framing.ts';

describe('ipc-worker framing', () => {
  it('собирает frame из нескольких чанков', () => {
    const decoder = createFrameDecoder();
    const frame = encodeFrame(Uint8Array.from([1, 2, 3, 4]));

    expect(decoder.push(frame.slice(0, 3))).toEqual([]);
    expect(decoder.push(frame.slice(3))).toEqual([Uint8Array.from([1, 2, 3, 4])]);
  });

  it('читает несколько frame подряд', () => {
    const decoder = createFrameDecoder();
    const combined = new Uint8Array([
      ...encodeFrame(Uint8Array.from([1])),
      ...encodeFrame(Uint8Array.from([2, 3])),
    ]);

    expect(decoder.push(combined)).toEqual([
      Uint8Array.from([1]),
      Uint8Array.from([2, 3]),
    ]);
  });
});
