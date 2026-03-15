export interface HrFromRrEstimatorConfig {
  minRrSeconds?: number;
  maxRrSeconds?: number;
  medianWindowSize?: number;
  emaAlpha?: number;
}

export interface HrFromRrEstimator {
  push(rrSeconds: number): number | null;
  reset(): void;
}

interface NormalizedHrFromRrEstimatorConfig {
  minRrSeconds: number;
  maxRrSeconds: number;
  medianWindowSize: number;
  emaAlpha: number;
}

function resolveEstimatorConfig(
  config: HrFromRrEstimatorConfig | undefined,
): NormalizedHrFromRrEstimatorConfig {
  const resolved: NormalizedHrFromRrEstimatorConfig = {
    minRrSeconds: config?.minRrSeconds ?? 0.3,
    maxRrSeconds: config?.maxRrSeconds ?? 2.0,
    medianWindowSize: Math.trunc(config?.medianWindowSize ?? 5),
    emaAlpha: config?.emaAlpha ?? 0.25,
  };

  if (!(resolved.minRrSeconds > 0)) {
    throw new Error('minRrSeconds должен быть > 0');
  }
  if (!(resolved.maxRrSeconds > resolved.minRrSeconds)) {
    throw new Error('maxRrSeconds должен быть больше minRrSeconds');
  }
  if (!(resolved.medianWindowSize > 0)) {
    throw new Error('medianWindowSize должен быть > 0');
  }
  if (!(resolved.emaAlpha > 0 && resolved.emaAlpha <= 1)) {
    throw new Error('emaAlpha должен быть в диапазоне (0, 1]');
  }

  return resolved;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function createHrFromRrEstimator(
  config?: HrFromRrEstimatorConfig,
): HrFromRrEstimator {
  const resolved = resolveEstimatorConfig(config);
  const window: number[] = [];
  let filteredRrSeconds: number | null = null;

  return {
    push(rrSeconds) {
      if (!Number.isFinite(rrSeconds)) {
        return null;
      }
      if (rrSeconds < resolved.minRrSeconds || rrSeconds > resolved.maxRrSeconds) {
        return null;
      }

      window.push(rrSeconds);
      if (window.length > resolved.medianWindowSize) {
        window.shift();
      }

      // Сначала давим одиночные выбросы медианой, потом сглаживаем коротким EMA.
      const medianRrSeconds = median(window);
      filteredRrSeconds = filteredRrSeconds === null
        ? medianRrSeconds
        : filteredRrSeconds + (resolved.emaAlpha * (medianRrSeconds - filteredRrSeconds));

      return 60 / filteredRrSeconds;
    },
    reset() {
      window.length = 0;
      filteredRrSeconds = null;
    },
  };
}
