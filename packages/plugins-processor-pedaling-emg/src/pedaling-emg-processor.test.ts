import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defineRuntimeEventInput,
  EventTypes,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import type { IpcWorkerProcessSpec } from '@sensync2/plugin-kit';
import pedalingEmgProcessor from './pedaling-emg-processor.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function createComputeWorkerSpec(): IpcWorkerProcessSpec {
  return {
    command: 'uv',
    args: [
      'run',
      '--project',
      path.join(repoRoot, 'packages/plugin-kit/python-runtime'),
      'python',
      path.join(repoRoot, 'packages/plugins-processor-pedaling-emg/python_worker/main.py'),
    ],
    cwd: repoRoot,
    env: {
      PYTHONUNBUFFERED: '1',
    },
    workerName: 'pedaling-emg-worker',
    readyTimeoutMs: 10_000,
    requestTimeoutMs: 15_000,
  };
}

function createBrokenComputeWorkerSpec(): IpcWorkerProcessSpec {
  return {
    command: 'uv',
    args: [
      'run',
      '--project',
      path.join(repoRoot, 'packages/plugin-kit/python-runtime'),
      'python',
      path.join(repoRoot, 'packages/plugins-processor-pedaling-emg/python_worker/missing_worker.py'),
    ],
    cwd: repoRoot,
    env: {
      PYTHONUNBUFFERED: '1',
    },
    workerName: 'pedaling-emg-worker-broken',
    readyTimeoutMs: 500,
    requestTimeoutMs: 2_000,
  };
}

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  dispatch(event: RuntimeEventInput): Promise<void>;
}

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 0n;
  const emitted: RuntimeEventInput[] = [];

  const ctx: PluginContext = {
    pluginId: 'pedaling-emg-processor',
    clock: {
      nowSessionMs: () => 0,
      sessionStartWallMs: () => 1_700_000_000_000,
    },
    currentTimelineId: () => 'timeline-test',
    timelineStartSessionMs: () => 0,
    emit: async (event) => {
      emitted.push(event);
    },
    setTimer: () => {},
    clearTimer: () => {},
    telemetry: () => {},
    getConfig: <T>() => config as T,
    requestTimelineReset: () => null,
  };

  function toRuntimeEvent(event: RuntimeEventInput): RuntimeEvent {
    seq += 1n;
    return {
      ...event,
      seq,
      timelineId: 'timeline-test',
      tsMonoMs: Number(seq),
      sourcePluginId: 'external-ui',
    } as RuntimeEvent;
  }

  return {
    ctx,
    emitted,
    async dispatch(event) {
      await pedalingEmgProcessor.onEvent(toRuntimeEvent(event), ctx);
    },
  };
}

function uniformBatch(streamId: string, t0Ms: number, sampleRateHz: number, values: Float32Array): RuntimeEventInput {
  return defineRuntimeEventInput({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    payload: {
      streamId,
      sampleFormat: 'f32',
      frameKind: 'uniform-signal-batch',
      t0Ms,
      dtMs: 1000 / sampleRateHz,
      sampleRateHz,
      sampleCount: values.length,
      values,
    },
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Не дождались ожидаемого условия');
}

afterEach(async () => {
  const harness = createHarness({
    gyroStreamIds: { x: 'gyro.x', y: 'gyro.y', z: 'gyro.z' },
    emgStreamId: 'emg',
    phaseLabelStreamId: 'phase',
    activityLabelStreamId: 'activity',
    phaseConfidenceStreamId: 'phase.confidence',
    emgConfidenceStreamId: 'emg.confidence',
    cyclePeriodStreamId: 'cycle.period',
    computeWorker: createComputeWorkerSpec(),
  });
  await pedalingEmgProcessor.onShutdown(harness.ctx);
});

describe('pedaling-emg-processor', () => {
  it('подписывается на exact gyro/emg streams и публикует labels + diagnostics', async () => {
    const harness = createHarness({
      gyroStreamIds: { x: 'gyro.x', y: 'gyro.y', z: 'gyro.z' },
      emgStreamId: 'emg',
      phaseLabelStreamId: 'phase',
      activityLabelStreamId: 'activity',
      phaseConfidenceStreamId: 'phase.confidence',
      emgConfidenceStreamId: 'emg.confidence',
      cyclePeriodStreamId: 'cycle.period',
      activeWindowPhaseStart: 0.15,
      activeWindowPhaseEnd: 0.65,
      windowPrePaddingMs: 80,
      windowPostPaddingMs: 80,
      minCyclePeriodMs: 500,
      maxCyclePeriodMs: 1_500,
      axisLockHoldMs: 500,
      phaseConfidenceThreshold: 0.3,
      computeWorker: createComputeWorkerSpec(),
    });

    await pedalingEmgProcessor.onInit(harness.ctx);

    expect(pedalingEmgProcessor.manifest.subscriptions).toEqual([
      { type: EventTypes.signalBatch, v: 1, kind: 'data', priority: 'data', filter: { streamId: 'gyro.x' } },
      { type: EventTypes.signalBatch, v: 1, kind: 'data', priority: 'data', filter: { streamId: 'gyro.y' } },
      { type: EventTypes.signalBatch, v: 1, kind: 'data', priority: 'data', filter: { streamId: 'gyro.z' } },
      { type: EventTypes.signalBatch, v: 1, kind: 'data', priority: 'data', filter: { streamId: 'emg' } },
    ]);

    const gyroRateHz = 100;
    const emgRateHz = 1_000;
    const batchDurationMs = 100;

    for (let batchIndex = 0; batchIndex < 50; batchIndex += 1) {
      const t0Ms = batchIndex * batchDurationMs;
      const gyroSamples = new Float32Array((gyroRateHz * batchDurationMs) / 1000);
      const gyroNoise = new Float32Array(gyroSamples.length);
      const emgSamples = new Float32Array((emgRateHz * batchDurationMs) / 1000);

      for (let index = 0; index < gyroSamples.length; index += 1) {
        const absoluteSample = (batchIndex * gyroSamples.length) + index;
        const tSeconds = absoluteSample / gyroRateHz;
        gyroSamples[index] = Math.sin(2 * Math.PI * tSeconds);
        gyroNoise[index] = Math.sin(2 * Math.PI * tSeconds * 0.21) * 0.03;
      }

      for (let index = 0; index < emgSamples.length; index += 1) {
        const absoluteSample = (batchIndex * emgSamples.length) + index;
        const tSeconds = absoluteSample / emgRateHz;
        const phase = tSeconds % 1;
        const inBurst = phase >= 0.22 && phase <= 0.42;
        emgSamples[index] = inBurst
          ? Math.sin(2 * Math.PI * 85 * tSeconds) * 0.35
          : Math.sin(2 * Math.PI * 8 * tSeconds) * 0.01;
      }

      await harness.dispatch(uniformBatch('emg', t0Ms, emgRateHz, emgSamples));
      await harness.dispatch(uniformBatch('gyro.y', t0Ms, gyroRateHz, gyroNoise));
      await harness.dispatch(uniformBatch('gyro.z', t0Ms, gyroRateHz, gyroNoise));
      await harness.dispatch(uniformBatch('gyro.x', t0Ms, gyroRateHz, gyroSamples));
    }

    await waitFor(() => harness.emitted.some((event) => event.type === EventTypes.signalBatch && event.payload.streamId === 'activity'));

    const signalEvents = harness.emitted.filter((event) => event.type === EventTypes.signalBatch) as Array<RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>>;
    expect(signalEvents.some((event) => event.payload.streamId === 'phase' && event.payload.frameKind === 'label-batch')).toBe(true);
    expect(signalEvents.some((event) => event.payload.streamId === 'activity' && event.payload.frameKind === 'label-batch')).toBe(true);
    expect(signalEvents.some((event) => event.payload.streamId === 'phase.confidence')).toBe(true);
    expect(signalEvents.some((event) => event.payload.streamId === 'emg.confidence')).toBe(true);
    expect(signalEvents.some((event) => event.payload.streamId === 'cycle.period')).toBe(true);
  }, 20_000);

  it('не публикует activation labels при неустойчивом gyro', async () => {
    const harness = createHarness({
      gyroStreamIds: { x: 'gyro.x', y: 'gyro.y', z: 'gyro.z' },
      emgStreamId: 'emg',
      phaseLabelStreamId: 'phase',
      activityLabelStreamId: 'activity',
      phaseConfidenceStreamId: 'phase.confidence',
      emgConfidenceStreamId: 'emg.confidence',
      cyclePeriodStreamId: 'cycle.period',
      minCyclePeriodMs: 500,
      maxCyclePeriodMs: 1_500,
      axisLockHoldMs: 500,
      phaseConfidenceThreshold: 0.7,
      computeWorker: createComputeWorkerSpec(),
    });

    await pedalingEmgProcessor.onInit(harness.ctx);

    const gyroRateHz = 100;
    const emgRateHz = 1_000;
    for (let batchIndex = 0; batchIndex < 20; batchIndex += 1) {
      const t0Ms = batchIndex * 100;
      const gyroNoise = new Float32Array(10);
      const emgNoise = new Float32Array(100);
      for (let index = 0; index < gyroNoise.length; index += 1) {
        gyroNoise[index] = ((batchIndex + index) % 5) * 0.02;
      }
      for (let index = 0; index < emgNoise.length; index += 1) {
        emgNoise[index] = Math.sin((2 * Math.PI * 7 * ((batchIndex * 100) + index)) / emgRateHz) * 0.01;
      }

      await harness.dispatch(uniformBatch('emg', t0Ms, emgRateHz, emgNoise));
      await harness.dispatch(uniformBatch('gyro.x', t0Ms, gyroRateHz, gyroNoise));
      await harness.dispatch(uniformBatch('gyro.y', t0Ms, gyroRateHz, gyroNoise));
      await harness.dispatch(uniformBatch('gyro.z', t0Ms, gyroRateHz, gyroNoise));
    }

    const signalEvents = harness.emitted.filter((event) => event.type === EventTypes.signalBatch) as Array<RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>>;
    const activityEvents = signalEvents.filter((event) => event.payload.streamId === 'activity');
    const phaseEvents = signalEvents.filter((event) => event.payload.streamId === 'phase');
    const emgConfidenceEvents = signalEvents.filter((event) => event.payload.streamId === 'emg.confidence');

    expect(activityEvents.length).toBe(0);
    expect(phaseEvents.length).toBe(0);
    expect(emgConfidenceEvents.every((event) => Number(event.payload.values[0]) === 0)).toBe(true);
  }, 20_000);

  it('сохраняет фазовый слой живым, если compute worker не поднялся', async () => {
    const harness = createHarness({
      gyroStreamIds: { x: 'gyro.x', y: 'gyro.y', z: 'gyro.z' },
      emgStreamId: 'emg',
      phaseLabelStreamId: 'phase',
      activityLabelStreamId: 'activity',
      phaseConfidenceStreamId: 'phase.confidence',
      emgConfidenceStreamId: 'emg.confidence',
      cyclePeriodStreamId: 'cycle.period',
      activeWindowPhaseStart: 0.15,
      activeWindowPhaseEnd: 0.65,
      windowPrePaddingMs: 80,
      windowPostPaddingMs: 80,
      minCyclePeriodMs: 500,
      maxCyclePeriodMs: 1_500,
      axisLockHoldMs: 500,
      phaseConfidenceThreshold: 0.3,
      computeWorker: createBrokenComputeWorkerSpec(),
    });

    await expect(pedalingEmgProcessor.onInit(harness.ctx)).resolves.toBeUndefined();

    const gyroRateHz = 100;
    const emgRateHz = 1_000;
    const batchDurationMs = 100;

    for (let batchIndex = 0; batchIndex < 50; batchIndex += 1) {
      const t0Ms = batchIndex * batchDurationMs;
      const gyroSamples = new Float32Array((gyroRateHz * batchDurationMs) / 1000);
      const gyroNoise = new Float32Array(gyroSamples.length);
      const emgSamples = new Float32Array((emgRateHz * batchDurationMs) / 1000);

      for (let index = 0; index < gyroSamples.length; index += 1) {
        const absoluteSample = (batchIndex * gyroSamples.length) + index;
        const tSeconds = absoluteSample / gyroRateHz;
        gyroSamples[index] = Math.sin(2 * Math.PI * tSeconds);
        gyroNoise[index] = Math.sin(2 * Math.PI * tSeconds * 0.21) * 0.03;
      }
      for (let index = 0; index < emgSamples.length; index += 1) {
        const absoluteSample = (batchIndex * emgSamples.length) + index;
        const tSeconds = absoluteSample / emgRateHz;
        const phase = tSeconds % 1;
        const inBurst = phase >= 0.22 && phase <= 0.42;
        emgSamples[index] = inBurst
          ? Math.sin(2 * Math.PI * 85 * tSeconds) * 0.35
          : Math.sin(2 * Math.PI * 8 * tSeconds) * 0.01;
      }

      await harness.dispatch(uniformBatch('emg', t0Ms, emgRateHz, emgSamples));
      await harness.dispatch(uniformBatch('gyro.x', t0Ms, gyroRateHz, gyroSamples));
      await harness.dispatch(uniformBatch('gyro.y', t0Ms, gyroRateHz, gyroNoise));
      await harness.dispatch(uniformBatch('gyro.z', t0Ms, gyroRateHz, gyroNoise));
    }

    const signalEvents = harness.emitted.filter((event) => event.type === EventTypes.signalBatch) as Array<RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>>;
    expect(signalEvents.some((event) => event.payload.streamId === 'phase' && event.payload.frameKind === 'label-batch')).toBe(true);
    expect(signalEvents.some((event) => event.payload.streamId === 'phase.confidence' && Number(event.payload.values[0]) > 0)).toBe(true);
    const activityEvents = signalEvents.filter((event) => event.payload.streamId === 'activity');
    expect(activityEvents.every((event) => Array.from(event.payload.values).every((value) => Number(value) === 0))).toBe(true);
    expect(signalEvents.some((event) => event.payload.streamId === 'emg.confidence' && Number(event.payload.values[0]) === 0)).toBe(true);
  }, 20_000);

  it('роняет phaseConfidence в 0 при потере устойчивой периодики', async () => {
    const harness = createHarness({
      gyroStreamIds: { x: 'gyro.x', y: 'gyro.y', z: 'gyro.z' },
      emgStreamId: 'emg',
      phaseLabelStreamId: 'phase',
      activityLabelStreamId: 'activity',
      phaseConfidenceStreamId: 'phase.confidence',
      emgConfidenceStreamId: 'emg.confidence',
      cyclePeriodStreamId: 'cycle.period',
      activeWindowPhaseStart: 0.15,
      activeWindowPhaseEnd: 0.65,
      windowPrePaddingMs: 80,
      windowPostPaddingMs: 80,
      minCyclePeriodMs: 500,
      maxCyclePeriodMs: 1_500,
      axisLockHoldMs: 500,
      phaseConfidenceThreshold: 0.3,
      computeWorker: createComputeWorkerSpec(),
    });

    await pedalingEmgProcessor.onInit(harness.ctx);

    const gyroRateHz = 100;
    const emgRateHz = 1_000;
    const batchDurationMs = 100;

    for (let batchIndex = 0; batchIndex < 45; batchIndex += 1) {
      const t0Ms = batchIndex * batchDurationMs;
      const gyroSamples = new Float32Array((gyroRateHz * batchDurationMs) / 1000);
      const gyroNoise = new Float32Array(gyroSamples.length);
      const emgSamples = new Float32Array((emgRateHz * batchDurationMs) / 1000);
      for (let index = 0; index < gyroSamples.length; index += 1) {
        const absoluteSample = (batchIndex * gyroSamples.length) + index;
        const tSeconds = absoluteSample / gyroRateHz;
        gyroSamples[index] = Math.sin(2 * Math.PI * tSeconds);
        gyroNoise[index] = Math.sin(2 * Math.PI * tSeconds * 0.21) * 0.03;
      }
      await harness.dispatch(uniformBatch('emg', t0Ms, emgRateHz, emgSamples));
      await harness.dispatch(uniformBatch('gyro.y', t0Ms, gyroRateHz, gyroNoise));
      await harness.dispatch(uniformBatch('gyro.z', t0Ms, gyroRateHz, gyroNoise));
      await harness.dispatch(uniformBatch('gyro.x', t0Ms, gyroRateHz, gyroSamples));
    }

    for (let batchIndex = 45; batchIndex < 75; batchIndex += 1) {
      const t0Ms = batchIndex * batchDurationMs;
      const gyroFlat = new Float32Array((gyroRateHz * batchDurationMs) / 1000);
      const emgNoise = new Float32Array((emgRateHz * batchDurationMs) / 1000);
      await harness.dispatch(uniformBatch('emg', t0Ms, emgRateHz, emgNoise));
      await harness.dispatch(uniformBatch('gyro.y', t0Ms, gyroRateHz, gyroFlat));
      await harness.dispatch(uniformBatch('gyro.z', t0Ms, gyroRateHz, gyroFlat));
      await harness.dispatch(uniformBatch('gyro.x', t0Ms, gyroRateHz, gyroFlat));
    }

    const phaseConfidenceEvents = harness.emitted
      .filter((event): event is RuntimeEventInputOf<typeof EventTypes.signalBatch, 1> => event.type === EventTypes.signalBatch)
      .filter((event) => event.payload.streamId === 'phase.confidence');

    expect(phaseConfidenceEvents.some((event) => Number(event.payload.values[0]) > 0.3)).toBe(true);
    expect(phaseConfidenceEvents.some((event) => Number(event.payload.values[0]) === 0)).toBe(true);
  }, 20_000);
});
