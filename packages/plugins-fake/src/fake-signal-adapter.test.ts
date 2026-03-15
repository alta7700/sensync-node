import { describe, expect, it } from 'vitest';
import {
  EventTypes,
  type PluginMetric,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import fakeSignalAdapter from './fake-signal-adapter.ts';

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  metrics: PluginMetric[];
  timers: Map<string, () => RuntimeEventInput>;
  advanceSession(ms: number): void;
  dispatch(event: RuntimeEventInput): Promise<void>;
  tick(timerId: string): Promise<void>;
}

describe('fake-signal-adapter', () => {
  it('автоподключается только после runtime.started и эмитит ожидаемые uniform batch', async () => {
    const harness = createHarness({
      sampleRateHz: 200,
      batchMs: 50,
      compareSampleRateHz: 200,
      compareBatchMs: 50,
    });

    await fakeSignalAdapter.onInit(harness.ctx);

    expect(lastAdapterState(harness.emitted, 'fake')?.state).toBe('disconnected');
    expect(harness.timers.has('fake.scheduler')).toBe(false);

    await harness.dispatch({
      type: EventTypes.runtimeStarted,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {},
    });

    expect(lastAdapterState(harness.emitted, 'fake')?.state).toBe('connected');
    expect(harness.timers.has('fake.scheduler')).toBe(true);

    harness.advanceSession(50);
    await harness.tick('fake.scheduler');

    const signalEvents = harness.emitted.filter((event) => event.type === EventTypes.signalBatch);
    expect(signalEvents).toHaveLength(3);
    expect(signalEvents.map((event) => event.payload.streamId).sort()).toEqual(['fake.a1', 'fake.a2', 'fake.b']);

    const firstSignal = signalEvents[0] as RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>;
    expect(firstSignal.payload.frameKind).toBe('uniform-signal-batch');
    expect(firstSignal.payload.sampleFormat).toBe('f32');
    expect(firstSignal.payload.sampleCount).toBe(10);
    expect(firstSignal.payload.units).toBe('a.u.');
  });

  it('останавливает автостартовый поток по disconnect request', async () => {
    const harness = createHarness({
      sampleRateHz: 200,
      batchMs: 50,
    });

    await fakeSignalAdapter.onInit(harness.ctx);
    await harness.dispatch({
      type: EventTypes.runtimeStarted,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {},
    });
    await harness.dispatch({
      type: EventTypes.adapterDisconnectRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'fake',
        requestId: 'req-1',
      },
    });

    expect(lastAdapterState(harness.emitted, 'fake')).toEqual({
      adapterId: 'fake',
      state: 'disconnected',
      requestId: 'req-1',
    });
    expect(harness.timers.has('fake.scheduler')).toBe(false);
  });
});

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 1n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];
  const metrics: PluginMetric[] = [];
  const timers = new Map<string, () => RuntimeEventInput>();

  const ctx: PluginContext = {
    pluginId: 'fake-signal-adapter',
    clock: {
      nowSessionMs: () => sessionMs,
      sessionStartWallMs: () => 1_700_000_000_000,
    },
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
  };

  function toRuntimeEvent(event: RuntimeEventInput): RuntimeEvent {
    return {
      ...event,
      seq: seq += 1n,
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
      await fakeSignalAdapter.onEvent(toRuntimeEvent(event), ctx);
    },
    async tick(timerId: string) {
      const timerEvent = timers.get(timerId);
      if (!timerEvent) {
        throw new Error(`Timer ${timerId} не зарегистрирован`);
      }
      await fakeSignalAdapter.onEvent(toRuntimeEvent(timerEvent()), ctx);
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
