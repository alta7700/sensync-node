import { describe, expect, it } from 'vitest';
import {
  EventTypes,
  type PluginMetric,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import antPlusAdapter from './ant-plus-adapter.ts';

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  metrics: PluginMetric[];
  timers: Map<string, () => RuntimeEventInput>;
  advanceSession(ms: number): void;
  dispatch(event: RuntimeEventInput): Promise<void>;
  tick(timerId: string): Promise<void>;
}

describe('ant-plus-adapter', () => {
  it('публикует scan candidates только с opaque candidateId и подключается по нему', async () => {
    const harness = createHarness({
      adapterId: 'ant-plus',
      mode: 'fake',
      stickPresent: true,
      scanDelayMs: 1,
      packetIntervalMs: 250,
      measurementIntervalMs: 250,
    });

    await antPlusAdapter.onInit(harness.ctx);
    await harness.dispatch({
      type: EventTypes.adapterScanRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'ant-plus',
        formData: { profile: 'muscle-oxygen' },
        requestId: 'scan-1',
      },
    });

    const candidatesEvent = harness.emitted.find((event) => event.type === EventTypes.adapterScanCandidates);
    expect(candidatesEvent?.type).toBe(EventTypes.adapterScanCandidates);
    if (candidatesEvent?.type !== EventTypes.adapterScanCandidates) {
      throw new Error('Ожидался adapter.scan.candidates');
    }

    const candidate = candidatesEvent.payload.candidates[0];
    expect(candidate?.connectFormData).toEqual({ candidateId: candidate?.candidateId });
    expect(candidate?.candidateId).toMatch(/^ant-plus-scan-\d+-candidate-\d+$/);

    await harness.dispatch({
      type: EventTypes.adapterConnectRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'ant-plus',
        requestId: 'connect-1',
        formData: {
          candidateId: candidate?.candidateId,
        },
      },
    });

    expect(lastAdapterState(harness.emitted, 'ant-plus')).toEqual({
      adapterId: 'ant-plus',
      state: 'connected',
      requestId: 'connect-1',
    });
    expect(harness.timers.has('ant-plus.poll')).toBe(true);
  });

  it('публикует moxy потоки после fake connect и packet poll', async () => {
    const harness = createHarness({
      adapterId: 'ant-plus',
      mode: 'fake',
      stickPresent: true,
      scanDelayMs: 1,
      packetIntervalMs: 250,
      measurementIntervalMs: 250,
    });

    await antPlusAdapter.onInit(harness.ctx);
    await harness.dispatch({
      type: EventTypes.adapterScanRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'ant-plus',
        formData: { profile: 'muscle-oxygen' },
      },
    });
    const candidatesEvent = (
      harness.emitted.find((event) => event.type === EventTypes.adapterScanCandidates)
    ) as RuntimeEventInputOf<typeof EventTypes.adapterScanCandidates, 1>;
    const candidate = candidatesEvent.payload.candidates[0];

    await harness.dispatch({
      type: EventTypes.adapterConnectRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'ant-plus',
        formData: {
          candidateId: candidate?.candidateId,
        },
      },
    });

    harness.advanceSession(250);
    await harness.tick('ant-plus.poll');

    const signalEvents = harness.emitted.filter((event) => event.type === EventTypes.signalBatch);
    expect(signalEvents).toHaveLength(2);
    expect(signalEvents.map((event) => event.payload.streamId).sort()).toEqual(['moxy.smo2', 'moxy.thb']);
    expect(signalEvents.every((event) => event.payload.frameKind === 'uniform-signal-batch')).toBe(true);
  });
});

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 1n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];
  const metrics: PluginMetric[] = [];
  const timers = new Map<string, () => RuntimeEventInput>();

  const ctx: PluginContext = {
    pluginId: 'ant-plus-adapter',
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
    const nextSeq = seq;
    seq += 1n;
    return {
      ...event,
      seq: nextSeq,
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
      await antPlusAdapter.onEvent(toRuntimeEvent(event), ctx);
    },
    async tick(timerId: string) {
      const timerEvent = timers.get(timerId);
      if (!timerEvent) {
        throw new Error(`Timer ${timerId} не зарегистрирован`);
      }
      await antPlusAdapter.onEvent(toRuntimeEvent(timerEvent()), ctx);
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
