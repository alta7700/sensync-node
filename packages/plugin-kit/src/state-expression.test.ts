import { describe, expect, it } from 'vitest';
import { compileStateExpression } from './state-expression.ts';

describe('state-expression', () => {
  it('компилирует and/or/not', () => {
    const expression = compileStateExpression({
      and: [
        { state: 'connected', eq: true },
        {
          not: {
            or: [
              { state: 'paused', eq: true },
              { state: 'failed', eq: true },
            ],
          },
        },
      ],
    });

    expect(expression((key) => ({
      connected: true,
      paused: false,
      failed: false,
    })[key])).toBe(true);

    expect(expression((key) => ({
      connected: true,
      paused: true,
      failed: false,
    })[key])).toBe(false);
  });

  it('предкомпилирует not-поддерево один раз', () => {
    let notAccessCount = 0;
    const expression = {} as { not: { state: 'paused'; eq: boolean } };
    Object.defineProperty(expression, 'not', {
      enumerable: true,
      get() {
        notAccessCount += 1;
        return { state: 'paused', eq: true };
      },
    });

    const compiled = compileStateExpression(expression);
    expect(notAccessCount).toBe(1);

    expect(compiled((key) => ({ paused: false }[key]))).toBe(true);
    expect(compiled((key) => ({ paused: true }[key]))).toBe(false);
    expect(notAccessCount).toBe(1);
  });
});
