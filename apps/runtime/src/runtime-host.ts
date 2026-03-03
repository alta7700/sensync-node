import {
  cloneSignalBatchPayload,
  EventTypes,
  type CommandEvent,
  type PluginManifest,
  type PluginRuntimeSnapshot,
  type QueueTelemetry,
  type RuntimeEvent,
  type RuntimeTelemetrySnapshotPayload,
  type SignalBatchEvent,
  type UiBinaryOutPayload,
  type UiClientConnectedPayload,
  type UiClientDisconnectedPayload,
  type UiCommandMessage,
  type UiControlOutPayload,
} from '@sensync2/core';
import { SubscriptionIndex } from './subscription-index.ts';
import { PluginHost } from './plugin-host.ts';
import type { PluginDescriptor, RuntimeHostPublic, RuntimeOptions } from './types.ts';
import { SessionClock } from './session-clock.ts';

function nowMonoMs(): number {
  return performance.now();
}

export class RuntimeHost implements RuntimeHostPublic {
  private options: RuntimeOptions;
  private subscriptionIndex = new SubscriptionIndex();
  private pluginHosts = new Map<string, PluginHost>();
  private nextSeq: bigint = 1n;
  private started = false;
  private stopped = false;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private droppedCounter = 0;
  private runtimeState: 'starting' | 'running' | 'degraded_fatal' | 'stopping' | 'stopped' = 'starting';
  private sessionClock: SessionClock | null = null;

  constructor(options: RuntimeOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.sessionClock = new SessionClock();

    const hosts = this.options.plugins.map((descriptor) => this.createPluginHost(descriptor));
    await Promise.all(hosts.map((host) => host.start()));

    this.runtimeState = 'running';

    const telemetryIntervalMs = this.options.telemetryIntervalMs ?? 1000;
    this.telemetryTimer = setInterval(() => {
      void this.publishRuntimeTelemetry();
    }, telemetryIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.runtimeState = 'stopping';
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    await Promise.all([...this.pluginHosts.values()].map((host) => host.stop()));
    this.pluginHosts.clear();
    this.sessionClock = null;
    this.runtimeState = 'stopped';
  }

  async attachUiClient(clientId: string): Promise<void> {
    const payload: UiClientConnectedPayload = { clientId };
    await this.publish({
      type: EventTypes.uiClientConnected,
      kind: 'fact',
      priority: 'system',
      payload,
    }, 'runtime');
  }

  async detachUiClient(clientId: string): Promise<void> {
    const payload: UiClientDisconnectedPayload = { clientId };
    await this.publish({
      type: EventTypes.uiClientDisconnected,
      kind: 'fact',
      priority: 'system',
      payload,
    }, 'runtime');
  }

  async sendUiCommand(message: UiCommandMessage, _clientId: string): Promise<void> {
    if (this.runtimeState === 'degraded_fatal') {
      this.emitControlFallback({
        message: { type: 'ui.error', code: 'runtime_degraded_fatal', message: 'Runtime в состоянии DEGRADED_FATAL' },
      });
      return;
    }

    const event: Omit<CommandEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'> = {
      type: message.eventType,
      kind: 'command',
      priority: 'control',
      payload: message.payload ?? {},
    };
    if (message.correlationId !== undefined) {
      event.correlationId = message.correlationId;
    }
    await this.publish(event, 'external-ui');
  }

  listPlugins(): PluginRuntimeSnapshot[] {
    return [...this.pluginHosts.values()].map((host) => {
      const manifest = host.getManifest();
      const snapshot: PluginRuntimeSnapshot = {
        id: manifest?.id ?? host.descriptor.id,
        state: host.getState(),
        required: manifest?.required ?? false,
        telemetry: host.getTelemetry(),
      };
      const error = host.getLastError();
      if (error !== undefined) snapshot.error = error;
      return snapshot;
    });
  }

  getDroppedCounter(): number {
    return this.droppedCounter;
  }

  private createPluginHost(descriptor: PluginDescriptor): PluginHost {
    if (!this.sessionClock) {
      throw new Error('SessionClock не инициализирован');
    }
    const host = new PluginHost(descriptor, {
      onReady: (pluginId, manifest) => this.onPluginReady(pluginId, manifest),
      onEmit: async (pluginId, event) => this.publish(event, pluginId),
      onError: (pluginId, error) => this.onPluginError(pluginId, error),
      onMetric: (_pluginId, _metric) => {
        // `v1`: метрики отдельных плагинов не агрегируем отдельно, достаточно queue telemetry.
      },
    }, this.sessionClock.snapshot());
    this.pluginHosts.set(descriptor.id, host);
    return host;
  }

  private onPluginReady(_pluginId: string, manifest: PluginManifest): void {
    this.subscriptionIndex.setManifest(manifest);
  }

  private onPluginError(pluginId: string, error: Error): void {
    const host = this.pluginHosts.get(pluginId);
    const manifest = host?.getManifest();
    if (manifest?.required) {
      this.runtimeState = 'degraded_fatal';
    }

    this.emitControlFallback({
      message: {
        type: 'ui.error',
        code: 'plugin_failed',
        message: error.message,
        pluginId,
      },
    });
  }

  private emitControlFallback(payload: UiControlOutPayload): void {
    const syntheticEvent: RuntimeEvent = {
      seq: 0n,
      tsMonoMs: nowMonoMs(),
      sourcePluginId: 'runtime',
      type: EventTypes.uiControlOut,
      kind: 'fact',
      priority: 'system',
      payload,
    } as RuntimeEvent;
    this.options.uiSinks?.onControl?.(payload, syntheticEvent);
  }

  private async publishRuntimeTelemetry(): Promise<void> {
    const queues: QueueTelemetry[] = [...this.pluginHosts.values()].map((host) => host.getTelemetry());
    const payload: RuntimeTelemetrySnapshotPayload = {
      queues,
      dropped: this.droppedCounter,
    };
    await this.publish({
      type: EventTypes.runtimeTelemetrySnapshot,
      kind: 'fact',
      priority: 'system',
      payload,
    }, 'runtime');
  }

  /**
   * Публикует событие в runtime, назначает `seq` и маршрутизирует подписчикам.
   */
  private async publish(
    eventLike: Omit<RuntimeEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'>,
    sourcePluginId: RuntimeEvent['sourcePluginId'],
  ): Promise<void> {
    const event = {
      ...eventLike,
      seq: this.nextSeq++,
      tsMonoMs: nowMonoMs(),
      sourcePluginId,
    } as RuntimeEvent;

    // UI gateway публикует уже материализованные выходные сообщения — перехватываем их в runtime.
    if (event.type === EventTypes.uiControlOut && event.kind === 'fact') {
      this.options.uiSinks?.onControl?.(event.payload as UiControlOutPayload, event);
      return;
    }
    if (event.type === EventTypes.uiBinaryOut && event.kind === 'fact') {
      this.options.uiSinks?.onBinary?.(event.payload as UiBinaryOutPayload, event);
      return;
    }

    const subscribers = this.subscriptionIndex.getSubscribers(event);
    if (subscribers.length === 0) {
      return;
    }

    for (const [index, pluginId] of subscribers.entries()) {
      const host = this.pluginHosts.get(pluginId);
      if (!host) continue;

      let deliverEvent: RuntimeEvent;
      if (event.type === 'signal.batch') {
        // Для `v1` копируем payload на fan-out, чтобы безопасно передавать ownership в worker.
        const payload = (index === subscribers.length - 1)
          ? (event.payload as SignalBatchEvent['payload'])
          : cloneSignalBatchPayload(event.payload as SignalBatchEvent['payload']);
        deliverEvent = { ...(event as SignalBatchEvent), payload } as RuntimeEvent;
      } else {
        // Structured clone в worker все равно копирует объект; отдельная копия здесь не нужна.
        deliverEvent = event;
      }

      const result = host.enqueue(deliverEvent);
      if (!result.ok) {
        this.droppedCounter += 1;
        this.emitControlFallback({
          message: {
            type: 'ui.error',
            code: 'mailbox_overflow',
            message: result.reason,
            pluginId,
          },
        });
      }
    }
  }
}
