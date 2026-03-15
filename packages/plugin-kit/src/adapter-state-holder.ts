import {
  defineRuntimeEventInput,
  EventTypes,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import type { AdapterRuntimeState } from './types.ts';

interface StateTransition {
  adapterId: string;
  previousState: AdapterRuntimeState;
  nextState: AdapterRuntimeState;
  requestId?: string;
  message?: string;
}

interface CreateAdapterStateHolderOptions {
  adapterId: string;
  initialState?: AdapterRuntimeState;
}

type TransitionListener = (transition: StateTransition) => void;

export function createAdapterStateHolder(options: CreateAdapterStateHolderOptions) {
  const adapterId = options.adapterId;
  let currentState: AdapterRuntimeState = options.initialState ?? 'disconnected';
  const listeners = new Set<TransitionListener>();

  function createEvent(
    nextState: AdapterRuntimeState,
    requestId?: string,
    message?: string,
  ): RuntimeEventInputOf<typeof EventTypes.adapterStateChanged, 1> {
    const payload: RuntimeEventInputOf<typeof EventTypes.adapterStateChanged, 1>['payload'] = {
      adapterId,
      state: nextState,
    };
    if (requestId !== undefined) payload.requestId = requestId;
    if (message !== undefined) payload.message = message;
    return defineRuntimeEventInput({
      type: EventTypes.adapterStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload,
    });
  }

  function notifyListeners(previousState: AdapterRuntimeState, nextState: AdapterRuntimeState, requestId?: string, message?: string): void {
    const transition: StateTransition = {
      adapterId,
      previousState,
      nextState,
    };
    if (requestId !== undefined) transition.requestId = requestId;
    if (message !== undefined) transition.message = message;
    for (const listener of listeners) {
      listener(transition);
    }
  }

  function canConnect(): boolean {
    return currentState !== 'connecting'
      && currentState !== 'connected'
      && currentState !== 'disconnecting'
      && currentState !== 'paused';
  }

  function canDisconnect(): boolean {
    return currentState !== 'disconnected';
  }

  return {
    getState(): AdapterRuntimeState {
      return currentState;
    },
    isState(...states: AdapterRuntimeState[]): boolean {
      return states.includes(currentState);
    },
    canConnect,
    canDisconnect,
    assertCanConnect(message = 'Адаптер уже подключён или находится в процессе connect/disconnect'): void {
      if (!canConnect()) throw new Error(message);
    },
    assertCanDisconnect(message = 'Адаптер уже отключён'): void {
      if (!canDisconnect()) throw new Error(message);
    },
    createEvent,
    async emitCurrent(ctx: PluginContext, requestId?: string, message?: string): Promise<void> {
      await ctx.emit(createEvent(currentState, requestId, message));
    },
    async setState(ctx: PluginContext, nextState: AdapterRuntimeState, requestId?: string, message?: string): Promise<void> {
      const previousState = currentState;
      currentState = nextState;
      notifyListeners(previousState, nextState, requestId, message);
      await ctx.emit(createEvent(nextState, requestId, message));
    },
    onTransition(listener: TransitionListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
