import { describe, expect, it } from 'vitest';
import {
  attachRuntimeEventEnvelope,
  defineRuntimeEventInput,
  EventTypes,
} from '@sensync2/core';
import { factInput, signalInput, createInputMap } from './input-map.ts';
import { createInputRuntime } from './input-runtime.ts';

describe('input-runtime', () => {
  it('роутит signal и fact в нужные store', () => {
    const runtime = createInputRuntime(createInputMap({
      source: signalInput({
        streamId: 'fake.a2',
        retain: { by: 'samples', value: 100 },
      }),
      interval: factInput({
        event: { type: 'interval.state.changed', v: 1 },
      }),
    }));

    const signalUpdated = runtime.route(attachRuntimeEventEnvelope(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'fake.a2',
        sampleFormat: 'f32',
        frameKind: 'uniform-signal-batch',
        t0Ms: 0,
        dtMs: 10,
        sampleCount: 2,
        values: new Float32Array([1, 2]),
      },
    }), 1n, 0, 'external-ui'));
    const factUpdated = runtime.route(attachRuntimeEventEnvelope(defineRuntimeEventInput({
      type: 'interval.state.changed',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { active: true },
    }), 2n, 0, 'external-ui'));

    expect(signalUpdated).toEqual(['source']);
    expect(factUpdated).toEqual(['interval']);
    expect(runtime.signal('source').sampleCount()).toBe(2);
    expect(runtime.fact('interval').latestPayload()).toEqual({ active: true });
  });

  it('ошибается при доступе не к тому типу input', () => {
    const runtime = createInputRuntime(createInputMap({
      source: signalInput({
        streamId: 'fake.a2',
        retain: { by: 'samples', value: 100 },
      }),
    }));

    expect(() => runtime.fact('source')).toThrow(/не является fact input/);
  });
});
