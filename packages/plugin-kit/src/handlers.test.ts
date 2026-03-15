import { describe, expect, it } from 'vitest';
import {
  attachRuntimeEventEnvelope,
  defineRuntimeEventInput,
  EventTypes,
  type RuntimeEvent,
  type RuntimeEventInput,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import type { PluginHandler } from './types.ts';
import { createHandlerGroup, createEveryEventHandler, createFactStateProjectionHandler, createIntervalHandler } from './handlers.ts';
import { createInputMap, factInput, signalInput } from './input-map.ts';
import { createInputRuntime } from './input-runtime.ts';
import { createStateCell } from './state-cell.ts';

interface TestHarness {
  ctx: PluginContext;
  timers: Map<string, () => RuntimeEventInput>;
}

function createHarness(): TestHarness {
  const timers = new Map<string, () => RuntimeEventInput>();

  const ctx: PluginContext = {
    pluginId: 'test-plugin',
    clock: {
      nowSessionMs: () => 0,
      sessionStartWallMs: () => 0,
    },
    emit: async () => {},
    setTimer: (timerId, _intervalMs, eventFactory) => {
      timers.set(timerId, eventFactory);
    },
    clearTimer: (timerId) => {
      timers.delete(timerId);
    },
    telemetry: () => {},
    getConfig: <T>() => undefined as T,
  };

  return {
    ctx,
    timers,
  };
}

describe('handlers', () => {
  it('проецирует latest fact в state cell и исполняет input selector', async () => {
    const inputs = createInputRuntime(createInputMap({
      interval: factInput({ event: { type: 'interval.state.changed', v: 1 } }),
      source: signalInput({ streamId: 'fake.a2', retain: { by: 'samples', value: 10 } }),
    }));
    const states = {
      intervalActive: createStateCell<boolean>(false),
    };
    const seen: string[] = [];
    const group = createHandlerGroup({
      inputs,
      states,
      handlers: [
        createFactStateProjectionHandler({
          input: 'interval',
          state: 'intervalActive',
          project: (event) => Boolean((event as { payload: { active?: unknown } }).payload.active),
        }),
        createEveryEventHandler({
          selector: { input: 'source' },
          run: async ({ event }) => {
            seen.push((event as { payload: { streamId: string } }).payload.streamId);
          },
        }),
      ],
    });
    const harness = createHarness();
    await group.start(harness.ctx);

    await group.dispatch({
      ...defineRuntimeEventInput({
        type: 'interval.state.changed',
        v: 1,
        kind: 'fact',
        priority: 'system',
        payload: { active: true },
      }),
      seq: 1n,
      tsMonoMs: 0,
      sourcePluginId: 'external-ui',
    }, harness.ctx);
    await group.dispatch({
      ...defineRuntimeEventInput({
        type: EventTypes.signalBatch,
        v: 1,
        kind: 'data',
        priority: 'data',
        payload: {
          streamId: 'fake.a2',
          sampleFormat: 'f32',
          frameKind: 'uniform-signal-batch',
          t0Ms: 0,
          dtMs: 10,
          sampleCount: 1,
          values: new Float32Array([1]),
        },
      }),
      seq: 2n,
      tsMonoMs: 0,
      sourcePluginId: 'external-ui',
    }, harness.ctx);

    expect(states.intervalActive.current()).toBe(true);
    expect(seen).toEqual(['fake.a2']);
  });

  it('управляет lifecycle interval timer и запрещает add вне manifest superset', async () => {
    const inputs = createInputRuntime(createInputMap({}));
    const states = {
      active: createStateCell<boolean>(true),
    };
    const calls: string[] = [];
    const intervalHandler = createIntervalHandler({
      timerId: 'flush',
      tickEvent: { type: EventTypes.runtimeStarted, v: 1 },
      everyMs: 1000,
      run: async () => {
        calls.push('tick');
      },
    });
    const group = createHandlerGroup({
      inputs,
      states,
      handlers: [intervalHandler],
    });
    const harness = createHarness();
    await group.start(harness.ctx);

    expect(harness.timers.has('flush')).toBe(true);
    await group.dispatch(attachRuntimeEventEnvelope(defineRuntimeEventInput({
        type: EventTypes.runtimeStarted,
        v: 1,
        kind: 'fact',
        priority: 'system',
        payload: {},
      }), 1n, 0, 'external-ui'), harness.ctx);

    expect(calls).toEqual(['tick']);

    expect(() => group.add(createIntervalHandler({
      timerId: 'foreign',
      tickEvent: { type: EventTypes.uiClientConnected, v: 1 },
      everyMs: 1000,
      run: async () => {},
    }))).toThrow(/superset/);

    await group.stop(harness.ctx);
    expect(harness.timers.has('flush')).toBe(false);
  });

  it('останавливает late-start handler после remove без утечки таймера', async () => {
    const inputs = createInputRuntime(createInputMap({}));
    const group = createHandlerGroup({
      inputs,
      states: {},
      handlers: [],
    });
    const harness = createHarness();
    await group.start(harness.ctx);

    const lifecycle: string[] = [];
    let resolveStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });

    const handler: PluginHandler<never, never> = {
      manifest() {
        return {
          subscriptions: [],
          emits: [],
        };
      },
      async start(ctx) {
        lifecycle.push('start.begin');
        await startGate;
        ctx.setTimer('late-handler', 1000, () => defineRuntimeEventInput({
          type: EventTypes.runtimeStarted,
          v: 1,
          kind: 'fact',
          priority: 'system',
          payload: {},
        }));
        lifecycle.push('start.end');
      },
      async stop(ctx) {
        lifecycle.push('stop');
        ctx.clearTimer('late-handler');
      },
      async handleEvent(_event: RuntimeEvent) {},
    };

    const remove = group.add(handler, harness.ctx);
    const removePromise = remove();

    expect(harness.timers.has('late-handler')).toBe(false);
    resolveStart();
    await removePromise;

    expect(lifecycle).toEqual(['start.begin', 'start.end', 'stop']);
    expect(harness.timers.has('late-handler')).toBe(false);

    await group.stop(harness.ctx);
  });
});
