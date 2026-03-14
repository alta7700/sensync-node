import { describe, expect, it } from 'vitest';
import {
  buildFakeRtoRDataPacket,
  buildRToRTransmissionStateCommand,
  createInitialZephyrRrExtractionState,
  extractZephyrRrSamples,
  parseZephyrPacket,
} from './zephyr-protocol.ts';

describe('zephyr-protocol', () => {
  it('разбирает fake R-to-R packet', () => {
    const packet = buildFakeRtoRDataPacket(7, [812, 808]);
    const parsed = parseZephyrPacket(packet);

    expect(parsed).toMatchObject({
      kind: 'r-to-r-data',
      seqNumber: 7,
      rr: [812, 808],
    });
  });

  it('строит команду включения R-to-R передачи', () => {
    const command = buildRToRTransmissionStateCommand(true);

    expect(command).toBeInstanceOf(Buffer);
    expect(command[0]).toBe(0x02);
    expect(command[1]).toBe(0x19);
    expect(command[2]).toBe(1);
    expect(command.at(-1)).toBe(0x03);
  });

  it('выделяет RR-интервалы из Zephyr-последовательности со сменой знака', () => {
    const extraction = extractZephyrRrSamples(
      [800, -790, -790, 810],
      0,
      createInitialZephyrRrExtractionState(10_000),
      10_000,
    );

    expect(extraction.sequenceGap).toBeNull();
    expect(extraction.samples).toEqual([
      { timestampMs: 10_800, intervalMs: 800 },
      { timestampMs: 11_590, intervalMs: 790 },
      { timestampMs: 12_400, intervalMs: 810 },
    ]);
  });
});
