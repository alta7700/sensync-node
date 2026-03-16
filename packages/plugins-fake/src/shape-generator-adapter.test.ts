import { describe, expect, it } from 'vitest';
import {
  EventTypes,
  type PluginMetric,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import shapeGeneratorAdapter from './shape-generator-adapter.ts';

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  metrics: PluginMetric[];
  timers: Map<string, () => RuntimeEventInput>;
  advanceSession(ms: number): void;
  dispatch(event: RuntimeEventInput): Promise<void>;
  tick(timerId: string): Promise<void>;
}

describe('shape-generator-adapter', () => {
  it('остаётся manual на init и не стартует поток сам', async () => {
    const harness = createHarness({
      sampleRateHz: 200,
      batchMs: 50,
    });

    await shapeGeneratorAdapter.onInit(harness.ctx);

    expect(lastAdapterState(harness.emitted, 'shapes')?.state).toBe('disconnected');
    expect(harness.timers.has('shape.scheduler')).toBe(false);
    expect(harness.emitted.some((event) => event.type === EventTypes.signalBatch)).toBe(false);
  });

  it('после manual connect и shapeGenerateRequest публикует форму без регрессии по event flow', async () => {
    const harness = createHarness({
      sampleRateHz: 200,
      batchMs: 50,
    });

    await shapeGeneratorAdapter.onInit(harness.ctx);
    await harness.dispatch({
      type: EventTypes.adapterConnectRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'shapes',
        requestId: 'connect-1',
      },
    });
    await harness.dispatch({
      type: EventTypes.shapeGenerateRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        shapeName: 'triangle',
      },
    });

    harness.advanceSession(50);
    await harness.tick('shape.scheduler');

    expect(lastAdapterState(harness.emitted, 'shapes')).toEqual({
      adapterId: 'shapes',
      state: 'connected',
      requestId: 'connect-1',
    });

    const shapeGenerated = harness.emitted.find((event) => event.type === EventTypes.shapeGenerated);
    expect(shapeGenerated?.type).toBe(EventTypes.shapeGenerated);

    const signalEvent = harness.emitted.find((event) => event.type === EventTypes.signalBatch);
    expect(signalEvent?.type).toBe(EventTypes.signalBatch);
    if (signalEvent?.type === EventTypes.signalBatch) {
      expect(signalEvent.payload.streamId).toBe('shapes.signal');
      expect(signalEvent.payload.sampleFormat).toBe('f32');
      expect(signalEvent.payload.sampleCount).toBe(10);
      expect(Array.from(signalEvent.payload.values).some((value) => value !== 0)).toBe(true);
    }
  });
});

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 1n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];
  const metrics: PluginMetric[] = [];
  const timers = new Map<string, () => RuntimeEventInput>();

  const ctx: PluginContext = {
    pluginId: 'shape-generator-adapter',
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
    telemetry: (metric) => {
      metrics.push(metric);
    },
    getConfig: <T>() => config as T,
    requestTimelineReset: () => null,
  };

  function toRuntimeEvent(event: RuntimeEventInput): RuntimeEvent {
    return {
      ...event,
      seq: seq += 1n,
      timelineId: 'timeline-test',
      tsMonoMs: sessionMs,
      sourcePluginId: 'external-ui',
    } as RuntimeEvent;
  }

  return {
    ctx,
    emitted,
    metrics,
    timers,
    advanceSession(ms: number) {
      sessionMs += ms;
    },
    async dispatch(event: RuntimeEventInput) {
      await shapeGeneratorAdapter.onEvent(toRuntimeEvent(event), ctx);
    },
    async tick(timerId: string) {
      const timerEvent = timers.get(timerId);
      if (!timerEvent) {
        throw new Error(`Timer ${timerId} не зарегистрирован`);
      }
      await shapeGeneratorAdapter.onEvent(toRuntimeEvent(timerEvent()), ctx);
    },
  };
}

function lastAdapterState(
  events: RuntimeEventInput[],
  adapterId: string,
): RuntimeEventInputOf<typeof EventTypes.adapterStateChanged, 1>['payload'] | undefined {
  const last = [...events]
    .reverse()
    .find((event) => event.type === EventTypes.adapterStateChanged && event.payload.adapterId === adapterId);
  return last?.type === EventTypes.adapterStateChanged ? last.payload : undefined;
}
