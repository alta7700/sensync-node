import { EventTypes, type RuntimeEvent } from '@sensync2/core';
import { createFactStore } from './fact-store.ts';
import { createSignalWindowStore } from './signal-window.ts';
import type {
  FactStore,
  InputMap,
  InputRuntime,
  SignalWindowStore,
} from './types.ts';

export function createInputRuntime<TInputKey extends string>(
  inputs: InputMap<TInputKey>,
): InputRuntime<TInputKey> {
  const signalStores = new Map<TInputKey, SignalWindowStore>();
  const factStores = new Map<TInputKey, FactStore>();

  for (const [inputKey, descriptor] of inputs.entries()) {
    if (descriptor.kind === 'signal') {
      signalStores.set(inputKey, createSignalWindowStore(descriptor));
      continue;
    }
    factStores.set(inputKey, createFactStore(descriptor));
  }

  return {
    definition() {
      return inputs;
    },
    signal(inputKey) {
      const store = signalStores.get(inputKey);
      if (!store) {
        throw new Error(`Input "${inputKey}" не является signal input`);
      }
      return store;
    },
    fact(inputKey) {
      const store = factStores.get(inputKey);
      if (!store) {
        throw new Error(`Input "${inputKey}" не является fact input`);
      }
      return store;
    },
    route(event: RuntimeEvent) {
      const updated: TInputKey[] = [];
      if (event.type === EventTypes.signalBatch) {
        for (const [inputKey, store] of signalStores.entries()) {
          if (store.push(event)) {
            updated.push(inputKey);
          }
        }
      }
      for (const [inputKey, store] of factStores.entries()) {
        if (store.push(event)) {
          updated.push(inputKey);
        }
      }
      return updated;
    },
    clear() {
      for (const store of signalStores.values()) {
        store.clear();
      }
      for (const store of factStores.values()) {
        store.clear();
      }
    },
  };
}
