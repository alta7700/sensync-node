import {
  attachRuntimeEventEnvelope,
  cloneSignalBatchPayload,
  EventTypes,
  isSignalBatchEvent,
  uiCommandMessageToRuntimeEventInput,
  type PluginManifest,
  type PluginMetric,
  type PluginRuntimeSnapshot,
  type QueueTelemetry,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventOf,
  type RuntimeTelemetrySnapshotPayload,
  type UiClientConnectedPayload,
  type UiClientDisconnectedPayload,
  type UiCommandMessage,
  type UiControlOutPayload,
  type UiPluginMetric,
} from '@sensync2/core';
import { SubscriptionIndex } from './subscription-index.ts';
import { PluginHost } from './plugin-host.ts';
import type { PluginDescriptor, RuntimeHostPublic, RuntimeOptions } from './types.ts';
import { SessionClock } from './session-clock.ts';
import { WorkspaceEventRegistry, describeEventRef, isEventAllowedForPlugin } from './workspace-event-registry.ts';
import { findWorkspaceUiCommandBoundaryGuard } from './workspace-ui-command-boundary.ts';

function nowMonoMs(): number {
  return performance.now();
}

export class RuntimeHost implements RuntimeHostPublic {
  private options: RuntimeOptions;
  private subscriptionIndex = new SubscriptionIndex();
  private eventRegistry = new WorkspaceEventRegistry();
  private pluginHosts = new Map<string, PluginHost>();
  private nextSeq: bigint = 1n;
  private started = false;
  private stopped = false;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private droppedCounter = 0;
  private latestPluginMetrics = new Map<string, Map<string, UiPluginMetric>>();
  private recentWarnings = new Map<string, number>();
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
    this.latestPluginMetrics.clear();
    this.sessionClock = null;
    this.runtimeState = 'stopped';
  }

  async attachUiClient(clientId: string): Promise<void> {
    const payload: UiClientConnectedPayload = { clientId };
    await this.publish({
      type: EventTypes.uiClientConnected,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload,
    }, 'runtime');
  }

  async detachUiClient(clientId: string): Promise<void> {
    const payload: UiClientDisconnectedPayload = { clientId };
    await this.publish({
      type: EventTypes.uiClientDisconnected,
      v: 1,
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

    const guard = findWorkspaceUiCommandBoundaryGuard({
      type: message.eventType,
      v: message.eventVersion,
    });
    if (!guard) {
      this.emitWarningFallback({
        code: 'ui_command_unknown_contract',
        message: `UI прислал неизвестную команду ${message.eventType}@v${message.eventVersion}`,
      });
      return;
    }

    const contract = this.eventRegistry.get(guard);
    if (!contract) {
      this.emitWarningFallback({
        code: 'ui_command_unregistered_contract',
        message: `Команда ${message.eventType}@v${message.eventVersion} не зарегистрирована в runtime`,
      });
      return;
    }

    if (contract.kind !== 'command') {
      this.emitWarningFallback({
        code: 'ui_command_kind_mismatch',
        message: `UI не может отправлять ${describeEventRef(contract)} с kind=${contract.kind}`,
      });
      return;
    }

    const rawPayload = message.payload;
    if (!guard.isPayload(rawPayload)) {
      this.emitWarningFallback({
        code: 'ui_command_invalid_payload',
        message: `UI прислал некорректный payload для ${message.eventType}@v${message.eventVersion}`,
      });
      return;
    }

    const event = uiCommandMessageToRuntimeEventInput(message);
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
      onMetric: (pluginId, metric) => this.onPluginMetric(pluginId, metric),
    }, this.sessionClock.snapshot());
    this.pluginHosts.set(descriptor.id, host);
    return host;
  }

  private onPluginReady(_pluginId: string, manifest: PluginManifest): void {
    this.eventRegistry.validateManifest(manifest);
    this.subscriptionIndex.setManifest(manifest);
  }

  private onPluginMetric(pluginId: string, metric: PluginMetric): void {
    const metricKey = this.metricKey(metric);
    const nextMetric: UiPluginMetric = {
      pluginId,
      name: metric.name,
      value: metric.value,
      ...(metric.unit !== undefined ? { unit: metric.unit } : {}),
      ...(metric.tags !== undefined ? { tags: { ...metric.tags } } : {}),
    };
    const perPlugin = this.latestPluginMetrics.get(pluginId) ?? new Map<string, UiPluginMetric>();
    perPlugin.set(metricKey, nextMetric);
    this.latestPluginMetrics.set(pluginId, perPlugin);
  }

  private metricKey(metric: PluginMetric): string {
    const tags = metric.tags
      ? Object.entries(metric.tags)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join('|')
      : '';
    return `${metric.name}|${tags}`;
  }

  private onPluginError(pluginId: string, error: Error): void {
    const host = this.pluginHosts.get(pluginId);
    const manifest = host?.getManifest();
    if (manifest?.required) {
      this.runtimeState = 'degraded_fatal';
    }

    const adapterId = this.resolveAdapterIdForPlugin(pluginId);
    if (adapterId) {
      void this.publish({
        type: EventTypes.adapterStateChanged,
        v: 1,
        kind: 'fact',
        priority: 'system',
        payload: {
          adapterId,
          state: 'failed',
          message: error.message,
        },
      }, 'runtime');
    }

    this.emitErrorFallback({
      code: 'plugin_failed',
      message: error.message,
      pluginId,
    });
  }

  private emitErrorFallback(payload: { code: string; message: string; pluginId?: string }): void {
    this.emitControlFallback({
      message: {
        type: 'ui.error',
        code: payload.code,
        message: payload.message,
        ...(payload.pluginId !== undefined ? { pluginId: payload.pluginId } : {}),
      },
    });
  }

  private emitWarningFallback(payload: { code: string; message: string; pluginId?: string }): void {
    const warningKey = `${payload.code}|${payload.pluginId ?? ''}|${payload.message}`;
    const now = nowMonoMs();
    this.pruneRecentWarnings(now);
    const lastAt = this.recentWarnings.get(warningKey);
    if (lastAt !== undefined && (now - lastAt) < 2000) {
      return;
    }
    this.recentWarnings.set(warningKey, now);
    const syntheticEvent: RuntimeEventOf<typeof EventTypes.uiControlOut, 1> = {
      seq: 0n,
      v: 1,
      tsMonoMs: nowMonoMs(),
      sourcePluginId: 'runtime',
      type: EventTypes.uiControlOut,
      kind: 'fact',
      priority: 'system',
      payload: {
        message: {
          type: 'ui.warning',
          code: payload.code,
          message: payload.message,
          ...(payload.pluginId !== undefined ? { pluginId: payload.pluginId } : {}),
        },
      },
    };
    this.options.uiSinks?.onControl?.(syntheticEvent.payload, syntheticEvent);
  }

  /**
   * Ограничивает служебную карту дедупликации warning'ов, чтобы она не росла бесконечно
   * на длинной сессии с большим числом уникальных диагностик.
   */
  private pruneRecentWarnings(now: number): void {
    for (const [key, ts] of this.recentWarnings) {
      if ((now - ts) > 30000) {
        this.recentWarnings.delete(key);
      }
    }

    while (this.recentWarnings.size > 512) {
      const oldestKey = this.recentWarnings.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.recentWarnings.delete(oldestKey);
    }
  }

  /**
   * Для adapter-плагинов UI держит состояние по `adapterId`, а не по `pluginId`.
   * Если worker падает, сам плагин уже не сможет выпустить `adapter.state.changed`,
   * поэтому runtime пытается восстановить `adapterId` из descriptor config.
   */
  private resolveAdapterIdForPlugin(pluginId: string): string | null {
    const descriptor = this.pluginHosts.get(pluginId)?.descriptor;
    const config = descriptor?.config;
    if (!config || typeof config !== 'object') {
      return null;
    }
    const candidate = (config as { adapterId?: unknown }).adapterId;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  }

  private emitControlFallback(payload: UiControlOutPayload): void {
    const syntheticEvent: RuntimeEventOf<typeof EventTypes.uiControlOut, 1> = {
      seq: 0n,
      v: 1,
      tsMonoMs: nowMonoMs(),
      sourcePluginId: 'runtime',
      type: EventTypes.uiControlOut,
      kind: 'fact',
      priority: 'system',
      payload,
    };
    this.options.uiSinks?.onControl?.(payload, syntheticEvent);
  }

  private async publishRuntimeTelemetry(): Promise<void> {
    const queues: QueueTelemetry[] = [...this.pluginHosts.values()].map((host) => host.getTelemetry());
    const metrics: UiPluginMetric[] = [...this.latestPluginMetrics.values()]
      .flatMap((perPlugin) => [...perPlugin.values()])
      .sort((left, right) => {
        const pluginOrder = left.pluginId.localeCompare(right.pluginId);
        if (pluginOrder !== 0) return pluginOrder;
        return left.name.localeCompare(right.name);
      });
    const payload: RuntimeTelemetrySnapshotPayload = {
      queues,
      dropped: this.droppedCounter,
      metrics,
    };
    await this.publish({
      type: EventTypes.runtimeTelemetrySnapshot,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload,
    }, 'runtime');
  }

  /**
   * Публикует событие в runtime, назначает `seq` и маршрутизирует подписчикам.
   */
  private async publish(
    eventLike: RuntimeEventInput,
    sourcePluginId: RuntimeEvent['sourcePluginId'],
  ): Promise<void> {
    const contract = this.eventRegistry.get(eventLike);
    if (!contract) {
      this.emitWarningFallback({
        code: 'event_unknown_contract',
        message: `Шина отклонила неизвестное событие ${eventLike.type}@v${eventLike.v}`,
        ...(typeof sourcePluginId === 'string' && sourcePluginId !== 'runtime' && sourcePluginId !== 'external-ui'
          ? { pluginId: sourcePluginId }
          : {}),
      });
      return;
    }

    if (contract.kind !== eventLike.kind) {
      this.emitWarningFallback({
        code: 'event_kind_mismatch',
        message: `Шина отклонила ${describeEventRef(eventLike)}: kind=${eventLike.kind}, ожидается ${contract.kind}`,
        ...(typeof sourcePluginId === 'string' && sourcePluginId !== 'runtime' && sourcePluginId !== 'external-ui'
          ? { pluginId: sourcePluginId }
          : {}),
      });
      return;
    }
    if (contract.priority !== eventLike.priority) {
      this.emitWarningFallback({
        code: 'event_priority_mismatch',
        message: `Шина отклонила ${describeEventRef(eventLike)}: priority=${eventLike.priority}, ожидается ${contract.priority}`,
        ...(typeof sourcePluginId === 'string' && sourcePluginId !== 'runtime' && sourcePluginId !== 'external-ui'
          ? { pluginId: sourcePluginId }
          : {}),
      });
      return;
    }

    if (sourcePluginId !== 'runtime' && sourcePluginId !== 'external-ui') {
      const manifest = this.pluginHosts.get(sourcePluginId)?.getManifest();
      if (!manifest || !isEventAllowedForPlugin(manifest, eventLike)) {
        this.emitWarningFallback({
          code: 'event_emit_forbidden',
          message: `Плагин ${sourcePluginId} не объявил emit для ${describeEventRef(eventLike)}`,
          pluginId: sourcePluginId,
        });
        return;
      }
    }

    const event = attachRuntimeEventEnvelope(eventLike, this.nextSeq++, nowMonoMs(), sourcePluginId);

    // UI gateway публикует уже материализованные выходные сообщения — перехватываем их в runtime.
    if (event.type === EventTypes.uiControlOut && event.kind === 'fact') {
      this.options.uiSinks?.onControl?.(event.payload, event);
      return;
    }
    if (event.type === EventTypes.uiBinaryOut && event.kind === 'fact') {
      this.options.uiSinks?.onBinary?.(event.payload, event);
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
      if (isSignalBatchEvent(event)) {
        // Для `v1` копируем payload на fan-out, чтобы безопасно передавать ownership в worker.
        const payload = index === subscribers.length - 1
          ? event.payload
          : cloneSignalBatchPayload(event.payload);
        deliverEvent = { ...event, payload };
      } else {
        // Structured clone в worker все равно копирует объект; отдельная копия здесь не нужна.
        deliverEvent = event;
      }

      const result = host.enqueue(deliverEvent);
      if (!result.ok) {
        this.droppedCounter += 1;
        this.emitErrorFallback({
          code: 'mailbox_overflow',
          message: result.reason,
          pluginId,
        });
      }
    }
  }
}
