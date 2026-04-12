import { describe, expect, it } from 'vitest';
import {
  buildFakeRtoRDataPacket,
  buildRToRTransmissionStateCommand,
  createInitialZephyrRrExtractionState,
  extractZephyrRrSamples,
  parseZephyrPacket,
  resetZephyrRrExtractionState,
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

  it('якорит первый RR-пакет после сброса базы к локальному времени прихода', () => {
    const extraction = extractZephyrRrSamples(
      [800, -790, -790, 810],
      17,
      resetZephyrRrExtractionState(),
      2_000,
      0,
    );

    expect(extraction.sequenceGap).toBeNull();
    expect(extraction.samples).toEqual([
      { timestampMs: 400, intervalMs: 800 },
      { timestampMs: 1_190, intervalMs: 790 },
      { timestampMs: 2_000, intervalMs: 810 },
    ]);
    expect(extraction.state.accumulatorMs).toBe(2_000);
    expect(extraction.state.lastPacketSeq).toBe(17);
  });

  it('отбрасывает RR-точки раньше старта timeline при первом пакете', () => {
    const extraction = extractZephyrRrSamples(
      [800, -790, -790, 810],
      3,
      resetZephyrRrExtractionState(),
      1_000,
      500,
    );

    expect(extraction.samples).toEqual([
      { timestampMs: 1_000, intervalMs: 810 },
    ]);
    expect(extraction.state.accumulatorMs).toBe(1_000);
  });

  it('на sequence gap инвалидирует базу и переякоривает текущий пакет', () => {
    const extraction = extractZephyrRrSamples(
      [800, -780],
      9,
      {
        accumulatorMs: 12_000,
        lastPacketSeq: 4,
        lastSign: false,
      },
      15_000,
      0,
    );

    expect(extraction.sequenceGap).toEqual({
      expectedSeqNumber: 5,
      receivedSeqNumber: 9,
    });
    expect(extraction.samples).toEqual([
      { timestampMs: 14_220, intervalMs: 800 },
      { timestampMs: 15_000, intervalMs: 780 },
    ]);
    expect(extraction.state.accumulatorMs).toBe(15_000);
    expect(extraction.state.lastPacketSeq).toBe(9);
  });
});
