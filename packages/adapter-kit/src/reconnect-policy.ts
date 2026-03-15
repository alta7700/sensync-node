import type { ReconnectPolicyOptions } from './types.ts';

export function createReconnectPolicy(options: ReconnectPolicyOptions) {
  const multiplier = options.multiplier ?? 1;
  const maxDelayMs = options.maxDelayMs ?? options.initialDelayMs;
  let attempt = 0;
  let nextAttemptSessionMs: number | null = null;

  function computeDelayMs(nextAttempt: number): number {
    const scaledDelay = options.initialDelayMs * (multiplier ** Math.max(0, nextAttempt - 1));
    return Math.min(maxDelayMs, Math.max(1, Math.round(scaledDelay)));
  }

  return {
    getAttempt(): number {
      return attempt;
    },
    getNextAttemptSessionMs(): number | null {
      return nextAttemptSessionMs;
    },
    reset(): void {
      attempt = 0;
      nextAttemptSessionMs = null;
    },
    cancel(): void {
      nextAttemptSessionMs = null;
    },
    schedule(nowSessionMs: number): number | null {
      const nextAttempt = attempt + 1;
      if (options.shouldRetry && !options.shouldRetry(nextAttempt)) {
        return null;
      }

      attempt = nextAttempt;
      nextAttemptSessionMs = nowSessionMs + computeDelayMs(nextAttempt);
      return nextAttemptSessionMs;
    },
    isReady(nowSessionMs: number): boolean {
      return nextAttemptSessionMs !== null && nowSessionMs >= nextAttemptSessionMs;
    },
  };
}
