import { describe, expect, it } from 'vitest';
import { createHrFromRrEstimator } from './hr-from-rr.ts';

describe('hr-from-rr estimator', () => {
  it('сглаживает RR через median + EMA', () => {
    const estimator = createHrFromRrEstimator({
      medianWindowSize: 3,
      emaAlpha: 0.5,
    });

    expect(estimator.push(1.0)).toBeCloseTo(60, 6);
    expect(estimator.push(1.0)).toBeCloseTo(60, 6);
    expect(estimator.push(0.8)).toBeCloseTo(60, 6);
    expect(estimator.push(0.8)).toBeCloseTo(66.666666, 5);
  });

  it('пропускает невалидные RR без повреждения состояния', () => {
    const estimator = createHrFromRrEstimator({
      medianWindowSize: 1,
      emaAlpha: 1,
      minRrSeconds: 0.3,
      maxRrSeconds: 2.0,
    });

    expect(estimator.push(1.0)).toBeCloseTo(60, 6);
    expect(estimator.push(0.2)).toBeNull();
    expect(estimator.push(0.75)).toBeCloseTo(80, 6);
  });
});
