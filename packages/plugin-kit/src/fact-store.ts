import type { RuntimeEvent } from '@sensync2/core';
import type {
  FactInputDescriptor,
  FactStore,
} from './types.ts';

export function createFactStore<TEvent extends RuntimeEvent = RuntimeEvent>(
  descriptor: FactInputDescriptor,
): FactStore<TEvent> {
  let latestEvent: TEvent | null = null;

  return {
    descriptor() {
      return descriptor;
    },
    push(event) {
      if (event.type !== descriptor.event.type || event.v !== descriptor.event.v) {
        return false;
      }
      latestEvent = event;
      return true;
    },
    clear() {
      latestEvent = null;
    },
    latest() {
      return latestEvent;
    },
    latestPayload() {
      return (latestEvent?.payload ?? null) as FactStore<TEvent>['latestPayload'] extends () => infer TResult ? TResult : never;
    },
  };
}
