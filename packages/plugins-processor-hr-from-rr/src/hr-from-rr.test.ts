import { describe, expect, it } from 'vitest';
import { createHrFromRrEstimator } from './hr-from-rr.ts';

describe('createHrFromRrEstimator', () => {
  it('возвращает null для невалидных RR и считает HR для валидных', () => {
    const estimator = createHrFromRrEstimator({
      minRrSeconds: 0.3,
      maxRrSeconds: 2,
      medianWindowSize: 1,
      emaAlpha: 1,
    });

    expect(estimator.push(Number.NaN)).toBeNull();
    expect(estimator.push(0.2)).toBeNull();
    expect(estimator.push(2.5)).toBeNull();
    expect(estimator.push(1.0)).toBeCloseTo(60, 5);
    expect(estimator.push(0.5)).toBeCloseTo(120, 5);
  });

  it('сглаживает RR через median + EMA', () => {
    const estimator = createHrFromRrEstimator({
      minRrSeconds: 0.3,
      maxRrSeconds: 2,
      medianWindowSize: 3,
      emaAlpha: 0.5,
    });

    expect(estimator.push(1.0)).toBeCloseTo(60, 5);
    expect(estimator.push(1.0)).toBeCloseTo(60, 5);
    expect(estimator.push(0.3)).toBeCloseTo(60, 5);
    expect(estimator.push(0.5)).toBeCloseTo(80, 5);
  });

  it('сбрасывает внутреннее состояние', () => {
    const estimator = createHrFromRrEstimator({
      minRrSeconds: 0.3,
      maxRrSeconds: 2,
      medianWindowSize: 3,
      emaAlpha: 0.5,
    });

    estimator.push(1.0);
    estimator.push(0.5);
    estimator.reset();

    expect(estimator.push(0.5)).toBeCloseTo(120, 5);
  });
});
