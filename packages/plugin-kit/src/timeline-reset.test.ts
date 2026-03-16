import { describe, expect, it } from 'vitest';
import { createTimelineResetParticipant, clipSignalBatchToTimelineStart } from './timeline-reset.ts';
import type { PluginContext } from '@sensync2/plugin-sdk';
import { defineRuntimeEventInput } from '@sensync2/core';

function createTestContext() {
  const emitted: unknown[] = [];
  const ctx: PluginContext = {
    pluginId: 'timeline-reset-test',
    clock: {
      nowSessionMs: () => 0,
      sessionStartWallMs: () => 0,
    },
    currentTimelineId: () => 'timeline-a',
    timelineStartSessionMs: () => 0,
    emit: async (event) => {
      emitted.push(event);
    },
    setTimer: () => {},
    clearTimer: () => {},
    telemetry: () => {},
    getConfig: <T>() => undefined as T,
    requestTimelineReset: () => {},
  };

  return { ctx, emitted };
}

describe('timeline-reset helpers', () => {
  it('ведёт participant через prepare -> abort -> commit lifecycle', async () => {
    const lifecycle: string[] = [];
    const { ctx, emitted } = createTestContext();
    const participant = createTimelineResetParticipant({
      resources: [{
        prepare: () => {
          lifecycle.push('resource.prepare');
        },
        abort: () => {
          lifecycle.push('resource.abort');
        },
        commit: () => {
          lifecycle.push('resource.commit');
        },
      }],
      onPrepare: () => {
        lifecycle.push('prepare');
      },
      onAbort: () => {
        lifecycle.push('abort');
      },
      onCommit: () => {
        lifecycle.push('commit');
      },
    });

    participant.initialize('timeline-a');
    const guardedEmit = participant.bindEmit(ctx);

    await participant.onPrepare({
      resetId: 'reset-1',
      currentTimelineId: 'timeline-a',
      nextTimelineId: 'timeline-b',
      requestedAtSessionMs: 100,
    }, ctx);
    await expect(guardedEmit(defineRuntimeEventInput({
      type: 'activity.state.changed',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { active: true },
    }))).rejects.toThrow(/prepare/);

    await participant.onAbort({
      resetId: 'reset-1',
      currentTimelineId: 'timeline-a',
    }, ctx);
    await guardedEmit(defineRuntimeEventInput({
      type: 'activity.state.changed',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { active: true },
    }));

    await participant.onPrepare({
      resetId: 'reset-2',
      currentTimelineId: 'timeline-a',
      nextTimelineId: 'timeline-b',
      requestedAtSessionMs: 200,
    }, ctx);
    await participant.onCommit({
      resetId: 'reset-2',
      nextTimelineId: 'timeline-b',
      timelineStartSessionMs: 250,
    }, ctx);

    expect(lifecycle).toEqual([
      'resource.prepare',
      'prepare',
      'resource.abort',
      'abort',
      'resource.prepare',
      'prepare',
      'resource.commit',
      'commit',
    ]);
    expect(participant.currentTimelineId()).toBe('timeline-b');
    expect(participant.phase()).toBe('running');
    expect(emitted).toHaveLength(1);
  });

  it('режет uniform батч по timeline cutoff и сохраняет uniform семантику', () => {
    const clipped = clipSignalBatchToTimelineStart({
      streamId: 'fake.a2',
      sampleFormat: 'f32',
      frameKind: 'uniform-signal-batch',
      t0Ms: 100,
      dtMs: 10,
      sampleRateHz: 100,
      sampleCount: 5,
      values: new Float32Array([1, 2, 3, 4, 5]),
    }, 125);

    expect(clipped.kind).toBe('keep');
    if (clipped.kind !== 'keep') {
      throw new Error('Ожидался keep');
    }
    expect(clipped.payload.frameKind).toBe('uniform-signal-batch');
    expect(clipped.payload.t0Ms).toBe(130);
    expect(clipped.payload.sampleCount).toBe(2);
    expect(Array.from(clipped.payload.values)).toEqual([4, 5]);
    expect(clipped.payload.sampleRateHz).toBe(100);
  });

  it('режет label батч по timestamps и не тянет sampleRateHz в новый payload', () => {
    const clipped = clipSignalBatchToTimelineStart({
      streamId: 'interval.label',
      sampleFormat: 'i16',
      frameKind: 'label-batch',
      t0Ms: 100,
      sampleCount: 3,
      values: new Int16Array([1, 0, 1]),
      timestampsMs: new Float64Array([100, 200, 300]),
      sampleRateHz: 999,
    }, 150);

    expect(clipped.kind).toBe('keep');
    if (clipped.kind !== 'keep') {
      throw new Error('Ожидался keep');
    }
    expect(clipped.payload.frameKind).toBe('label-batch');
    expect(clipped.payload.t0Ms).toBe(200);
    expect(Array.from(clipped.payload.values)).toEqual([0, 1]);
    expect(Array.from(clipped.payload.timestampsMs ?? new Float64Array())).toEqual([200, 300]);
    expect(clipped.payload.sampleRateHz).toBeUndefined();
  });
});
