import { describe, expect, it } from 'vitest';
import { createOutputRegistry } from './output-map.ts';
import {
  createIrregularSignalEmitter,
  createLabelSignalEmitter,
  createUniformSignalEmitter,
  inferSampleFormat,
} from './signal-emit.ts';

describe('signal-emit', () => {
  it('выводит sampleFormat из typed array', () => {
    expect(inferSampleFormat(new Float32Array([1]))).toBe('f32');
    expect(inferSampleFormat(new Float64Array([1]))).toBe('f64');
    expect(inferSampleFormat(new Int16Array([1]))).toBe('i16');
  });

  it('собирает uniform signal.batch из output registry', () => {
    const registry = createOutputRegistry({
      fake: { streamId: 'fake.a1', units: 'a.u.' },
    });
    const emitter = createUniformSignalEmitter(registry);
    const event = emitter.createEvent('fake', new Float32Array([1, 2]), { t0Ms: 10, dtMs: 5 });

    expect(event.payload).toMatchObject({
      streamId: 'fake.a1',
      sampleFormat: 'f32',
      frameKind: 'uniform-signal-batch',
      t0Ms: 10,
      dtMs: 5,
      sampleRateHz: 200,
      sampleCount: 2,
      units: 'a.u.',
    });
  });

  it('собирает irregular signal.batch из output registry', () => {
    const registry = createOutputRegistry({
      rr: { streamId: 'zephyr.rr', units: 's' },
    });
    const emitter = createIrregularSignalEmitter(registry);
    const event = emitter.createEvent(
      'rr',
      new Float32Array([0.78, 0.81]),
      { timestampsMs: new Float64Array([100, 880]) },
    );

    expect(event.payload).toMatchObject({
      streamId: 'zephyr.rr',
      sampleFormat: 'f32',
      frameKind: 'irregular-signal-batch',
      t0Ms: 100,
      sampleCount: 2,
      units: 's',
    });
    expect(Array.from(event.payload.timestampsMs ?? new Float64Array())).toEqual([100, 880]);
  });

  it('собирает label-batch без dtMs и sampleRateHz', () => {
    const registry = createOutputRegistry({
      interval: { streamId: 'interval.label', units: 'label' },
    });
    const emitter = createLabelSignalEmitter(registry);
    const event = emitter.createEvent(
      'interval',
      new Int16Array([1, 0]),
      { timestampsMs: new Float64Array([150, 450]) },
    );

    expect(event.payload).toMatchObject({
      streamId: 'interval.label',
      sampleFormat: 'i16',
      frameKind: 'label-batch',
      t0Ms: 150,
      sampleCount: 2,
      units: 'label',
    });
    expect('dtMs' in event.payload).toBe(false);
    expect('sampleRateHz' in event.payload).toBe(false);
    expect(Array.from(event.payload.timestampsMs ?? new Float64Array())).toEqual([150, 450]);
  });
});
