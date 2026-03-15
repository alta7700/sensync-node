import { describe, expect, it } from 'vitest';
import { createStateCell } from './state-cell.ts';

describe('state-cell', () => {
  it('держит previous/current и changed', () => {
    const cell = createStateCell(false);

    expect(cell.current()).toBe(false);
    expect(cell.previous()).toBeNull();

    expect(cell.set(true)).toEqual({
      changed: true,
      previous: false,
      current: true,
    });
    expect(cell.set(true)).toEqual({
      changed: false,
      previous: false,
      current: true,
    });
  });
});
