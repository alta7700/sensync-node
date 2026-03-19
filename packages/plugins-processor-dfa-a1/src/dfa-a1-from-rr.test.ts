import { describe, expect, it } from 'vitest';
import { createDfaA1Scheduler } from './dfa-a1-from-rr.ts';

describe('createDfaA1Scheduler', () => {
  it('по умолчанию работает на time-based окне и шаге пересчёта', () => {
    const scheduler = createDfaA1Scheduler({
      rrUnit: 's',
      minRrCount: 5,
      windowDurationMs: 10_000,
      recomputeEveryMs: 2_000,
      lowerScale: 4,
      upperScale: 16,
    });

    expect(scheduler.push(0.9, 100)).toBeNull();
    expect(scheduler.push(0.9, 200)).toBeNull();
    expect(scheduler.push(0.9, 300)).toBeNull();
    expect(scheduler.push(0.9, 400)).toBeNull();
    const snapshot = scheduler.push(0.9, 500);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.timestampMs).toBe(500);
    expect(snapshot?.rrIntervalsMs.length).toBe(5);

    expect(scheduler.push(0.9, 1_000)).toBeNull();
    expect(scheduler.push(0.9, 2_499)).toBeNull();
    const nextSnapshot = scheduler.push(0.9, 2_500);
    expect(nextSnapshot).not.toBeNull();
    expect(nextSnapshot?.timestampMs).toBe(2_500);
  });

  it('держит только RR внутри windowDurationMs', () => {
    const scheduler = createDfaA1Scheduler({
      rrUnit: 'ms',
      minRrCount: 3,
      windowDurationMs: 1_500,
      recomputeEveryMs: 1,
    });

    scheduler.push(800, 100);
    scheduler.push(810, 200);
    scheduler.push(820, 300);
    scheduler.push(825, 700);
    scheduler.push(830, 1_000);
    const snapshot = scheduler.push(840, 2_000);

    expect(Array.from(snapshot?.rrIntervalsMs ?? [])).toEqual([825, 830, 840]);
    expect(snapshot?.timestampMs).toBe(2_000);
  });

  it('умеет работать в count-based режиме как явный override', () => {
    const scheduler = createDfaA1Scheduler({
      rrUnit: 'ms',
      windowCount: 3,
      windowDurationMs: null,
      minRrCount: 3,
      recomputeEvery: 1,
      recomputeEveryMs: null,
    });

    scheduler.push(800, 100);
    scheduler.push(810, 200);
    scheduler.push(820, 300);
    const snapshot = scheduler.push(830, 2_000);

    expect(Array.from(snapshot?.rrIntervalsMs ?? [])).toEqual([810, 820, 830]);
    expect(snapshot?.timestampMs).toBe(2_000);
  });
});
