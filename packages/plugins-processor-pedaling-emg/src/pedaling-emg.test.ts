import { describe, expect, it } from 'vitest';
import { createEmgSegmentBuffer, createPedalingPhaseEngine } from './pedaling-emg.ts';

function buildUniformSignalBatch(
  streamId: string,
  startMs: number,
  sampleRateHz: number,
  values: Float32Array,
) {
  return {
    streamId,
    sampleFormat: 'f32' as const,
    frameKind: 'uniform-signal-batch' as const,
    t0Ms: startMs,
    dtMs: 1000 / sampleRateHz,
    sampleRateHz,
    sampleCount: values.length,
    values,
  };
}

describe('pedaling-emg phase engine', () => {
  it('выбирает устойчивую ось и выделяет циклы по positive zero-crossing', () => {
    const engine = createPedalingPhaseEngine({
      minCyclePeriodMs: 500,
      maxCyclePeriodMs: 1_500,
      axisLockHoldMs: 1_000,
      activeWindowPhaseStart: 0.2,
      activeWindowPhaseEnd: 0.6,
      windowPrePaddingMs: 100,
      windowPostPaddingMs: 100,
    });

    const sampleRateHz = 100;
    const durationSeconds = 5;
    const x = new Float32Array(sampleRateHz * durationSeconds);
    const y = new Float32Array(sampleRateHz * durationSeconds);
    const z = new Float32Array(sampleRateHz * durationSeconds);

    for (let index = 0; index < x.length; index += 1) {
      const t = index / sampleRateHz;
      x[index] = Math.sin(2 * Math.PI * t);
      y[index] = Math.sin(2 * Math.PI * t * 0.27) * 0.05;
      z[index] = ((index % 5) - 2) * 0.01;
    }

    const completedCycles = [
      ...engine.pushGyro('y', buildUniformSignalBatch('gyro.y', 0, sampleRateHz, y)),
      ...engine.pushGyro('z', buildUniformSignalBatch('gyro.z', 0, sampleRateHz, z)),
      ...engine.pushGyro('x', buildUniformSignalBatch('gyro.x', 0, sampleRateHz, x)),
    ];

    expect(engine.currentAxis()).toBe('x');
    expect(engine.currentAxisConfidence()).toBeGreaterThan(0.4);
    expect(completedCycles.length).toBeGreaterThan(0);
    expect(completedCycles[0]?.periodMs).toBeGreaterThan(900);
    expect(completedCycles[0]?.periodMs).toBeLessThan(1_100);
    expect(completedCycles[0]?.phaseConfidence).toBeGreaterThan(0.4);
  });

  it('вырезает EMG-окно даже если активность пересекает границу цикла', () => {
    const buffer = createEmgSegmentBuffer({
      minCyclePeriodMs: 500,
      maxCyclePeriodMs: 1_500,
      axisLockHoldMs: 1_000,
      activeWindowPhaseStart: 0.8,
      activeWindowPhaseEnd: 0.15,
      windowPrePaddingMs: 50,
      windowPostPaddingMs: 50,
    });

    const sampleRateHz = 200;
    const values = new Float32Array(sampleRateHz * 4);
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.sin(index / 10);
    }
    buffer.push(buildUniformSignalBatch('emg', 0, sampleRateHz, values));

    const request = buffer.extract({
      cycleId: 1,
      axis: 'x',
      startMs: 1_000,
      midpointMs: 1_500,
      endMs: 2_000,
      nextAnchorMs: 3_000,
      periodMs: 1_000,
      nextPeriodMs: 1_000,
      phaseConfidence: 0.8,
    });

    expect(request).not.toBeNull();
    expect(request?.windowStartSessionMs).toBe(1_750);
    expect(request?.expectedActiveStartOffsetMs).toBe(50);
    expect(request?.expectedActiveEndOffsetMs).toBe(400);
    expect(request?.values.length).toBeGreaterThan(0);
  });

  it('не возвращает усечённое EMG-окно как валидный сегмент', () => {
    const buffer = createEmgSegmentBuffer({
      minCyclePeriodMs: 500,
      maxCyclePeriodMs: 1_500,
      axisLockHoldMs: 1_000,
      activeWindowPhaseStart: 0.2,
      activeWindowPhaseEnd: 0.6,
      windowPrePaddingMs: 50,
      windowPostPaddingMs: 50,
    });

    const sampleRateHz = 200;
    const values = new Float32Array(sampleRateHz);
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.sin(index / 10);
    }
    // Намеренно начинаем буфер поздно, чтобы у окна не хватало начала.
    buffer.push(buildUniformSignalBatch('emg', 1_250, sampleRateHz, values));

    const request = buffer.extract({
      cycleId: 1,
      axis: 'x',
      startMs: 1_000,
      midpointMs: 1_500,
      endMs: 2_000,
      nextAnchorMs: 3_000,
      periodMs: 1_000,
      nextPeriodMs: 1_000,
      phaseConfidence: 0.8,
    });

    expect(request).toBeNull();
  });
});
