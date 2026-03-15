import { describe, expect, it } from 'vitest';
import {
  attachRuntimeEventEnvelope,
  defineRuntimeEventInput,
  EventTypes,
} from '@sensync2/core';
import { createFactStore } from './fact-store.ts';
import { factInput } from './input-map.ts';

describe('fact-store', () => {
  it('хранит latest event целиком', () => {
    const store = createFactStore(factInput({
      event: { type: 'interval.state.changed', v: 1 },
    }));

    expect(store.push(attachRuntimeEventEnvelope(defineRuntimeEventInput({
      type: 'interval.state.changed',
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { active: true },
    }), 1n, 10, 'test'))).toBe(true);

    expect(store.latest()?.payload).toEqual({ active: true });
    expect(store.latestPayload()).toEqual({ active: true });
  });

  it('возвращает false на несовпадающем событии', () => {
    const store = createFactStore(factInput({
      event: { type: 'interval.state.changed', v: 1 },
    }));

    expect(store.push(attachRuntimeEventEnvelope(defineRuntimeEventInput({
      type: EventTypes.runtimeStarted,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {},
    }), 1n, 10, 'test'))).toBe(false);
    expect(store.latest()).toBeNull();
  });
});
