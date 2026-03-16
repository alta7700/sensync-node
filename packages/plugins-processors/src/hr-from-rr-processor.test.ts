import { afterEach, describe, expect, it } from 'vitest';
import {
  defineRuntimeEventInput,
  EventTypes,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import hrFromRrProcessor from './hr-from-rr-processor.ts';

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
    pluginId: 'hr-from-rr-processor',
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
      await hrFromRrProcessor.onEvent(toRuntimeEvent(event), ctx);
    },
  };
}

afterEach(async () => {
  const harness = createHarness({});
  await hrFromRrProcessor.onShutdown(harness.ctx);
});

describe('hr-from-rr-processor', () => {
  it('подписывается на exact RR stream и пропускает невалидные irregular samples', async () => {
    const harness = createHarness({
      sourceStreamId: 'rr.input',
      outputStreamId: 'hr.output',
      medianWindowSize: 1,
      emaAlpha: 1,
    });

    await hrFromRrProcessor.onInit(harness.ctx);

    expect(hrFromRrProcessor.manifest.subscriptions).toEqual([
      {
        type: EventTypes.signalBatch,
        v: 1,
        kind: 'data',
        priority: 'data',
        filter: { streamId: 'rr.input' },
      },
    ]);

    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'rr.input',
        sampleFormat: 'f32',
        frameKind: 'irregular-signal-batch',
        t0Ms: 1000,
        sampleCount: 3,
        values: new Float32Array([1.0, 0.2, 0.75]),
        timestampsMs: new Float64Array([1000, 1300, 2050]),
      },
    }));

    const outputEvent = harness.emitted[0] as RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>;
    expect(outputEvent.payload.streamId).toBe('hr.output');
    expect(outputEvent.payload.units).toBe('bpm');
    expect(outputEvent.payload.frameKind).toBe('irregular-signal-batch');
    expect(Array.from(outputEvent.payload.values)).toEqual([60, 80]);
    expect(Array.from(outputEvent.payload.timestampsMs ?? new Float64Array())).toEqual([1000, 2050]);
  });

  it('сохраняет uniform timeline, если валидны все samples', async () => {
    const harness = createHarness({
      sourceStreamId: 'rr.input',
      outputStreamId: 'hr.output',
      medianWindowSize: 1,
      emaAlpha: 1,
    });

    await hrFromRrProcessor.onInit(harness.ctx);

    await harness.dispatch(defineRuntimeEventInput({
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
        sampleCount: 2,
        values: new Float32Array([1.0, 0.5]),
      },
    }));

    const outputEvent = harness.emitted[0] as RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>;
    expect(outputEvent.payload.frameKind).toBe('uniform-signal-batch');
    expect(outputEvent.payload.t0Ms).toBe(0);
    expect(outputEvent.payload.dtMs).toBe(1000);
    expect(Array.from(outputEvent.payload.values)).toEqual([60, 120]);
  });

  it('понижает uniform batch до irregular, если часть RR отфильтрована', async () => {
    const harness = createHarness({
      sourceStreamId: 'rr.input',
      outputStreamId: 'hr.output',
      medianWindowSize: 1,
      emaAlpha: 1,
    });

    await hrFromRrProcessor.onInit(harness.ctx);

    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'rr.input',
        sampleFormat: 'f32',
        frameKind: 'uniform-signal-batch',
        t0Ms: 500,
        dtMs: 1000,
        sampleCount: 3,
        values: new Float32Array([1.0, 0.2, 0.75]),
      },
    }));

    const outputEvent = harness.emitted[0] as RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>;
    expect(outputEvent.payload.frameKind).toBe('irregular-signal-batch');
    expect(Array.from(outputEvent.payload.values)).toEqual([60, 80]);
    expect(Array.from(outputEvent.payload.timestampsMs ?? new Float64Array())).toEqual([500, 2500]);
  });
});
