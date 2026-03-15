import { EventTypes, type PluginManifest } from '@sensync2/core';
import type { EventRef, EventSubscription } from '@sensync2/core';
import type {
  InputMap,
  ManifestFragment,
  MutablePluginManifest,
} from './types.ts';

function subscriptionKey(subscription: EventSubscription): string {
  return JSON.stringify([
    subscription.type,
    subscription.v,
    subscription.kind ?? null,
    subscription.priority ?? null,
    subscription.filter ?? null,
  ]);
}

function eventRefKey(ref: EventRef): string {
  return `${ref.type}@${ref.v}`;
}

export function createEmptyManifestFragment(): ManifestFragment {
  return {
    subscriptions: [],
    emits: [],
  };
}

export function mergeManifestFragments(...fragments: ManifestFragment[]): ManifestFragment {
  const subscriptions: EventSubscription[] = [];
  const emits: EventRef[] = [];
  const seenSubscriptions = new Set<string>();
  const seenEmits = new Set<string>();

  for (const fragment of fragments) {
    for (const subscription of fragment.subscriptions) {
      const key = subscriptionKey(subscription);
      if (seenSubscriptions.has(key)) continue;
      seenSubscriptions.add(key);
      subscriptions.push({ ...subscription, ...(subscription.filter ? { filter: { ...subscription.filter } } : {}) });
    }
    for (const eventRef of fragment.emits) {
      const key = eventRefKey(eventRef);
      if (seenEmits.has(key)) continue;
      seenEmits.add(key);
      emits.push({ ...eventRef });
    }
  }

  return {
    subscriptions,
    emits,
  };
}

export function applyManifestFragment(
  manifest: PluginManifest,
  fragment: ManifestFragment,
): void {
  const mutableManifest = manifest as MutablePluginManifest;
  const merged = mergeManifestFragments(
    {
      subscriptions: mutableManifest.subscriptions,
      emits: mutableManifest.emits ?? [],
    },
    fragment,
  );
  mutableManifest.subscriptions = merged.subscriptions;
  mutableManifest.emits = merged.emits;
}

export function buildManifestFragmentFromInputs(inputs: InputMap): ManifestFragment {
  const subscriptions: EventSubscription[] = [];
  for (const [, descriptor] of inputs.signalEntries()) {
    subscriptions.push({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      filter: { streamId: descriptor.streamId },
    });
  }
  for (const [, descriptor] of inputs.factEntries()) {
    subscriptions.push({
      type: descriptor.event.type,
      v: descriptor.event.v,
    });
  }
  return {
    subscriptions,
    emits: [],
  };
}
