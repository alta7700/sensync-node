import { describe, expect, it } from 'vitest';
import { createAdapterStateHolder } from './adapter-state-holder.ts';

function createTestContext() {
  const emitted: unknown[] = [];
  return {
    emitted,
    ctx: {
      pluginId: 'test-plugin',
      clock: {
        nowSessionMs: () => 0,
        sessionStartWallMs: () => 0,
      },
      emit: async (event: unknown) => {
        emitted.push(event);
      },
      setTimer() {},
      clearTimer() {},
      telemetry() {},
      getConfig() {
        return undefined;
      },
    },
  };
}

describe('adapter-state-holder', () => {
  it('эмитит состояние и обновляет guard-ы', async () => {
    const holder = createAdapterStateHolder({ adapterId: 'fake' });
    const { ctx, emitted } = createTestContext();

    await holder.emitCurrent(ctx as never);
    await holder.setState(ctx as never, 'connected', 'req-1', 'ok');

    expect(emitted).toHaveLength(2);
    expect(holder.getState()).toBe('connected');
    expect(holder.canConnect()).toBe(false);
    expect(holder.canDisconnect()).toBe(true);
  });

  it('публикует transition listener', async () => {
    const holder = createAdapterStateHolder({ adapterId: 'fake' });
    const seen: string[] = [];
    const unsubscribe = holder.onTransition((transition) => {
      seen.push(`${transition.previousState}->${transition.nextState}`);
    });

    await holder.setState(createTestContext().ctx as never, 'connecting');
    unsubscribe();
    await holder.setState(createTestContext().ctx as never, 'connected');

    expect(seen).toEqual(['disconnected->connecting']);
  });
});
