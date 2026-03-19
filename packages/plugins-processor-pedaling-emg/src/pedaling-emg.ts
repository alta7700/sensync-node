import type { SignalBatchPayload } from '@sensync2/core';

export type GyroAxisKey = 'x' | 'y' | 'z';
export type PedalingLabelState = 0 | 1;

export interface GyroBandHz {
  low: number;
  high: number;
}

export interface PedalingPhaseEngineConfig {
  minCyclePeriodMs: number;
  maxCyclePeriodMs: number;
  axisLockHoldMs: number;
  activeWindowPhaseStart: number;
  activeWindowPhaseEnd: number;
  windowPrePaddingMs: number;
  windowPostPaddingMs: number;
  gyroBandHz?: GyroBandHz;
}

export interface CompletedCycle {
  cycleId: number;
  axis: GyroAxisKey;
  startMs: number;
  midpointMs: number;
  endMs: number;
  nextAnchorMs: number;
  periodMs: number;
  nextPeriodMs: number;
  phaseConfidence: number;
}

export interface EmgSegmentRequest {
  cycleId: number;
  windowStartSessionMs: number;
  sampleRateHz: number;
  values: Float32Array;
  expectedActiveStartOffsetMs: number;
  expectedActiveEndOffsetMs: number;
}

interface AxisMetrics {
  axis: GyroAxisKey;
  confidence: number;
  medianPeriodMs: number | null;
}

interface PhaseTrackerState {
  baseline: number;
  filtered: number;
  previousFiltered: number | null;
  lastTimestampMs: number | null;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if ((sorted.length % 2) === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle] ?? null;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeAlpha(sampleRateHz: number, cutoffHz: number): number {
  if (!(sampleRateHz > 0) || !(cutoffHz > 0)) {
    return 1;
  }
  const dtSeconds = 1 / sampleRateHz;
  const rc = 1 / (Math.PI * 2 * cutoffHz);
  return dtSeconds / (rc + dtSeconds);
}

function sampleTimestampMs(payload: SignalBatchPayload, index: number): number {
  if (payload.frameKind === 'uniform-signal-batch') {
    if (payload.dtMs === undefined) {
      throw new Error(`Поток "${payload.streamId}" не содержит dtMs для uniform batch`);
    }
    return payload.t0Ms + (payload.dtMs * index);
  }

  const timestampMs = payload.timestampsMs?.[index];
  if (timestampMs === undefined) {
    throw new Error(`Поток "${payload.streamId}" не содержит timestampsMs`);
  }
  return timestampMs;
}

function sampleValue(payload: SignalBatchPayload, index: number): number {
  return Number(payload.values[index] ?? 0);
}

class NumericTimeSeriesBuffer {
  private timestampsMs: number[] = [];
  private values: number[] = [];
  private recentSampleRateHz: number | null = null;

  append(payload: SignalBatchPayload): void {
    if (payload.frameKind === 'label-batch') {
      return;
    }

    if (payload.sampleRateHz !== undefined) {
      this.recentSampleRateHz = payload.sampleRateHz;
    } else if (payload.frameKind === 'uniform-signal-batch' && payload.dtMs !== undefined && payload.dtMs > 0) {
      this.recentSampleRateHz = 1000 / payload.dtMs;
    }

    for (let index = 0; index < payload.sampleCount; index += 1) {
      this.timestampsMs.push(sampleTimestampMs(payload, index));
      this.values.push(sampleValue(payload, index));
    }
  }

  trimBefore(cutoffSessionMs: number): void {
    let keepFrom = 0;
    while (keepFrom < this.timestampsMs.length && this.timestampsMs[keepFrom]! < cutoffSessionMs) {
      keepFrom += 1;
    }
    if (keepFrom === 0) {
      return;
    }
    this.timestampsMs = this.timestampsMs.slice(keepFrom);
    this.values = this.values.slice(keepFrom);
  }

  latestTimestampMs(): number | null {
    return this.timestampsMs.length === 0 ? null : (this.timestampsMs[this.timestampsMs.length - 1] ?? null);
  }

  earliestTimestampMs(): number | null {
    return this.timestampsMs.length === 0 ? null : (this.timestampsMs[0] ?? null);
  }

  lastSampleRateHz(): number | null {
    return this.recentSampleRateHz;
  }

  windowSince(startSessionMs: number): { timestampsMs: number[]; values: number[] } {
    let from = 0;
    while (from < this.timestampsMs.length && this.timestampsMs[from]! < startSessionMs) {
      from += 1;
    }
    return {
      timestampsMs: this.timestampsMs.slice(from),
      values: this.values.slice(from),
    };
  }

  extractRange(startSessionMs: number, endSessionMs: number): { timestampsMs: number[]; values: number[] } {
    const timestampsMs: number[] = [];
    const values: number[] = [];
    for (let index = 0; index < this.timestampsMs.length; index += 1) {
      const timestampMs = this.timestampsMs[index]!;
      if (timestampMs < startSessionMs) {
        continue;
      }
      if (timestampMs > endSessionMs) {
        break;
      }
      timestampsMs.push(timestampMs);
      values.push(this.values[index]!);
    }
    return { timestampsMs, values };
  }

  clear(): void {
    this.timestampsMs = [];
    this.values = [];
    this.recentSampleRateHz = null;
  }
}

function computeAxisMetrics(
  axis: GyroAxisKey,
  timestampsMs: number[],
  values: number[],
  minCyclePeriodMs: number,
  maxCyclePeriodMs: number,
): AxisMetrics {
  if (timestampsMs.length < 16 || values.length < 16) {
    return { axis, confidence: 0, medianPeriodMs: null };
  }

  const centered = values.map((value) => value - mean(values));
  const crossings: number[] = [];
  for (let index = 1; index < centered.length; index += 1) {
    const previous = centered[index - 1]!;
    const current = centered[index]!;
    if (!(previous <= 0 && current > 0)) {
      continue;
    }
    const previousTs = timestampsMs[index - 1]!;
    const currentTs = timestampsMs[index]!;
    const denominator = current - previous;
    const ratio = denominator === 0 ? 0 : (-previous / denominator);
    crossings.push(previousTs + ((currentTs - previousTs) * ratio));
  }

  if (crossings.length < 4) {
    return { axis, confidence: 0, medianPeriodMs: null };
  }

  const periods: number[] = [];
  for (let index = 1; index < crossings.length; index += 1) {
    const periodMs = crossings[index]! - crossings[index - 1]!;
    if (periodMs >= minCyclePeriodMs && periodMs <= maxCyclePeriodMs) {
      periods.push(periodMs);
    }
  }

  const medianPeriodMs = median(periods);
  if (medianPeriodMs === null || periods.length < 3) {
    return { axis, confidence: 0, medianPeriodMs: null };
  }

  const deviations = periods.map((periodMs) => Math.abs(periodMs - medianPeriodMs));
  const madMs = median(deviations) ?? Number.MAX_SAFE_INTEGER;
  const normalizedStability = clamp01(1 - ((madMs / Math.max(medianPeriodMs, 1)) * 4));
  const sampleCoverage = clamp01((periods.length - 2) / 4);

  return {
    axis,
    confidence: clamp01(normalizedStability * sampleCoverage),
    medianPeriodMs,
  };
}

function interpolateCrossing(
  previousFiltered: number,
  currentFiltered: number,
  previousTimestampMs: number,
  currentTimestampMs: number,
): number {
  const denominator = currentFiltered - previousFiltered;
  if (denominator === 0) {
    return currentTimestampMs;
  }
  const ratio = (-previousFiltered / denominator);
  return previousTimestampMs + ((currentTimestampMs - previousTimestampMs) * ratio);
}

export interface PedalingPhaseEngine {
  pushGyro(axis: GyroAxisKey, payload: SignalBatchPayload): CompletedCycle[];
  currentAxis(): GyroAxisKey | null;
  currentAxisConfidence(): number;
  reset(): void;
}

export interface EmgSegmentBuffer {
  push(payload: SignalBatchPayload): void;
  extract(cycle: CompletedCycle): EmgSegmentRequest | null;
  reset(): void;
}

export function createPedalingPhaseEngine(config: PedalingPhaseEngineConfig): PedalingPhaseEngine {
  const axisBuffers = {
    x: new NumericTimeSeriesBuffer(),
    y: new NumericTimeSeriesBuffer(),
    z: new NumericTimeSeriesBuffer(),
  } satisfies Record<GyroAxisKey, NumericTimeSeriesBuffer>;
  const axisEvaluationIntervalMs = Math.max(100, Math.min(250, config.minCyclePeriodMs / 2));

  const trackerState: Record<GyroAxisKey, PhaseTrackerState> = {
    x: { baseline: 0, filtered: 0, previousFiltered: null, lastTimestampMs: null },
    y: { baseline: 0, filtered: 0, previousFiltered: null, lastTimestampMs: null },
    z: { baseline: 0, filtered: 0, previousFiltered: null, lastTimestampMs: null },
  };

  let selectedAxis: GyroAxisKey | null = null;
  let selectedAxisConfidence = 0;
  let degradedAxisSinceMs: number | null = null;
  let cycleCounter = 0;
  let anchorTimesMs: number[] = [];
  let lastAxisEvaluationMs: number | null = null;

  const resetTracker = (): void => {
    anchorTimesMs = [];
    for (const state of Object.values(trackerState)) {
      state.baseline = 0;
      state.filtered = 0;
      state.previousFiltered = null;
      state.lastTimestampMs = null;
    }
  };

  const evaluateAxis = (nowMs: number): AxisMetrics => {
    // Выбор оси не должен происходить на каждом gyro-батче: это слишком тяжёлый hot path для live Trigno.
    if (
      selectedAxis !== null
      && anchorTimesMs.length > 0
      && lastAxisEvaluationMs !== null
      && (nowMs - lastAxisEvaluationMs) < axisEvaluationIntervalMs
    ) {
      if (selectedAxis) {
        return {
          axis: selectedAxis,
          confidence: selectedAxisConfidence,
          medianPeriodMs: null,
        };
      }
      return { axis: 'x', confidence: 0, medianPeriodMs: null };
    }

    lastAxisEvaluationMs = nowMs;
    const analysisWindowMs = Math.max(config.maxCyclePeriodMs * 4, 4_000);
    const cutoffSessionMs = nowMs - analysisWindowMs;
    const metrics = (['x', 'y', 'z'] as GyroAxisKey[]).map((axis) => {
      axisBuffers[axis].trimBefore(cutoffSessionMs);
      const window = axisBuffers[axis].windowSince(cutoffSessionMs);
      return computeAxisMetrics(axis, window.timestampsMs, window.values, config.minCyclePeriodMs, config.maxCyclePeriodMs);
    });

    const bestMetric = [...metrics].sort((left, right) => right.confidence - left.confidence)[0]!;
    const currentMetric = selectedAxis
      ? metrics.find((metric) => metric.axis === selectedAxis) ?? null
      : null;

    if (!selectedAxis) {
      if (bestMetric.confidence > 0) {
        selectedAxis = bestMetric.axis;
        selectedAxisConfidence = bestMetric.confidence;
      }
      return bestMetric;
    }

    if (currentMetric && currentMetric.confidence >= Math.max(bestMetric.confidence - 0.05, 0.2)) {
      degradedAxisSinceMs = currentMetric.confidence < 0.2 ? (degradedAxisSinceMs ?? nowMs) : null;
      selectedAxisConfidence = currentMetric.confidence;
      return currentMetric;
    }

    degradedAxisSinceMs = degradedAxisSinceMs ?? nowMs;
    if ((nowMs - degradedAxisSinceMs) < config.axisLockHoldMs) {
      selectedAxisConfidence = currentMetric?.confidence ?? 0;
      return currentMetric ?? { axis: selectedAxis, confidence: 0, medianPeriodMs: null };
    }

    degradedAxisSinceMs = null;
    selectedAxis = bestMetric.confidence > 0 ? bestMetric.axis : null;
    selectedAxisConfidence = bestMetric.confidence;
    resetTracker();
    return bestMetric;
  };

  const pushSelectedAxis = (payload: SignalBatchPayload, axisConfidence: number): CompletedCycle[] => {
    if (!selectedAxis || payload.frameKind === 'label-batch') {
      return [];
    }

    const state = trackerState[selectedAxis];
    const sampleRateHz = payload.sampleRateHz ?? (
      payload.frameKind === 'uniform-signal-batch' && payload.dtMs !== undefined && payload.dtMs > 0
        ? 1000 / payload.dtMs
        : 100
    );
    const lowCutHz = Math.max(config.gyroBandHz?.low ?? 0.3, 0.05);
    const highCutHz = Math.max(config.gyroBandHz?.high ?? 6, lowCutHz + 0.1);
    const baselineAlpha = computeAlpha(sampleRateHz, lowCutHz);
    const smoothingAlpha = computeAlpha(sampleRateHz, highCutHz);
    const completedCycles: CompletedCycle[] = [];

    for (let index = 0; index < payload.sampleCount; index += 1) {
      const timestampMs = sampleTimestampMs(payload, index);
      const rawValue = sampleValue(payload, index);

      state.baseline += baselineAlpha * (rawValue - state.baseline);
      const detrended = rawValue - state.baseline;
      state.filtered += smoothingAlpha * (detrended - state.filtered);

      if (
        state.previousFiltered !== null
        && state.lastTimestampMs !== null
        && state.previousFiltered <= 0
        && state.filtered > 0
        && (state.filtered - state.previousFiltered) > 0
      ) {
        const crossingMs = interpolateCrossing(
          state.previousFiltered,
          state.filtered,
          state.lastTimestampMs,
          timestampMs,
        );
        const previousAnchor = anchorTimesMs[anchorTimesMs.length - 1] ?? null;
        const currentPeriodMs = previousAnchor === null ? null : (crossingMs - previousAnchor);

        if (currentPeriodMs === null || (currentPeriodMs >= config.minCyclePeriodMs && currentPeriodMs <= config.maxCyclePeriodMs)) {
          anchorTimesMs.push(crossingMs);
          if (anchorTimesMs.length > 3) {
            anchorTimesMs = anchorTimesMs.slice(-3);
          }

          if (anchorTimesMs.length === 3) {
            const [startMs, endMs, nextAnchorMs] = anchorTimesMs;
            const periodMs = endMs! - startMs!;
            const nextPeriodMs = nextAnchorMs! - endMs!;
            const stability = clamp01(1 - ((Math.abs(nextPeriodMs - periodMs) / Math.max(periodMs, 1)) * 4));

            cycleCounter += 1;
            completedCycles.push({
              cycleId: cycleCounter,
              axis: selectedAxis,
              startMs: startMs!,
              midpointMs: startMs! + (periodMs / 2),
              endMs: endMs!,
              nextAnchorMs: nextAnchorMs!,
              periodMs,
              nextPeriodMs,
              phaseConfidence: clamp01(axisConfidence * stability),
            });
          }
        }
      }

      state.previousFiltered = state.filtered;
      state.lastTimestampMs = timestampMs;
    }

    return completedCycles;
  };

  return {
    pushGyro(axis, payload) {
      axisBuffers[axis].append(payload);
      const nowMs = axisBuffers[axis].latestTimestampMs();
      if (nowMs === null) {
        return [];
      }
      const metric = evaluateAxis(nowMs);
      if (selectedAxis !== axis) {
        return [];
      }
      return pushSelectedAxis(payload, metric.confidence);
    },
    currentAxis() {
      return selectedAxis;
    },
    currentAxisConfidence() {
      return selectedAxisConfidence;
    },
    reset() {
      selectedAxis = null;
      selectedAxisConfidence = 0;
      degradedAxisSinceMs = null;
      cycleCounter = 0;
      lastAxisEvaluationMs = null;
      resetTracker();
      axisBuffers.x.clear();
      axisBuffers.y.clear();
      axisBuffers.z.clear();
    },
  };
}

export function createEmgSegmentBuffer(config: PedalingPhaseEngineConfig): EmgSegmentBuffer {
  const emgBuffer = new NumericTimeSeriesBuffer();

  return {
    push(payload) {
      emgBuffer.append(payload);
      const latestTimestampMs = emgBuffer.latestTimestampMs();
      if (latestTimestampMs === null) {
        return;
      }
      // Храним только хвост последних нескольких циклов, чтобы не раздувать память на 4 кГц потоке.
      emgBuffer.trimBefore(latestTimestampMs - Math.max(config.maxCyclePeriodMs * 4, 8_000));
    },
    extract(cycle) {
      const sampleRateHz = emgBuffer.lastSampleRateHz();
      if (!(sampleRateHz && sampleRateHz > 0)) {
        return null;
      }

      const cycleStartMs = cycle.startMs;
      const cycleEndMs = cycle.endMs;
      const currentPeriodMs = cycle.periodMs;
      const nextPeriodMs = cycle.nextPeriodMs;
      const phaseStart = config.activeWindowPhaseStart;
      const phaseEnd = config.activeWindowPhaseEnd;

      const activeStartMs = cycleStartMs + (currentPeriodMs * phaseStart);
      const activeEndMs = phaseEnd >= phaseStart
        ? cycleStartMs + (currentPeriodMs * phaseEnd)
        : cycleEndMs + (nextPeriodMs * phaseEnd);
      const segmentStartMs = activeStartMs - config.windowPrePaddingMs;
      const segmentEndMs = activeEndMs + config.windowPostPaddingMs;
      const sampleIntervalMs = 1000 / sampleRateHz;
      const coverageToleranceMs = Math.max(sampleIntervalMs * 1.5, 2);
      const earliestTimestampMs = emgBuffer.earliestTimestampMs();
      const latestTimestampMs = emgBuffer.latestTimestampMs();

      if (earliestTimestampMs === null || latestTimestampMs === null) {
        return null;
      }
      // Без полного покрытия окна offsets станут ложными, поэтому усечённый сегмент не отправляем в Python вовсе.
      if (earliestTimestampMs > (segmentStartMs + coverageToleranceMs)) {
        return null;
      }
      if (latestTimestampMs < (segmentEndMs - coverageToleranceMs)) {
        return null;
      }

      const extracted = emgBuffer.extractRange(segmentStartMs, segmentEndMs);
      if (extracted.values.length < Math.max(8, Math.round(sampleRateHz * 0.05))) {
        return null;
      }
      const actualStartMs = extracted.timestampsMs[0] ?? null;
      const actualEndMs = extracted.timestampsMs[extracted.timestampsMs.length - 1] ?? null;
      if (actualStartMs === null || actualEndMs === null) {
        return null;
      }
      if (actualStartMs > (segmentStartMs + coverageToleranceMs)) {
        return null;
      }
      if (actualEndMs < (segmentEndMs - coverageToleranceMs)) {
        return null;
      }

      return {
        cycleId: cycle.cycleId,
        windowStartSessionMs: segmentStartMs,
        sampleRateHz,
        values: Float32Array.from(extracted.values),
        expectedActiveStartOffsetMs: activeStartMs - segmentStartMs,
        expectedActiveEndOffsetMs: activeEndMs - segmentStartMs,
      };
    },
    reset() {
      emgBuffer.clear();
    },
  };
}
