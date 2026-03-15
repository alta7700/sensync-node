import type { RuntimeEvent, RuntimeEventInput } from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import {
  createEmptyManifestFragment,
  mergeManifestFragments,
} from './manifest-fragment.ts';
import type {
  CompiledStateExpression,
  HandlerApi,
  HandlerGroup,
  InputRuntime,
  ManifestFragment,
  PluginHandler,
  StateCell,
} from './types.ts';

function subscriptionKey(subscription: ManifestFragment['subscriptions'][number]): string {
  return JSON.stringify([
    subscription.type,
    subscription.v,
    subscription.kind ?? null,
    subscription.priority ?? null,
    subscription.filter ?? null,
  ]);
}

function eventRefKey(ref: ManifestFragment['emits'][number]): string {
  return `${ref.type}@${ref.v}`;
}

function isManifestSubset(superset: ManifestFragment, subset: ManifestFragment): boolean {
  const knownSubscriptions = new Set(superset.subscriptions.map(subscriptionKey));
  const knownEmits = new Set(superset.emits.map(eventRefKey));
  return subset.subscriptions.every((subscription) => knownSubscriptions.has(subscriptionKey(subscription)))
    && subset.emits.every((eventRef) => knownEmits.has(eventRefKey(eventRef)));
}

function evaluateWhen<TInputKey extends string, TStateKey extends string>(
  when: CompiledStateExpression<TStateKey> | undefined,
  api: HandlerApi<TInputKey, TStateKey>,
): boolean {
  if (!when) return true;
  return when((stateKey) => api.states[stateKey]?.current());
}

function matchesInputEvent<TInputKey extends string>(
  inputKey: TInputKey,
  event: RuntimeEvent,
  inputs: InputRuntime<TInputKey>,
): boolean {
  const descriptor = inputs.definition().get(inputKey);
  if (descriptor.kind === 'signal') {
    if (event.type !== 'signal.batch') {
      return false;
    }
    const payload = ('payload' in event && event.payload && typeof event.payload === 'object')
      ? event.payload as { streamId?: unknown }
      : null;
    return event.type === 'signal.batch'
      && payload?.streamId === descriptor.streamId;
  }
  return event.type === descriptor.event.type && event.v === descriptor.event.v;
}

interface HandlerLifecycleState {
  removed: boolean;
  started: boolean;
  startPromise: Promise<void> | null;
  startContext: PluginContext | null;
}

export function createHandlerGroup<
  TInputKey extends string,
  TStateKey extends string,
>(options: {
  inputs: InputRuntime<TInputKey>;
  states: Record<TStateKey, StateCell<unknown>>;
  handlers: PluginHandler<TInputKey, TStateKey>[];
}): HandlerGroup<TInputKey, TStateKey> {
  const api: HandlerApi<TInputKey, TStateKey> = {
    inputs: options.inputs,
    states: options.states,
  };
  const handlers = [...options.handlers];
  const startedHandlers = new Set<PluginHandler<TInputKey, TStateKey>>();
  const lifecycleStates = new Map<PluginHandler<TInputKey, TStateKey>, HandlerLifecycleState>();
  const manifestSuperset = mergeManifestFragments(
    createEmptyManifestFragment(),
    ...handlers.map((handler) => handler.manifest()),
  );
  let started = false;
  let activeContext: PluginContext | null = null;

  function ensureLifecycleState(handler: PluginHandler<TInputKey, TStateKey>): HandlerLifecycleState {
    const knownState = lifecycleStates.get(handler);
    if (knownState) {
      return knownState;
    }
    const nextState: HandlerLifecycleState = {
      removed: false,
      started: false,
      startPromise: null,
      startContext: null,
    };
    lifecycleStates.set(handler, nextState);
    return nextState;
  }

  for (const handler of handlers) {
    ensureLifecycleState(handler);
  }

  async function startHandler(handler: PluginHandler<TInputKey, TStateKey>, ctx: PluginContext): Promise<void> {
    const lifecycleState = ensureLifecycleState(handler);
    if (!started || lifecycleState.removed || lifecycleState.started) {
      return;
    }
    if (lifecycleState.startPromise) {
      await lifecycleState.startPromise;
      return;
    }

    // Late-start после remove/stop не должен оставлять за собой таймеры и прочие ресурсы.
    const startPromise = (async () => {
      lifecycleState.startContext = ctx;
      await handler.start(ctx, api);
      if (lifecycleState.removed || !started) {
        await handler.stop(ctx, api);
        return;
      }
      lifecycleState.started = true;
      startedHandlers.add(handler);
    })();

    lifecycleState.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (lifecycleState.startPromise === startPromise) {
        lifecycleState.startPromise = null;
      }
    }
  }

  async function stopHandler(handler: PluginHandler<TInputKey, TStateKey>, ctx: PluginContext): Promise<void> {
    const lifecycleState = ensureLifecycleState(handler);
    if (lifecycleState.startPromise) {
      try {
        await lifecycleState.startPromise;
      } catch {
        // Ошибка старта уже принадлежит вызывающему start/add; здесь нужен только cleanup.
      }
    }
    if (!lifecycleState.started) return;
    lifecycleState.started = false;
    startedHandlers.delete(handler);
    await handler.stop(ctx, api);
  }

  return {
    manifest() {
      return manifestSuperset;
    },
    async start(ctx) {
      if (started) return;
      activeContext = ctx;
      started = true;
      for (const handler of handlers) {
        await startHandler(handler, ctx);
      }
    },
    async stop(ctx) {
      if (!started) return;
      started = false;
      for (let index = handlers.length - 1; index >= 0; index -= 1) {
        await stopHandler(handlers[index]!, ctx);
      }
      activeContext = null;
    },
    async dispatch(event, ctx) {
      options.inputs.route(event);
      for (const handler of handlers) {
        if (!startedHandlers.has(handler)) continue;
        await handler.handleEvent(event, ctx, api);
      }
    },
    add(handler, ctx) {
      const handlerManifest = handler.manifest();
      if (!isManifestSubset(manifestSuperset, handlerManifest)) {
        throw new Error('Нельзя добавить handler вне заранее объявленного manifest superset');
      }
      handlers.push(handler);
      const lifecycleState = ensureLifecycleState(handler);
      lifecycleState.removed = false;

      const startCtx = ctx ?? activeContext ?? undefined;
      if (started && startCtx) {
        const startPromise = startHandler(handler, startCtx);
        void startPromise.catch(() => {});
      }

      return async () => {
        lifecycleState.removed = true;
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
        if (lifecycleState.startPromise) {
          try {
            await lifecycleState.startPromise;
          } catch {
            // Ошибка старта не должна мешать снять lifecycle-ссылки и выполнить cleanup.
          }
        }
        const stopCtx = ctx ?? activeContext ?? lifecycleState.startContext;
        if (stopCtx) {
          await stopHandler(handler, stopCtx);
        } else {
          lifecycleState.started = false;
          startedHandlers.delete(handler);
        }
        lifecycleStates.delete(handler);
      };
    },
  };
}

export function createFactStateProjectionHandler<
  TInputKey extends string,
  TStateKey extends string,
  TValue,
>(options: {
  input: TInputKey;
  state: TStateKey;
  project: (event: RuntimeEvent) => TValue;
}): PluginHandler<TInputKey, TStateKey> {
  return {
    manifest() {
      return createEmptyManifestFragment();
    },
    start() {},
    stop() {},
    handleEvent(event, _ctx, api) {
      const descriptor = api.inputs.definition().get(options.input);
      if (descriptor.kind !== 'fact') {
        throw new Error(`Input "${options.input}" должен быть fact input`);
      }
      if (!matchesInputEvent(options.input, event, api.inputs)) {
        return;
      }
      const latestEvent = api.inputs.fact(options.input).latest();
      if (!latestEvent) return;
      api.states[options.state]?.set(options.project(latestEvent));
    },
  };
}

export function createEveryEventHandler<
  TInputKey extends string,
  TStateKey extends string,
>(options: {
  selector:
    | { input: TInputKey; event?: never }
    | { event: { type: string; v: number }; input?: never };
  when?: CompiledStateExpression<TStateKey>;
  run: (args: {
    event: RuntimeEvent;
    api: HandlerApi<TInputKey, TStateKey>;
    ctx: PluginContext;
  }) => Promise<void> | void;
}): PluginHandler<TInputKey, TStateKey> {
  return {
    manifest() {
      return createEmptyManifestFragment();
    },
    start() {},
    stop() {},
    async handleEvent(event, ctx, api) {
      const matches = 'input' in options.selector
        ? matchesInputEvent(options.selector.input, event, api.inputs)
        : (event.type === options.selector.event.type && event.v === options.selector.event.v);
      if (!matches) return;
      if (!evaluateWhen(options.when, api)) return;
      await options.run({ event, api, ctx });
    },
  };
}

export function createIntervalHandler<
  TInputKey extends string,
  TStateKey extends string,
>(options: {
  timerId: string;
  tickEvent: { type: string; v: number };
  everyMs: number;
  when?: CompiledStateExpression<TStateKey>;
  run: (args: {
    api: HandlerApi<TInputKey, TStateKey>;
    ctx: PluginContext;
  }) => Promise<void> | void;
}): PluginHandler<TInputKey, TStateKey> {
  return {
    manifest() {
      return {
        subscriptions: [{
          type: options.tickEvent.type,
          v: options.tickEvent.v,
          kind: 'fact',
          priority: 'system',
        }],
        emits: [{ type: options.tickEvent.type, v: options.tickEvent.v }],
      };
    },
    start(ctx) {
      ctx.setTimer(options.timerId, options.everyMs, () => ({
        type: options.tickEvent.type,
        v: options.tickEvent.v,
        kind: 'fact',
        priority: 'system',
        payload: {},
      } as RuntimeEventInput));
    },
    stop(ctx) {
      ctx.clearTimer(options.timerId);
    },
    async handleEvent(event, ctx, api) {
      if (event.type !== options.tickEvent.type || event.v !== options.tickEvent.v) {
        return;
      }
      if (!evaluateWhen(options.when, api)) return;
      await options.run({ api, ctx });
    },
  };
}
