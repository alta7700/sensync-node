import { describe, expect, it } from 'vitest';
import {
  defineRuntimeEventInput,
  EventTypes,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import activityDetectorProcessor from './activity-detector-processor.ts';

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  dispatch(event: RuntimeEventInput): Promise<void>;
}

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 0n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];

  const ctx: PluginContext = {
    pluginId: 'activity-detector-processor',
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
    requestTimelineReset: () => {},
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
      await activityDetectorProcessor.onEvent(toRuntimeEvent(event), ctx);
    },
  };
}

describe('activity-detector-processor', () => {
  it('сохраняет начальный state emit и exact stream subscription', async () => {
    const harness = createHarness({
      sourceStreamId: 'shapes.signal',
      threshold: 0.6,
    });

    await activityDetectorProcessor.onInit(harness.ctx);

    expect(activityDetectorProcessor.manifest.subscriptions).toEqual([
      {
        type: EventTypes.signalBatch,
        v: 1,
        kind: 'data',
        priority: 'data',
        filter: { streamId: 'shapes.signal' },
      },
    ]);

    expect(harness.emitted[0]).toEqual(defineRuntimeEventInput({
      type: EventTypes.activityStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { active: false },
    }));
  });

  it('эмитит state и label только на переключении порога', async () => {
    const harness = createHarness({
      sourceStreamId: 'shapes.signal',
      threshold: 0.6,
    });

    await activityDetectorProcessor.onInit(harness.ctx);
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'shapes.signal',
        sampleFormat: 'f32',
        frameKind: 'uniform-signal-batch',
        t0Ms: 0,
        dtMs: 10,
        sampleCount: 3,
        values: new Float32Array([0.1, 0.2, 0.3]),
      },
    }));
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'shapes.signal',
        sampleFormat: 'f32',
        frameKind: 'uniform-signal-batch',
        t0Ms: 30,
        dtMs: 10,
        sampleCount: 3,
        values: new Float32Array([0.1, 0.7, 0.2]),
      },
    }));
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'shapes.signal',
        sampleFormat: 'f32',
        frameKind: 'uniform-signal-batch',
        t0Ms: 60,
        dtMs: 10,
        sampleCount: 2,
        values: new Float32Array([0.8, 0.9]),
      },
    }));

    const activityEvents = harness.emitted.filter((event) => event.type === EventTypes.activityStateChanged);
    const labelEvents = harness.emitted.filter((event) => event.type === EventTypes.signalBatch);

    expect(activityEvents).toHaveLength(2);
    expect(activityEvents[1]?.payload).toEqual({ active: true });
    expect(labelEvents).toHaveLength(1);

    const labelEvent = labelEvents[0] as RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>;
    expect(labelEvent.payload.streamId).toBe('activity.label');
    expect(labelEvent.payload.sampleFormat).toBe('i16');
    expect(Array.from(labelEvent.payload.values)).toEqual([1]);
  });
});
