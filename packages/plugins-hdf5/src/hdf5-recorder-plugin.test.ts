import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defineRuntimeEventInput,
  EventTypes,
  type PluginMetric,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type {
  PluginContext,
  TimelineResetRequestResultContext,
} from '@sensync2/plugin-sdk';
import hdf5RecorderPlugin from './hdf5-recorder-plugin.ts';

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  metrics: PluginMetric[];
  requestedResets: string[];
  resetRequestIds: string[];
  tempDir: string;
  setSessionMs(value: number): void;
  dispatch(event: RuntimeEventInput): Promise<void>;
  resolveReset(input?: Partial<TimelineResetRequestResultContext>): Promise<void>;
}

let activeHarness: TestHarness | null = null;

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 0n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];
  const metrics: PluginMetric[] = [];
  const requestedResets: string[] = [];
  const resetRequestIds: string[] = [];
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-hdf5-recorder-'));

  const ctx: PluginContext = {
    pluginId: 'hdf5-recorder',
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
    telemetry: (metric) => {
      metrics.push(metric);
    },
    getConfig: <T>() => ({
      writerKey: 'local',
      outputDir: tempDir,
      defaultFilenameTemplate: '{writer}-{startDateTime}',
      ...config,
    }) as T,
    requestTimelineReset: (reason) => {
      requestedResets.push(reason ?? '');
      const requestId = `reset-request-${requestedResets.length}`;
      resetRequestIds.push(requestId);
      return requestId;
    },
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
    metrics,
    requestedResets,
    resetRequestIds,
    tempDir,
    setSessionMs(value) {
      sessionMs = value;
    },
    async dispatch(event) {
      await hdf5RecorderPlugin.onEvent(toRuntimeEvent(event), ctx);
    },
    async resolveReset(input) {
      await hdf5RecorderPlugin.onTimelineResetRequestResult?.({
        requestId: resetRequestIds.at(-1) ?? 'reset-request-1',
        status: 'succeeded',
        code: 'timeline_reset_succeeded',
        message: 'Timeline reset завершён',
        resetId: 'reset-1',
        nextTimelineId: 'timeline-next',
        timelineStartSessionMs: 500,
        ...input,
      }, ctx);
    },
  };
}

function recordingStartEvent(requestId = 'start-1'): RuntimeEventInput {
  return defineRuntimeEventInput({
    type: EventTypes.recordingStart,
    v: 1,
    kind: 'command',
    priority: 'control',
    payload: {
      writer: 'local',
      filenameTemplate: '{writer}-{startDateTime}',
      requestId,
      channels: [
        {
          streamId: 'zephyr.rr',
          minSamples: 1,
          maxBufferedMs: 100,
        },
      ],
    },
  });
}

afterEach(async () => {
  if (activeHarness) {
    await hdf5RecorderPlugin.onShutdown(activeHarness.ctx);
  }
  activeHarness = null;
});

describe('hdf5-recorder-plugin', () => {
  it('materializeит manifest из config и открывает файл только после глобального успеха reset', async () => {
    const harness = createHarness({
      required: true,
      resetTimelineOnStart: true,
      startConditions: {
        checks: [
          {
            kind: 'fact-field',
            event: { type: EventTypes.adapterStateChanged, v: 1 },
            where: { adapterId: 'zephyr-bioharness' },
            field: 'state',
            eq: 'connected',
            message: 'Zephyr должен быть подключён',
          },
        ],
      },
    });
    activeHarness = harness;

    await hdf5RecorderPlugin.onInit(harness.ctx);

    expect(hdf5RecorderPlugin.manifest.required).toBe(true);
    expect(hdf5RecorderPlugin.manifest.subscriptions).toContainEqual({
      type: EventTypes.adapterStateChanged,
      v: 1,
      kind: 'fact',
    });

    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.adapterStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        adapterId: 'zephyr-bioharness',
        state: 'connected',
      },
    }));

    harness.emitted.length = 0;
    await harness.dispatch(recordingStartEvent());

    expect(harness.requestedResets).toEqual(['recording.start:local']);
    expect(lastRecordingState(harness.emitted)?.state).toBe('starting');
    expect(harness.emitted.some((event) => event.type === EventTypes.recordingError)).toBe(false);

    await hdf5RecorderPlugin.onTimelineResetCommit?.({
      resetId: 'reset-1',
      nextTimelineId: 'timeline-next',
      timelineStartSessionMs: 750,
    }, harness.ctx);

    expect(lastRecordingState(harness.emitted)?.state).toBe('starting');

    await harness.resolveReset({ timelineStartSessionMs: 750 });

    expect(lastRecordingState(harness.emitted)).toMatchObject({
      writer: 'local',
      state: 'recording',
      requestId: 'start-1',
    });
  });

  it('после abort start-reset очищает pending flow и позволяет повторить start', async () => {
    const harness = createHarness({
      resetTimelineOnStart: true,
    });
    activeHarness = harness;

    await hdf5RecorderPlugin.onInit(harness.ctx);
    await harness.dispatch(recordingStartEvent('start-1'));
    await harness.resolveReset({
      status: 'aborted',
      code: 'timeline_reset_aborted',
      message: 'prepare failed',
      resetId: 'reset-1',
    });

    const rejected = [...harness.emitted]
      .reverse()
      .find((event) => event.type === EventTypes.commandRejected);
    expect(rejected).toMatchObject({
      type: EventTypes.commandRejected,
      payload: {
        commandType: EventTypes.recordingStart,
        code: 'timeline_reset_failed',
        requestId: 'start-1',
      },
    });
    expect(lastRecordingState(harness.emitted)).toMatchObject({
      writer: 'local',
      state: 'idle',
      requestId: 'start-1',
    });

    await harness.dispatch(recordingStartEvent('start-2'));
    expect(harness.requestedResets).toEqual(['recording.start:local', 'recording.start:local']);
  });

  it('после stop запускает best-effort reset и на abort остаётся idle', async () => {
    const harness = createHarness({
      resetTimelineOnStop: true,
    });
    activeHarness = harness;

    await hdf5RecorderPlugin.onInit(harness.ctx);
    await harness.dispatch(recordingStartEvent('start-1'));

    expect(lastRecordingState(harness.emitted)?.state).toBe('recording');

    harness.emitted.length = 0;
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.recordingStop,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        writer: 'local',
        requestId: 'stop-1',
      },
    }));

    expect(lastRecordingState(harness.emitted)).toMatchObject({
      writer: 'local',
      state: 'idle',
      requestId: 'stop-1',
    });
    expect(harness.requestedResets).toEqual(['recording.stop:local']);

    await harness.resolveReset({
      status: 'aborted',
      code: 'timeline_reset_aborted',
      message: 'prepare failed',
      resetId: 'reset-1',
    });

    const rejected = [...harness.emitted]
      .reverse()
      .find((event) => event.type === EventTypes.commandRejected);
    expect(rejected).toMatchObject({
      type: EventTypes.commandRejected,
      payload: {
        commandType: EventTypes.recordingStop,
        code: 'recording_stop_post_reset_failed',
        requestId: 'stop-1',
      },
    });
    expect(lastRecordingState(harness.emitted)?.state).toBe('idle');
  });

  it('на ранний reject reset-запроса не зависает в starting и позволяет повторить start', async () => {
    const harness = createHarness({
      resetTimelineOnStart: true,
    });
    activeHarness = harness;

    await hdf5RecorderPlugin.onInit(harness.ctx);
    await harness.dispatch(recordingStartEvent('start-1'));

    expect(lastRecordingState(harness.emitted)?.state).toBe('starting');

    await harness.resolveReset({
      status: 'rejected',
      code: 'timeline_reset_in_progress',
      message: 'Timeline reset можно запускать только из состояния RUNNING',
    });

    expect(lastRecordingState(harness.emitted)).toMatchObject({
      writer: 'local',
      state: 'idle',
      requestId: 'start-1',
    });

    await harness.dispatch(recordingStartEvent('start-2'));
    expect(harness.requestedResets).toEqual(['recording.start:local', 'recording.start:local']);
  });
});

function lastRecordingState(
  events: RuntimeEventInput[],
): RuntimeEventInputOf<typeof EventTypes.recordingStateChanged, 1>['payload'] | undefined {
  const last = [...events]
    .reverse()
    .find((event) => event.type === EventTypes.recordingStateChanged);
  return last?.type === EventTypes.recordingStateChanged ? last.payload : undefined;
}
