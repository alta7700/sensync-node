import type { StateCell } from './types.ts';

export function createStateCell<TValue>(
  initialValue?: TValue,
): StateCell<TValue> {
  let currentValue: TValue | null = initialValue ?? null;
  let previousValue: TValue | null = null;

  return {
    current() {
      return currentValue;
    },
    previous() {
      return previousValue;
    },
    set(nextValue) {
      if (currentValue !== null && Object.is(currentValue, nextValue)) {
        return {
          changed: false,
          previous: previousValue,
          current: currentValue,
        };
      }
      previousValue = currentValue;
      currentValue = nextValue;
      return {
        changed: true,
        previous: previousValue,
        current: nextValue,
      };
    },
    clear() {
      previousValue = null;
      currentValue = null;
    },
  };
}
