import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventTypes,
  type PluginMetric,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import zephyrBioHarnessAdapter from './zephyr-bioharness-3-adapter.ts';

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  metrics: PluginMetric[];
  clock: {
    nowSessionMs: () => number;
    sessionStartWallMs: () => number;
  };
  advanceSession(ms: number): void;
  tickPoll(): Promise<void>;
  dispatch(event: RuntimeEventInput): Promise<void>;
}

describe('zephyr-bioharness-3-adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('проходит fake lifecycle scan -> connect -> disconnect', async () => {
    const harness = createHarness({
      adapterId: 'zephyr-bioharness',
      mode: 'fake',
      scanTimeoutMs: 500,
      fakePacketIntervalMs: 100,
    });

    await zephyrBioHarnessAdapter.onInit(harness.ctx);

    const scanPromise = harness.dispatch({
      type: EventTypes.adapterScanRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'zephyr-bioharness',
        timeoutMs: 500,
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    await scanPromise;

    const candidatesEvent = harness.emitted.find((event) => event.type === EventTypes.adapterScanCandidates);
    expect(candidatesEvent).toBeDefined();

    const candidate = (candidatesEvent as RuntimeEventInputOf<'adapter.scan.candidates', 1>).payload.candidates[0];
    await harness.dispatch({
      type: EventTypes.adapterConnectRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'zephyr-bioharness',
        formData: {
          candidateId: candidate?.candidateId,
          ...candidate?.connectFormData,
        },
      },
    });

    expect(lastAdapterState(harness.emitted, 'zephyr-bioharness')?.state).toBe('connected');

    await vi.advanceTimersByTimeAsync(100);
    harness.advanceSession(100);
    await harness.tickPoll();
    const rrEvent = harness.emitted.find((event) => event.type === EventTypes.signalBatch);
    expect(rrEvent?.type).toBe(EventTypes.signalBatch);
    if (rrEvent?.type === EventTypes.signalBatch) {
      expect(rrEvent.payload.streamId).toBe('zephyr.rr');
      expect(rrEvent.payload.sampleCount).toBeGreaterThan(0);
    }

    await harness.dispatch({
      type: EventTypes.adapterDisconnectRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'zephyr-bioharness',
      },
    });

    expect(lastAdapterState(harness.emitted, 'zephyr-bioharness')?.state).toBe('disconnected');
  });

  it('переподключается после fake BLE disconnect', async () => {
    const harness = createHarness({
      adapterId: 'zephyr-bioharness',
      mode: 'fake',
      scanTimeoutMs: 500,
      autoReconnect: true,
      reconnectRetryDelayMs: 250,
      fakePacketIntervalMs: 100,
      fakeAutoDisconnectAfterMs: 300,
    });

    await zephyrBioHarnessAdapter.onInit(harness.ctx);

    const scanPromise = harness.dispatch({
      type: EventTypes.adapterScanRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'zephyr-bioharness',
        timeoutMs: 500,
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    await scanPromise;

    const candidatesEvent = harness.emitted.find((event) => event.type === EventTypes.adapterScanCandidates);
    const candidate = (candidatesEvent as RuntimeEventInputOf<'adapter.scan.candidates', 1>).payload.candidates[0];

    await harness.dispatch({
      type: EventTypes.adapterConnectRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'zephyr-bioharness',
        formData: {
          candidateId: candidate?.candidateId,
          ...candidate?.connectFormData,
        },
      },
    });

    await vi.advanceTimersByTimeAsync(300);
    harness.advanceSession(300);
    await harness.tickPoll();
    expect(lastAdapterState(harness.emitted, 'zephyr-bioharness')?.state).toBe('connecting');

    harness.advanceSession(250);
    await harness.tickPoll();
    expect(lastAdapterState(harness.emitted, 'zephyr-bioharness')?.state).toBe('connected');
  });
});

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 1n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];
  const metrics: PluginMetric[] = [];
  const timers = new Map<string, () => RuntimeEventInput>();

  const ctx: PluginContext = {
    pluginId: 'zephyr-bioharness-3-adapter',
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
    requestTimelineReset: () => {},
  };

  function toRuntimeEvent(event: RuntimeEventInput): RuntimeEvent {
    return {
      ...event,
      seq: seq++,
      timelineId: 'timeline-test',
      tsMonoMs: sessionMs,
      sourcePluginId: 'external-ui',
    } as RuntimeEvent;
  }

  return {
    ctx,
    emitted,
    metrics,
    clock: ctx.clock,
    advanceSession(ms: number) {
      sessionMs += ms;
    },
    async tickPoll() {
      const timerEvent = timers.get('zephyr-bioharness.poll');
      if (!timerEvent) {
        throw new Error('Timer zephyr-bioharness.poll не зарегистрирован');
      }
      await zephyrBioHarnessAdapter.onEvent(toRuntimeEvent(timerEvent()), ctx);
    },
    async dispatch(event: RuntimeEventInput) {
      await zephyrBioHarnessAdapter.onEvent(toRuntimeEvent(event), ctx);
    },
  };
}

function lastAdapterState(
  events: RuntimeEventInput[],
  adapterId: string,
): RuntimeEventInputOf<'adapter.state.changed', 1>['payload'] | undefined {
  const last = [...events]
    .reverse()
    .find((event) => event.type === EventTypes.adapterStateChanged && event.payload.adapterId === adapterId);
  return last?.type === EventTypes.adapterStateChanged ? last.payload : undefined;
}
