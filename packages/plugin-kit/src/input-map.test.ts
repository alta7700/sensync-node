import { describe, expect, it } from 'vitest';
import {
  createInputMap,
  factInput,
  signalInput,
} from './input-map.ts';

describe('input-map', () => {
  it('нормализует signal и fact inputs', () => {
    const inputs = createInputMap({
      source: signalInput({
        streamId: ' fake.a2 ',
        retain: { by: 'samples', value: 2000 },
      }),
      interval: factInput({
        event: { type: 'activity.state.changed', v: 1 },
      }),
    });

    expect(inputs.get('source')).toEqual({
      kind: 'signal',
      streamId: 'fake.a2',
      retain: { by: 'samples', value: 2000 },
    });
    expect(inputs.get('interval')).toEqual({
      kind: 'fact',
      event: { type: 'activity.state.changed', v: 1 },
      retain: 'latest',
    });
  });

  it('запрещает дубли signal streamId', () => {
    expect(() => createInputMap({
      a: signalInput({ streamId: 'fake.a2', retain: { by: 'samples', value: 10 } }),
      b: signalInput({ streamId: 'fake.a2', retain: { by: 'samples', value: 20 } }),
    })).toThrow(/повторяется/);
  });

  it('запрещает дубли fact event refs', () => {
    expect(() => createInputMap({
      a: factInput({ event: { type: 'activity.state.changed', v: 1 } }),
      b: factInput({ event: { type: 'activity.state.changed', v: 1 } }),
    })).toThrow(/повторяется/);
  });
});
