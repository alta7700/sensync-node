import type { EventKind, EventPriority, EventType, PluginId, RuntimeEvent } from './events.ts';
import type { UiWidget } from './ui.ts';

export interface EventSubscription {
  type: EventType;
  kind?: EventKind;
  priority?: EventPriority;
  filter?: {
    channelIdPrefix?: string;
    adapterId?: string;
    streamId?: string;
  };
}

export interface UiContributionDescriptor {
  widget: UiWidget;
  pageId?: string;
}

export interface PluginManifest {
  id: PluginId;
  version: string;
  required: boolean;
  subscriptions: EventSubscription[];
  mailbox: {
    controlCapacity: number;
    dataCapacity: number;
    dataPolicy: 'fail-fast' | 'coalesce-latest-per-stream';
  };
  emits?: string[];
  uiContributions?: UiContributionDescriptor[];
}

export interface QueueTelemetry {
  pluginId: PluginId;
  controlDepth: number;
  dataDepth: number;
  maxControlDepth: number;
  maxDataDepth: number;
  dropped: number;
  coalesced: number;
  avgHandlerMs: number;
  handled: number;
}

export interface PluginMetric {
  name: string;
  value: number;
  unit?: string;
  tags?: Record<string, string>;
}

export interface NumericKernelBackend {
  name: 'js' | 'wasm' | 'native';
  rollingMin(input: Float32Array, window: number): Float32Array;
  envelopeLike?(input: Float32Array, sampleRateHz: number): Float32Array;
}

export interface PluginRuntimeSnapshot {
  id: PluginId;
  state: 'starting' | 'running' | 'failed' | 'stopped';
  required: boolean;
  error?: string;
  telemetry: QueueTelemetry;
}

export type EventMatcher = (event: RuntimeEvent) => boolean;
