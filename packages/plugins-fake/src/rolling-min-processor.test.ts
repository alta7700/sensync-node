import { describe, expect, it } from 'vitest';
import {
  defineRuntimeEventInput,
  EventTypes,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import rollingMinProcessor from './rolling-min-processor.ts';

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  timers: Map<string, () => RuntimeEventInput>;
  advanceSession(ms: number): void;
  dispatch(event: RuntimeEventInput): Promise<void>;
  tick(timerId: string): Promise<void>;
}

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 0n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];
  const timers = new Map<string, () => RuntimeEventInput>();

  const ctx: PluginContext = {
    pluginId: 'rolling-min-processor',
    clock: {
      nowSessionMs: () => sessionMs,
      sessionStartWallMs: () => 1_700_000_000_000,
    },
    currentTimelineId: () => 'timeline-test',
    timelineStartSessionMs: () => 0,
    emit: async (event) => {
      emitted.push(event);
    },
    setTimer: (timerId, _intervalMs, eventFactory) => {
      timers.set(timerId, eventFactory);
    },
    clearTimer: (timerId) => {
      timers.delete(timerId);
    },
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
      tsMonoMs: sessionMs,
      sourcePluginId: 'external-ui',
    } as RuntimeEvent;
  }

  return {
    ctx,
    emitted,
    timers,
    advanceSession(ms: number) {
      sessionMs += ms;
    },
    async dispatch(event) {
      await rollingMinProcessor.onEvent(toRuntimeEvent(event), ctx);
    },
    async tick(timerId: string) {
      const timerEvent = timers.get(timerId);
      if (!timerEvent) {
        throw new Error(`Timer ${timerId} не зарегистрирован`);
      }
      await rollingMinProcessor.onEvent(toRuntimeEvent(timerEvent()), ctx);
    },
  };
}

describe('rolling-min-processor', () => {
  it('materialize-ит exact stream subscription и считает минимум без prefix subscribe', async () => {
    const harness = createHarness({
      sourceStreamId: 'fake.a2',
      outputStreamId: 'metrics.fake.a2.rolling_min_1s',
    });

    await rollingMinProcessor.onInit(harness.ctx);

    expect(rollingMinProcessor.manifest.subscriptions).toEqual([
      {
        type: EventTypes.signalBatch,
        v: 1,
        kind: 'data',
        priority: 'data',
        filter: { streamId: 'fake.a2' },
      },
      {
        type: 'processor.rolling-min.flush',
        v: 1,
        kind: 'fact',
        priority: 'system',
      },
    ]);
    expect(harness.timers.has('rolling-min.flush')).toBe(true);

    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'fake.a1',
        sampleFormat: 'f32',
        frameKind: 'uniform-signal-batch',
        t0Ms: 0,
        dtMs: 10,
        sampleCount: 2,
        values: new Float32Array([99, 98]),
      },
    }));
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'fake.a2',
        sampleFormat: 'f32',
        frameKind: 'uniform-signal-batch',
        t0Ms: 0,
        dtMs: 10,
        sampleCount: 4,
        values: new Float32Array([3, 2, 5, 4]),
      },
    }));

    harness.advanceSession(1_000);
    await harness.tick('rolling-min.flush');

    const signalEvents = harness.emitted.filter((event) => event.type === EventTypes.signalBatch);
    const metricEvents = harness.emitted.filter((event) => event.type === 'metric.value.changed');

    expect(signalEvents).toHaveLength(1);
    expect(metricEvents).toHaveLength(1);

    const signalEvent = signalEvents[0] as RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>;
    expect(signalEvent.payload.streamId).toBe('metrics.fake.a2.rolling_min_1s');
    expect(Array.from(signalEvent.payload.values)).toEqual([2]);
    expect(signalEvent.payload.units).toBe('a.u.');
    expect(metricEvents[0]?.payload).toEqual({ key: 'rollingMin.fakeA', value: 2 });
  });
});
