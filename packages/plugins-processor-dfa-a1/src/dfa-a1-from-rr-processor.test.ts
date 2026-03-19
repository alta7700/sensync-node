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
import dfaA1FromRrProcessor from './dfa-a1-from-rr-processor.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function createComputeWorkerSpec(): IpcWorkerProcessSpec {
  return {
    command: 'uv',
    args: [
      'run',
      '--project',
      path.join(repoRoot, 'packages/plugin-kit/python-runtime'),
      'python',
      path.join(repoRoot, 'packages/plugins-processor-dfa-a1/python_worker/main.py'),
    ],
    cwd: repoRoot,
    env: {
      PYTHONUNBUFFERED: '1',
    },
    workerName: 'dfa-a1-worker',
    readyTimeoutMs: 10_000,
    requestTimeoutMs: 15_000,
  };
}

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  dispatch(event: RuntimeEventInput): Promise<void>;
}

async function waitForSignalBatchCount(
  harness: TestHarness,
  expectedCount: number,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const actualCount = harness.emitted.filter((event) => event.type === EventTypes.signalBatch).length;
    if (actualCount === expectedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Не дождались ${expectedCount} signal.batch событий`);
}

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 0n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];

  const ctx: PluginContext = {
    pluginId: 'dfa-a1-from-rr-processor',
    clock: {
      nowSessionMs: () => sessionMs,
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
    sessionMs += 1;
    return {
      ...event,
      seq,
      timelineId: 'timeline-test',
      tsMonoMs: sessionMs,
      sourcePluginId: 'external-ui',
    } as RuntimeEvent;
  }

  return {
    ctx,
    emitted,
    async dispatch(event) {
      await dfaA1FromRrProcessor.onEvent(toRuntimeEvent(event), ctx);
    },
  };
}

afterEach(async () => {
  const harness = createHarness({
    computeWorker: createComputeWorkerSpec(),
  });
  await dfaA1FromRrProcessor.onShutdown(harness.ctx);
});

describe('dfa-a1-from-rr-processor', () => {
  it('подписывается на exact RR stream и публикует irregular DFA point', async () => {
    const harness = createHarness({
      sourceStreamId: 'rr.input',
      outputStreamId: 'dfa.output',
      rrUnit: 'ms',
      windowCount: 50,
      minRrCount: 50,
      recomputeEvery: 5,
      lowerScale: 4,
      upperScale: 16,
      computeWorker: createComputeWorkerSpec(),
    });

    await dfaA1FromRrProcessor.onInit(harness.ctx);

    expect(dfaA1FromRrProcessor.manifest.subscriptions).toEqual([
      {
        type: EventTypes.signalBatch,
        v: 1,
        kind: 'data',
        priority: 'data',
        filter: { streamId: 'rr.input' },
      },
    ]);

    const rrValues = Float32Array.from(Array.from({ length: 50 }, (_, index) => 780 + ((index % 5) * 8)));
    const timestamps = Float64Array.from(Array.from({ length: 50 }, (_, index) => 1_000 + (index * 800)));

    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'rr.input',
        sampleFormat: 'f32',
        frameKind: 'irregular-signal-batch',
        t0Ms: timestamps[0] ?? 0,
        sampleCount: rrValues.length,
        values: rrValues,
        timestampsMs: timestamps,
      },
    }));

    await waitForSignalBatchCount(harness, 1);

    const outputEvent = (
      harness.emitted.find((event) => event.type === EventTypes.signalBatch)
    ) as RuntimeEventInputOf<typeof EventTypes.signalBatch, 1> | undefined;
    expect(outputEvent).toBeDefined();
    expect(outputEvent?.payload.streamId).toBe('dfa.output');
    expect(outputEvent?.payload.frameKind).toBe('irregular-signal-batch');
    expect(outputEvent?.payload.sampleCount).toBe(1);
    expect(outputEvent?.payload.timestampsMs?.[0]).toBe(timestamps.at(-1));
    expect(outputEvent?.payload.values[0]).toBeGreaterThan(0);
    expect(outputEvent?.payload.values[0]).toBeLessThan(2);
  });

  it('сбрасывает окно на timeline reset commit', async () => {
    const harness = createHarness({
      sourceStreamId: 'rr.input',
      outputStreamId: 'dfa.output',
      rrUnit: 'ms',
      windowCount: 50,
      minRrCount: 50,
      recomputeEvery: 5,
      computeWorker: createComputeWorkerSpec(),
    });

    await dfaA1FromRrProcessor.onInit(harness.ctx);

    const firstBatch = defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'rr.input',
        sampleFormat: 'f32',
        frameKind: 'uniform-signal-batch',
        t0Ms: 0,
        dtMs: 1000,
        sampleCount: 50,
        values: Float32Array.from(Array.from({ length: 50 }, (_, index) => 780 + ((index % 5) * 8))),
      },
    });

    await harness.dispatch(firstBatch);
    await waitForSignalBatchCount(harness, 1);

    await dfaA1FromRrProcessor.onTimelineResetPrepare?.({
      resetId: 'reset-1',
      currentTimelineId: 'timeline-test',
      nextTimelineId: 'timeline-next',
      requestedAtSessionMs: 10,
    }, harness.ctx);
    await dfaA1FromRrProcessor.onTimelineResetCommit?.({
      resetId: 'reset-1',
      nextTimelineId: 'timeline-next',
      timelineStartSessionMs: 100,
    }, harness.ctx);

    await harness.dispatch(firstBatch);
    await waitForSignalBatchCount(harness, 2);
  }, 15_000);
});
