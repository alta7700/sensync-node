import { describe, expect, it } from 'vitest';
import {
  attachRuntimeEventEnvelope,
  defineRuntimeEventInput,
  EventTypes,
  type RuntimeEventOf,
} from '@sensync2/core';
import { signalInput } from './input-map.ts';
import { createSignalWindowStore } from './signal-window.ts';

function makeSignalEvent(payload: RuntimeEventOf<typeof EventTypes.signalBatch, 1>['payload']) {
  return attachRuntimeEventEnvelope(defineRuntimeEventInput({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    payload,
  }), 1n, 'timeline-test', 0, 'external-ui');
}

describe('signal-window', () => {
  it('держит uniform retention по samples и умеет брать latestSamples', () => {
    const store = createSignalWindowStore(signalInput({
      streamId: 'fake.a2',
      retain: { by: 'samples', value: 4 },
    }));

    store.push(makeSignalEvent({
      streamId: 'fake.a2',
      sampleFormat: 'f32',
      frameKind: 'uniform-signal-batch',
      t0Ms: 0,
      dtMs: 10,
      sampleCount: 3,
      values: new Float32Array([1, 2, 3]),
    }));
    store.push(makeSignalEvent({
      streamId: 'fake.a2',
      sampleFormat: 'f32',
      frameKind: 'uniform-signal-batch',
      t0Ms: 30,
      dtMs: 10,
      sampleCount: 3,
      values: new Float32Array([4, 5, 6]),
    }));

    expect(store.sampleCount()).toBe(4);
    const slice = store.latestSamples(4);
    expect(slice?.sampleCount).toBe(4);
    expect(Array.from(slice?.values ?? new Float32Array())).toEqual([3, 4, 5, 6]);
    expect(slice?.t0Ms).toBe(20);
    expect(slice?.t1Ms).toBe(50);
  });

  it('режет irregular окно по timestampsMs', () => {
    const store = createSignalWindowStore(signalInput({
      streamId: 'zephyr.rr',
      retain: { by: 'durationMs', value: 10_000 },
    }));

    store.push(makeSignalEvent({
      streamId: 'zephyr.rr',
      sampleFormat: 'f32',
      frameKind: 'irregular-signal-batch',
      t0Ms: 100,
      sampleCount: 3,
      values: new Float32Array([1, 2, 3]),
      timestampsMs: new Float64Array([100, 500, 900]),
    }));
    store.push(makeSignalEvent({
      streamId: 'zephyr.rr',
      sampleFormat: 'f32',
      frameKind: 'irregular-signal-batch',
      t0Ms: 1_300,
      sampleCount: 2,
      values: new Float32Array([4, 5]),
      timestampsMs: new Float64Array([1_300, 1_700]),
    }));

    const slice = store.windowMs(700);
    expect(slice?.sampleCount).toBe(2);
    expect(Array.from(slice?.values ?? new Float32Array())).toEqual([4, 5]);
    expect(Array.from(slice?.timestampsMs ?? new Float64Array())).toEqual([1_300, 1_700]);
    expect(slice?.t0Ms).toBe(1_300);
    expect(slice?.t1Ms).toBe(1_700);
  });

  it('отклоняет irregular batch без timestampsMs', () => {
    const store = createSignalWindowStore(signalInput({
      streamId: 'zephyr.rr',
      retain: { by: 'samples', value: 10 },
    }));

    expect(() => store.push(makeSignalEvent({
      streamId: 'zephyr.rr',
      sampleFormat: 'f32',
      frameKind: 'irregular-signal-batch',
      t0Ms: 100,
      sampleCount: 1,
      values: new Float32Array([1]),
    }))).toThrow(/timestampsMs/);
  });

  it('отклоняет смену frameKind в одном stream', () => {
    const store = createSignalWindowStore(signalInput({
      streamId: 'fake.a2',
      retain: { by: 'samples', value: 10 },
    }));

    store.push(makeSignalEvent({
      streamId: 'fake.a2',
      sampleFormat: 'f32',
      frameKind: 'uniform-signal-batch',
      t0Ms: 0,
      dtMs: 10,
      sampleCount: 1,
      values: new Float32Array([1]),
    }));

    expect(() => store.push(makeSignalEvent({
      streamId: 'fake.a2',
      sampleFormat: 'f32',
      frameKind: 'label-batch',
      t0Ms: 20,
      sampleCount: 1,
      values: new Int16Array([1]),
      timestampsMs: new Float64Array([20]),
    }))).toThrow(/frameKind/);
  });
});
