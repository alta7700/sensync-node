import type { EventSubscription, PluginManifest, RuntimeEvent } from '@sensync2/core';

function readPayloadField(event: RuntimeEvent, field: 'adapterId' | 'streamId'): string | undefined {
  if (!('payload' in event) || !event.payload || typeof event.payload !== 'object') return undefined;
  const payload = event.payload as Record<string, unknown>;
  const raw = payload[field];
  return typeof raw === 'string' ? raw : undefined;
}

function matchesSubscription(event: RuntimeEvent, sub: EventSubscription): boolean {
  if (sub.type !== event.type) return false;
  if (sub.v !== event.v) return false;
  if (sub.kind && sub.kind !== event.kind) return false;
  if (sub.priority && sub.priority !== event.priority) return false;
  if (!sub.filter) return true;

  if (sub.filter.adapterId && readPayloadField(event, 'adapterId') !== sub.filter.adapterId) {
    return false;
  }
  if (sub.filter.streamId && readPayloadField(event, 'streamId') !== sub.filter.streamId) {
    return false;
  }
  if (sub.filter.streamIdPrefix) {
    const streamId = readPayloadField(event, 'streamId');
    if (!streamId || !streamId.startsWith(sub.filter.streamIdPrefix)) {
      return false;
    }
  }

  return true;
}

/**
 * Простой линейный индекс подписок для `v1`.
 *
 * Линейный проход выбран осознанно: на `v1` число плагинов небольшое, а код проще отлаживать.
 */
export class SubscriptionIndex {
  private manifests = new Map<string, PluginManifest>();

  setManifest(manifest: PluginManifest): void {
    this.manifests.set(manifest.id, manifest);
  }

  removeManifest(pluginId: string): void {
    this.manifests.delete(pluginId);
  }

  getSubscribers(event: RuntimeEvent): string[] {
    const result: string[] = [];
    for (const manifest of this.manifests.values()) {
      if (manifest.subscriptions.some((sub) => matchesSubscription(event, sub))) {
        result.push(manifest.id);
      }
    }
    return result;
  }
}
