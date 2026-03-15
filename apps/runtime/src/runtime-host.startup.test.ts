import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeHost } from './runtime-host.ts';

describe('RuntimeHost startup barrier', () => {
  let runtime: RuntimeHost | null = null;

  afterEach(async () => {
    if (!runtime) return;
    await runtime.stop();
    runtime = null;
  });

  it('публикует runtime.started только после готовности всех плагинов', async () => {
    const startedPlugins = new Set<string>();

    runtime = new RuntimeHost({
      plugins: [
        {
          id: 'runtime-start-fast-probe-plugin',
          modulePath: new URL('./runtime-start-fast-probe-plugin.test-fixture.ts', import.meta.url).href,
        },
        {
          id: 'runtime-start-slow-probe-plugin',
          modulePath: new URL('./runtime-start-slow-probe-plugin.test-fixture.ts', import.meta.url).href,
        },
      ],
      telemetryIntervalMs: 60_000,
      uiSinks: {
        onControl(payload) {
          const message = payload.message;
          if (message.type !== 'ui.warning' || message.code !== 'runtime_started_probe') {
            return;
          }
          if (message.pluginId) {
            startedPlugins.add(message.pluginId);
          }
        },
      },
    });

    await runtime.start();
    await waitFor(() => startedPlugins.size === 2);

    expect([...startedPlugins].sort()).toEqual([
      'runtime-start-fast-probe-plugin',
      'runtime-start-slow-probe-plugin',
    ]);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if ((Date.now() - startedAt) >= timeoutMs) {
      throw new Error('Условие не выполнилось за отведённое время');
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}
