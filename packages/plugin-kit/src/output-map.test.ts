import { describe, expect, it } from 'vitest';
import { createOutputRegistry } from './output-map.ts';

describe('output-map', () => {
  it('нормализует string shorthand и хранит units', () => {
    const registry = createOutputRegistry({
      emg: 'trigno.avanti',
      gyroX: { streamId: 'trigno.avanti.gyro.x', units: 'deg/s' },
    });

    expect(registry.get('emg')).toEqual({ streamId: 'trigno.avanti' });
    expect(registry.get('gyroX')).toEqual({ streamId: 'trigno.avanti.gyro.x', units: 'deg/s' });
  });

  it('запрещает дубли streamId', () => {
    expect(() => createOutputRegistry({
      a: 'same.stream',
      b: 'same.stream',
    })).toThrow(/повторяется/);
  });
});
