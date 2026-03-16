import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EventTypes,
  type PluginMetric,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import { TrignoEventTypes, type TrignoStatusSnapshot } from './trigno-boundary.ts';

const sessionControl = vi.hoisted(() => {
  const snapshot: TrignoStatusSnapshot = {
    host: '10.9.15.71',
    sensorSlot: 1,
    banner: 'Delsys Trigno System Digital Protocol Version 3.6.0',
    protocolVersion: '3.6.0',
    paired: true,
    mode: 7,
    startIndex: 1,
    channelCount: 4,
    emgChannelCount: 1,
    auxChannelCount: 3,
    backwardsCompatibility: false,
    upsampling: false,
    frameInterval: 0.0135,
    maxSamplesEmg: 26,
    maxSamplesAux: 2,
    serial: 'SP-W02C-1759',
    firmware: '3.6.0',
    emg: {
      rateHz: 1925.92592592593,
      samplesPerFrame: 26,
      units: 'V',
      gain: 300,
    },
    gyro: {
      rateHz: 148.148148148148,
      samplesPerFrame: 2,
      units: 'deg/s',
      gain: 16.4,
    },
  };

  interface FakeSession {
    connect(): Promise<void>;
    applyProfileConfig(): Promise<void>;
    queryStatus(): Promise<TrignoStatusSnapshot>;
    openDataSockets(): Promise<void>;
    setDataCallbacks(callbacks: {
      onEmgSamples?: (values: Float32Array) => void;
      onGyroSamples?: (samples: { x: Float32Array; y: Float32Array; z: Float32Array }) => void;
    }): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    close(): Promise<void>;
    takeDisconnectReason(): string | null;
    emitEmg(values: Float32Array): void;
    emitGyro(samples: { x: Float32Array; y: Float32Array; z: Float32Array }): void;
    setDisconnectReason(reason: string | null): void;
  }

  let sessions: FakeSession[] = [];
  let nextDisconnectReason: string | null = null;

  class MockTrignoTcpSession implements FakeSession {
    private callbacks: {
      onEmgSamples?: (values: Float32Array) => void;
      onGyroSamples?: (samples: { x: Float32Array; y: Float32Array; z: Float32Array }) => void;
    } = {};

    private disconnectReason: string | null = null;

    constructor(_options: unknown) {
      this.disconnectReason = nextDisconnectReason;
      nextDisconnectReason = null;
      sessions.push(this);
    }

    async connect(): Promise<void> {}
    async applyProfileConfig(): Promise<void> {}
    async queryStatus(): Promise<TrignoStatusSnapshot> {
      return structuredClone(snapshot);
    }
    async openDataSockets(): Promise<void> {}
    setDataCallbacks(callbacks: {
      onEmgSamples?: (values: Float32Array) => void;
      onGyroSamples?: (samples: { x: Float32Array; y: Float32Array; z: Float32Array }) => void;
    }): void {
      this.callbacks = callbacks;
    }
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async close(): Promise<void> {}
    takeDisconnectReason(): string | null {
      const reason = this.disconnectReason;
      this.disconnectReason = null;
      return reason;
    }
    emitEmg(values: Float32Array): void {
      this.callbacks.onEmgSamples?.(values);
    }
    emitGyro(samples: { x: Float32Array; y: Float32Array; z: Float32Array }): void {
      this.callbacks.onGyroSamples?.(samples);
    }
    setDisconnectReason(reason: string | null): void {
      this.disconnectReason = reason;
    }
  }

  return {
    MockTrignoTcpSession,
    getLatestSession(): FakeSession | null {
      return sessions.at(-1) ?? null;
    },
    reset(): void {
      sessions = [];
      nextDisconnectReason = null;
    },
  };
});

vi.mock('./trigno-transport.ts', () => {
  return {
    TrignoTcpSession: sessionControl.MockTrignoTcpSession,
  };
});

const { default: trignoAdapter } = await import('./trigno-adapter.ts');

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  metrics: PluginMetric[];
  timers: Map<string, () => RuntimeEventInput>;
  advanceSession(ms: number): void;
  dispatch(event: RuntimeEventInput): Promise<void>;
  tick(timerId: string): Promise<void>;
}

describe('trigno-adapter', () => {
  afterEach(async () => {
    sessionControl.reset();
  });

  it('проходит lifecycle connect -> paused -> start и публикует EMG/Gyro потоки', async () => {
    const harness = createHarness({
      adapterId: 'trigno',
      backwardsCompatibility: false,
      upsampling: false,
      pollIntervalMs: 250,
      reconnectRetryDelayMs: 250,
      connectCooldownMs: 0,
    });

    await trignoAdapter.onInit(harness.ctx);
    await harness.dispatch({
      type: EventTypes.adapterConnectRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'trigno',
        requestId: 'connect-1',
        formData: {
          host: '10.9.15.71',
          sensorSlot: 1,
        },
      },
    });

    expect(lastAdapterState(harness.emitted, 'trigno')?.state).toBe('paused');

    await harness.dispatch({
      type: TrignoEventTypes.streamStartRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'trigno',
        requestId: 'start-1',
      },
    });

    expect(lastAdapterState(harness.emitted, 'trigno')).toEqual({
      adapterId: 'trigno',
      state: 'connected',
      requestId: 'start-1',
    });

    const session = sessionControl.getLatestSession();
    if (!session) {
      throw new Error('Ожидалась Trigno session');
    }

    session.emitEmg(new Float32Array([1, 2, 3]));
    session.emitGyro({
      x: new Float32Array([0.1, 0.2]),
      y: new Float32Array([0.3, 0.4]),
      z: new Float32Array([0.5, 0.6]),
    });
    await Promise.resolve();

    const signalEvents = harness.emitted.filter((event) => event.type === EventTypes.signalBatch);
    expect(signalEvents).toHaveLength(4);
    expect(signalEvents.map((event) => event.payload.streamId).sort()).toEqual([
      'trigno.avanti',
      'trigno.avanti.gyro.x',
      'trigno.avanti.gyro.y',
      'trigno.avanti.gyro.z',
    ]);
  });

  it('переподключается после disconnect signal во время active stream', async () => {
    const harness = createHarness({
      adapterId: 'trigno',
      backwardsCompatibility: false,
      upsampling: false,
      pollIntervalMs: 250,
      reconnectRetryDelayMs: 250,
      connectCooldownMs: 0,
    });

    await trignoAdapter.onInit(harness.ctx);
    await harness.dispatch({
      type: EventTypes.adapterConnectRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'trigno',
        formData: {
          host: '10.9.15.71',
          sensorSlot: 1,
        },
      },
    });
    await harness.dispatch({
      type: TrignoEventTypes.streamStartRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        adapterId: 'trigno',
      },
    });

    const session = sessionControl.getLatestSession();
    if (!session) {
      throw new Error('Ожидалась Trigno session');
    }
    session.setDisconnectReason('socket closed');

    await harness.tick('trigno.poll');
    expect(lastAdapterState(harness.emitted, 'trigno')?.state).toBe('connecting');

    harness.advanceSession(250);
    await harness.tick('trigno.poll');
    expect(lastAdapterState(harness.emitted, 'trigno')?.state).toBe('connected');
  });
});

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 1n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];
  const metrics: PluginMetric[] = [];
  const timers = new Map<string, () => RuntimeEventInput>();

  const ctx: PluginContext = {
    pluginId: 'trigno-adapter',
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
    const nextSeq = seq;
    seq += 1n;
    return {
      ...event,
      seq: nextSeq,
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
      await trignoAdapter.onEvent(toRuntimeEvent(event), ctx);
    },
    async tick(timerId: string) {
      const timerEvent = timers.get(timerId);
      if (!timerEvent) {
        throw new Error(`Timer ${timerId} не зарегистрирован`);
      }
      await trignoAdapter.onEvent(toRuntimeEvent(timerEvent()), ctx);
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
