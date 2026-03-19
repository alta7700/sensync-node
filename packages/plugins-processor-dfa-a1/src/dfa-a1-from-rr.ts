export interface DfaA1SchedulerConfig {
  rrUnit?: 's' | 'ms';
  minRrCount?: number;
  windowCount?: number | null;
  windowDurationMs?: number | null;
  recomputeEvery?: number | null;
  recomputeEveryMs?: number | null;
  lowerScale?: number;
  upperScale?: number;
}

export interface DfaA1ComputationSnapshot {
  rrIntervalsMs: Float64Array;
  timestampMs: number;
  lowerScale: number;
  upperScale: number;
}

export interface DfaA1Scheduler {
  push(rrValue: number, timestampMs: number): DfaA1ComputationSnapshot | null;
  reset(): void;
}

interface ResolvedDfaA1SchedulerConfig {
  rrUnit: 's' | 'ms';
  minRrCount: number;
  windowCount: number | null;
  windowDurationMs: number | null;
  recomputeEvery: number | null;
  recomputeEveryMs: number | null;
  lowerScale: number;
  upperScale: number;
}

function resolveConfig(config: DfaA1SchedulerConfig | undefined): ResolvedDfaA1SchedulerConfig {
  const resolved: ResolvedDfaA1SchedulerConfig = {
    rrUnit: config?.rrUnit ?? 's',
    minRrCount: Math.trunc(config?.minRrCount ?? 50),
    windowCount: config?.windowCount == null ? null : Math.trunc(config.windowCount),
    windowDurationMs: config?.windowDurationMs === undefined ? 120_000 : config.windowDurationMs === null ? null : Math.trunc(config.windowDurationMs),
    recomputeEvery: config?.recomputeEvery == null ? null : Math.trunc(config.recomputeEvery),
    recomputeEveryMs: config?.recomputeEveryMs === undefined ? 5_000 : config.recomputeEveryMs === null ? null : Math.trunc(config.recomputeEveryMs),
    lowerScale: Math.trunc(config?.lowerScale ?? 4),
    upperScale: Math.trunc(config?.upperScale ?? 16),
  };

  if (resolved.windowCount !== null && !(resolved.windowCount > 0)) {
    throw new Error('windowCount должен быть > 0');
  }
  if (resolved.windowDurationMs !== null && !(resolved.windowDurationMs > 0)) {
    throw new Error('windowDurationMs должен быть > 0');
  }
  if (!(resolved.minRrCount > 0)) {
    throw new Error('minRrCount должен быть > 0');
  }
  if (resolved.windowCount !== null && resolved.minRrCount > resolved.windowCount) {
    throw new Error('minRrCount не может быть больше windowCount');
  }
  if (resolved.recomputeEvery !== null && !(resolved.recomputeEvery > 0)) {
    throw new Error('recomputeEvery должен быть > 0');
  }
  if (resolved.recomputeEveryMs !== null && !(resolved.recomputeEveryMs > 0)) {
    throw new Error('recomputeEveryMs должен быть > 0');
  }
  if (!(resolved.lowerScale > 1)) {
    throw new Error('lowerScale должен быть > 1');
  }
  if (!(resolved.upperScale > resolved.lowerScale)) {
    throw new Error('upperScale должен быть больше lowerScale');
  }

  if (resolved.windowCount === null && resolved.windowDurationMs === null) {
    throw new Error('Нужно задать windowCount или windowDurationMs');
  }
  if (resolved.recomputeEvery === null && resolved.recomputeEveryMs === null) {
    throw new Error('Нужно задать recomputeEvery или recomputeEveryMs');
  }

  return resolved;
}

function rrValueToMs(rrValue: number, unit: 's' | 'ms'): number | null {
  if (!Number.isFinite(rrValue)) {
    return null;
  }
  const rrMs = unit === 's' ? rrValue * 1000 : rrValue;
  if (!(rrMs > 0)) {
    return null;
  }
  return rrMs;
}

export function createDfaA1Scheduler(config?: DfaA1SchedulerConfig): DfaA1Scheduler {
  const resolved = resolveConfig(config);
  const rrWindow: Array<{ rrMs: number; timestampMs: number }> = [];
  let samplesSinceLastCompute = 0;
  let lastComputedAtMs: number | null = null;

  function trimWindow(): void {
    if (resolved.windowCount !== null) {
      while (rrWindow.length > resolved.windowCount) {
        rrWindow.shift();
      }
    }

    if (resolved.windowDurationMs !== null) {
      const lastSample = rrWindow.at(-1);
      if (!lastSample) {
        return;
      }
      const minTimestampMs = lastSample.timestampMs - resolved.windowDurationMs;
      while (rrWindow.length > 0 && rrWindow[0]!.timestampMs < minTimestampMs) {
        rrWindow.shift();
      }
    }
  }

  return {
    push(rrValue, timestampMs) {
      const rrMs = rrValueToMs(rrValue, resolved.rrUnit);
      if (rrMs === null || !Number.isFinite(timestampMs)) {
        return null;
      }

      rrWindow.push({ rrMs, timestampMs });
      trimWindow();

      samplesSinceLastCompute += 1;

      if (rrWindow.length < resolved.minRrCount) {
        return null;
      }

      if (resolved.recomputeEvery !== null && samplesSinceLastCompute < resolved.recomputeEvery) {
        return null;
      }
      if (
        resolved.recomputeEveryMs !== null
        && lastComputedAtMs !== null
        && (timestampMs - lastComputedAtMs) < resolved.recomputeEveryMs
      ) {
        return null;
      }

      samplesSinceLastCompute = 0;
      lastComputedAtMs = timestampMs;
      const lastSample = rrWindow.at(-1);
      if (!lastSample) {
        return null;
      }

      return {
        rrIntervalsMs: Float64Array.from(rrWindow.map((sample) => sample.rrMs)),
        timestampMs: lastSample.timestampMs,
        lowerScale: resolved.lowerScale,
        upperScale: resolved.upperScale,
      };
    },
    reset() {
      rrWindow.length = 0;
      samplesSinceLastCompute = 0;
      lastComputedAtMs = null;
    },
  };
}
