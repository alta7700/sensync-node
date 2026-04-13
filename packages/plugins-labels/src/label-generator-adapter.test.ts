import { afterEach, describe, expect, it } from 'vitest';
import {
  defineRuntimeEventInput,
  EventTypes,
  type PluginMetric,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import labelGeneratorAdapter from './label-generator-adapter.ts';

interface TestHarness {
  ctx: PluginContext;
  emitted: RuntimeEventInput[];
  metrics: PluginMetric[];
  setSessionMs(value: number): void;
  dispatch(event: RuntimeEventInput): Promise<void>;
}

function createHarness(config: Record<string, unknown>): TestHarness {
  let seq = 0n;
  let sessionMs = 0;
  const emitted: RuntimeEventInput[] = [];
  const metrics: PluginMetric[] = [];

  const ctx: PluginContext = {
    pluginId: 'label-generator-adapter',
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
    metrics,
    setSessionMs(value) {
      sessionMs = value;
    },
    async dispatch(event) {
      await labelGeneratorAdapter.onEvent(toRuntimeEvent(event), ctx);
    },
  };
}

afterEach(async () => {
  const harness = createHarness({ labels: { interval: { streamId: 'interval.label', sampleFormat: 'i16' } } });
  await labelGeneratorAdapter.onShutdown(harness.ctx);
});

describe('label-generator-adapter', () => {
  it('мапит labelId в configured streamId и использует atTimeMs', async () => {
    const harness = createHarness({
      labels: {
        interval: { streamId: 'interval.label', sampleFormat: 'i16' },
      },
    });

    await labelGeneratorAdapter.onInit(harness.ctx);
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.labelMarkRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        labelId: 'interval',
        value: 1,
        atTimeMs: 420,
      },
    }));

    const emitted = harness.emitted[0] as RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>;
    expect(emitted.payload.streamId).toBe('interval.label');
    expect(emitted.payload.frameKind).toBe('label-batch');
    expect(emitted.payload.sampleFormat).toBe('i16');
    expect(Array.from(emitted.payload.values)).toEqual([1]);
    expect(Array.from(emitted.payload.timestampsMs ?? new Float64Array())).toEqual([420]);
  });

  it('использует текущее session time, если atTimeMs не передан', async () => {
    const harness = createHarness({
      labels: {
        lactate: { streamId: 'lactate.label', sampleFormat: 'f32', units: 'mmol/L' },
      },
    });

    await labelGeneratorAdapter.onInit(harness.ctx);
    harness.setSessionMs(1337);
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.labelMarkRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: {
        labelId: 'lactate',
        value: 4.2,
      },
    }));

    const emitted = harness.emitted[0] as RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>;
    expect(emitted.payload.streamId).toBe('lactate.label');
    expect(emitted.payload.sampleFormat).toBe('f32');
    expect(emitted.payload.units).toBe('mmol/L');
    expect(emitted.payload.values[0]).toBeCloseTo(4.2, 5);
    expect(Array.from(emitted.payload.timestampsMs ?? new Float64Array())).toEqual([1337]);
  });

  it('проверяет монотонность отдельно для каждого labelId', async () => {
    const harness = createHarness({
      labels: {
        interval: { streamId: 'interval.label', sampleFormat: 'i16' },
        lactate: { streamId: 'lactate.label', sampleFormat: 'f32' },
      },
    });

    await labelGeneratorAdapter.onInit(harness.ctx);

    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.labelMarkRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: { labelId: 'interval', value: 1, atTimeMs: 100 },
    }));
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.labelMarkRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: { labelId: 'lactate', value: 3.5, atTimeMs: 50 },
    }));
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.labelMarkRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: { labelId: 'interval', value: 0, atTimeMs: 90 },
    }));

    expect(harness.emitted.filter((event) => event.type === EventTypes.signalBatch)).toHaveLength(2);
    expect(harness.emitted.find((event) => event.type === EventTypes.commandRejected)).toMatchObject({
      payload: {
        commandType: EventTypes.labelMarkRequest,
        commandVersion: 1,
        code: 'non_monotonic_timestamp',
        message: 'Метка "interval" пришла раньше предыдущей по session time',
        details: { labelId: 'interval' },
      },
    });
    expect(harness.metrics).toContainEqual({
      name: 'label_mark_rejected_total',
      value: 1,
      tags: { reason: 'non_monotonic_timestamp', labelId: 'interval' },
    });
  });

  it('не падает на неизвестном labelId и публикует command.rejected', async () => {
    const harness = createHarness({
      labels: {
        interval: { streamId: 'interval.label', sampleFormat: 'i16' },
      },
    });

    await labelGeneratorAdapter.onInit(harness.ctx);
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.labelMarkRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: { labelId: 'missing', value: 1, atTimeMs: 10 },
    }));

    expect(harness.emitted).toHaveLength(1);
    expect(harness.emitted[0]).toMatchObject({
      type: EventTypes.commandRejected,
      payload: {
        commandType: EventTypes.labelMarkRequest,
        commandVersion: 1,
        code: 'unknown_label',
        message: 'Label "missing" не найден в конфиге',
        details: { labelId: 'missing' },
      },
    });
    expect(harness.metrics).toContainEqual({
      name: 'label_mark_rejected_total',
      value: 1,
      tags: { reason: 'unknown_label', labelId: 'missing' },
    });
  });

  it('отклоняет нецелое значение для i16 label', async () => {
    const harness = createHarness({
      labels: {
        interval: { streamId: 'interval.label', sampleFormat: 'i16' },
      },
    });

    await labelGeneratorAdapter.onInit(harness.ctx);
    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.labelMarkRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: { labelId: 'interval', value: 1.5, atTimeMs: 10 },
    }));

    expect(harness.emitted).toHaveLength(1);
    expect(harness.emitted[0]).toMatchObject({
      type: EventTypes.commandRejected,
      payload: {
        commandType: EventTypes.labelMarkRequest,
        commandVersion: 1,
        code: 'invalid_value_for_sample_format',
        message: 'Значение 1.5 не помещается в sampleFormat "i16"',
        details: { labelId: 'interval' },
      },
    });
    expect(harness.metrics).toContainEqual({
      name: 'label_mark_rejected_total',
      value: 1,
      tags: { reason: 'invalid_value_for_sample_format', labelId: 'interval' },
    });
  });

  it('сбрасывает монотонность labelId после commit нового timeline', async () => {
    const harness = createHarness({
      labels: {
        lactate: { streamId: 'lactate.label', sampleFormat: 'f32' },
      },
    });

    await labelGeneratorAdapter.onInit(harness.ctx);

    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.labelMarkRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: { labelId: 'lactate', value: 1.1, atTimeMs: 165_000 },
    }));

    await labelGeneratorAdapter.onTimelineResetCommit?.({
      resetId: 'reset-1',
      nextTimelineId: 'timeline-next',
      timelineStartSessionMs: 500_000,
    }, harness.ctx);

    await harness.dispatch(defineRuntimeEventInput({
      type: EventTypes.labelMarkRequest,
      v: 1,
      kind: 'command',
      priority: 'control',
      payload: { labelId: 'lactate', value: 1.2, atTimeMs: 165_000 },
    }));

    expect(harness.emitted.filter((event) => event.type === EventTypes.signalBatch)).toHaveLength(2);
    expect(harness.emitted.find((event) => event.type === EventTypes.commandRejected)).toBeUndefined();
  });
});
