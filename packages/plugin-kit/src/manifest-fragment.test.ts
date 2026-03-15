import { describe, expect, it } from 'vitest';
import { createInputMap, factInput, signalInput } from './input-map.ts';
import {
  applyManifestFragment,
  buildManifestFragmentFromInputs,
  createEmptyManifestFragment,
  mergeManifestFragments,
} from './manifest-fragment.ts';

describe('manifest-fragment', () => {
  it('строит fragment из input-map', () => {
    const inputs = createInputMap({
      source: signalInput({
        streamId: 'fake.a2',
        retain: { by: 'samples', value: 100 },
      }),
      fact: factInput({
        event: { type: 'interval.state.changed', v: 1 },
      }),
    });

    expect(buildManifestFragmentFromInputs(inputs)).toEqual({
      subscriptions: [
        {
          type: 'signal.batch',
          v: 1,
          kind: 'data',
          priority: 'data',
          filter: { streamId: 'fake.a2' },
        },
        {
          type: 'interval.state.changed',
          v: 1,
        },
      ],
      emits: [],
    });
  });

  it('дедуплицирует subscriptions и emits', () => {
    const merged = mergeManifestFragments(
      {
        subscriptions: [{ type: 'signal.batch', v: 1, kind: 'data', priority: 'data', filter: { streamId: 'fake.a2' } }],
        emits: [{ type: 'metric.value.changed', v: 1 }],
      },
      {
        subscriptions: [{ type: 'signal.batch', v: 1, kind: 'data', priority: 'data', filter: { streamId: 'fake.a2' } }],
        emits: [{ type: 'metric.value.changed', v: 1 }],
      },
    );

    expect(merged.subscriptions).toHaveLength(1);
    expect(merged.emits).toHaveLength(1);
  });

  it('явно мутирует manifest in place', () => {
    const manifest = {
      id: 'test',
      version: '0.1.0',
      required: false,
      subscriptions: [],
      mailbox: {
        controlCapacity: 1,
        dataCapacity: 1,
        dataPolicy: 'fail-fast' as const,
      },
      emits: [],
    };

    applyManifestFragment(manifest, mergeManifestFragments(
      createEmptyManifestFragment(),
      {
        subscriptions: [{ type: 'signal.batch', v: 1, kind: 'data', priority: 'data', filter: { streamId: 'fake.a2' } }],
        emits: [{ type: 'metric.value.changed', v: 1 }],
      },
    ));

    expect(manifest.subscriptions).toEqual([
      { type: 'signal.batch', v: 1, kind: 'data', priority: 'data', filter: { streamId: 'fake.a2' } },
    ]);
    expect(manifest.emits).toEqual([{ type: 'metric.value.changed', v: 1 }]);
  });
});
