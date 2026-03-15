import { describe, expect, it } from 'vitest';
import { createReconnectPolicy } from './reconnect-policy.ts';

describe('reconnect-policy', () => {
  it('считает backoff и умеет reset', () => {
    const policy = createReconnectPolicy({
      initialDelayMs: 100,
      multiplier: 2,
      maxDelayMs: 500,
    });

    expect(policy.schedule(10)).toBe(110);
    expect(policy.schedule(10)).toBe(210);
    expect(policy.schedule(10)).toBe(410);
    expect(policy.schedule(10)).toBe(510);
    expect(policy.isReady(509)).toBe(false);
    expect(policy.isReady(510)).toBe(true);

    policy.reset();
    expect(policy.getAttempt()).toBe(0);
    expect(policy.getNextAttemptSessionMs()).toBeNull();
  });

  it('уважает shouldRetry predicate', () => {
    const policy = createReconnectPolicy({
      initialDelayMs: 100,
      shouldRetry: (attempt) => attempt <= 2,
    });

    expect(policy.schedule(0)).toBe(100);
    expect(policy.schedule(0)).toBe(100);
    expect(policy.schedule(0)).toBeNull();
  });
});
