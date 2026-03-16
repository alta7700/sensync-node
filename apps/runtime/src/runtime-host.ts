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
  type RecordingStateChangedPayload,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventOf,
  type RuntimeTelemetrySnapshotPayload,
  type TimelineResetRequestPayload,
  type UiClientConnectedPayload,
  type UiClientDisconnectedPayload,
  type UiCommandMessage,
  type UiControlOutPayload,
  type UiPluginMetric,
} from '@sensync2/core';
import { SubscriptionIndex } from './subscription-index.ts';
import { PluginHost } from './plugin-host.ts';
import type {
  PluginDescriptor,
  RuntimeHostPublic,
  RuntimeOptions,
  TimelineResetCommitFailurePolicy,
  TimelineResetRequester,
} from './types.ts';
import { SessionClock } from './session-clock.ts';
import { WorkspaceEventRegistry, describeEventRef, isEventAllowedForPlugin } from './workspace-event-registry.ts';
import { findWorkspaceUiCommandBoundaryGuard } from './workspace-ui-command-boundary.ts';

function nowMonoMs(): number {
  return performance.now();
}

interface NormalizedTimelineResetParticipant {
  pluginId: string;
  onCommitFailure: TimelineResetCommitFailurePolicy;
}

interface NormalizedTimelineResetConfig {
  enabled: true;
  requesters: Set<TimelineResetRequester>;
  participants: NormalizedTimelineResetParticipant[];
  prepareTimeoutMs: number;
  commitTimeoutMs: number;
  recorderPolicy: 'reject-if-recording';
}

interface ActiveTimelineReset {
  resetId: string;
  requestedBy: TimelineResetRequester;
  requestedAtSessionMs: number;
  nextTimelineId: string | null;
  readyPlugins: Set<string>;
  committedPlugins: Set<string>;
  failedParticipant: { pluginId: string; message: string } | null;
  bufferedEvents: RuntimeEvent[];
  waiters: Set<() => void>;
}

interface ResetBarrierHost {
  pluginId: string;
  host: PluginHost;
}

export class RuntimeHost implements RuntimeHostPublic {
  private options: RuntimeOptions;
  private timelineReset: NormalizedTimelineResetConfig | null;
  private subscriptionIndex = new SubscriptionIndex();
  private eventRegistry = new WorkspaceEventRegistry();
  private pluginHosts = new Map<string, PluginHost>();
  private nextSeq: bigint = 1n;
  private started = false;
  private stopped = false;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private droppedCounter = 0;
  private latestPluginMetrics = new Map<string, Map<string, UiPluginMetric>>();
  private latestRecordingStates = new Map<string, RecordingStateChangedPayload['state']>();
  private recentWarnings = new Map<string, number>();
  private runtimeState:
    | 'starting'
    | 'running'
    | 'reset_preparing'
    | 'reset_committing'
    | 'degraded_fatal'
    | 'stopping'
    | 'stopped' = 'starting';
  private sessionClock: SessionClock | null = null;
  private currentTimelineId = crypto.randomUUID();
  private timelineStartSessionMs = 0;
  private activeReset: ActiveTimelineReset | null = null;
  private pendingUiClientIds = new Set<string>();

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.timelineReset = this.normalizeTimelineResetOptions(options.timelineReset);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.sessionClock = new SessionClock();

    const hosts = this.options.plugins.map((descriptor) => this.createPluginHost(descriptor));
    await Promise.all(hosts.map((host) => host.start()));

    this.runtimeState = 'running';
    await this.publish({
      type: EventTypes.runtimeStarted,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {},
    }, 'runtime');

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
    if (this.runtimeState === 'reset_preparing' || this.runtimeState === 'reset_committing') {
      this.pendingUiClientIds.add(clientId);
      return;
    }
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
    if (this.pendingUiClientIds.delete(clientId)) {
      return;
    }
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

    if (message.eventType === EventTypes.timelineResetRequest) {
      await this.handleTimelineResetRequest('external-ui', rawPayload as TimelineResetRequestPayload);
      return;
    }

    if (this.runtimeState === 'reset_preparing' || this.runtimeState === 'reset_committing') {
      this.emitWarningFallback({
        code: 'timeline_reset_in_progress',
        message: 'Команда отклонена: timeline reset уже выполняется',
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
      onEmit: async (pluginId, event, timelineId) => this.publishFromPlugin(event, pluginId, timelineId),
      onTimelineResetRequest: async (pluginId, reason) => this.handleTimelineResetRequest(
        pluginId,
        reason !== undefined ? { reason } : {},
      ),
      onTimelineResetReady: (resetId, pluginId) => this.onTimelineResetReady(resetId, pluginId),
      onTimelineResetFailed: (resetId, pluginId, message) => this.onTimelineResetFailed(resetId, pluginId, message),
      onTimelineResetCommitted: (resetId, pluginId) => this.onTimelineResetCommitted(resetId, pluginId),
      onError: (pluginId, error) => this.onPluginError(pluginId, error),
      onMetric: (pluginId, metric) => this.onPluginMetric(pluginId, metric),
    }, this.sessionClock.snapshot(), {
      currentTimelineId: this.currentTimelineId,
      timelineStartSessionMs: this.timelineStartSessionMs,
    });
    this.pluginHosts.set(descriptor.id, host);
    return host;
  }

  private normalizeTimelineResetOptions(
    input: RuntimeOptions['timelineReset'],
  ): NormalizedTimelineResetConfig | null {
    if (!input?.enabled) {
      return null;
    }

    const knownPluginIds = new Set(this.options.plugins.map((plugin) => plugin.id));
    const requesters = new Set<TimelineResetRequester>();
    for (const requester of input.requesters) {
      if (requester !== 'external-ui' && !knownPluginIds.has(requester)) {
        throw new Error(`Timeline reset requester "${requester}" отсутствует в profile plugins`);
      }
      requesters.add(requester);
    }

    const seenParticipants = new Set<string>();
    const participants = input.participants.map((participant) => {
      const normalized: NormalizedTimelineResetParticipant = typeof participant === 'string'
        ? { pluginId: participant, onCommitFailure: 'inherit-required' }
        : {
            pluginId: participant.pluginId,
            onCommitFailure: participant.onCommitFailure ?? 'inherit-required',
          };
      if (!knownPluginIds.has(normalized.pluginId)) {
        throw new Error(`Timeline reset participant "${normalized.pluginId}" отсутствует в profile plugins`);
      }
      if (seenParticipants.has(normalized.pluginId)) {
        throw new Error(`Timeline reset profile содержит дублирующий participant "${normalized.pluginId}"`);
      }
      seenParticipants.add(normalized.pluginId);
      return normalized;
    });

    return {
      enabled: true,
      requesters,
      participants,
      prepareTimeoutMs: input.prepareTimeoutMs ?? 2_000,
      commitTimeoutMs: input.commitTimeoutMs ?? 2_000,
      recorderPolicy: input.recorderPolicy ?? 'reject-if-recording',
    };
  }

  private onTimelineResetReady(resetId: string, pluginId: string): void {
    if (!this.activeReset || this.activeReset.resetId !== resetId) {
      return;
    }
    this.activeReset.readyPlugins.add(pluginId);
    this.notifyResetWaiters();
  }

  private onTimelineResetFailed(resetId: string, pluginId: string, message: string): void {
    if (!this.activeReset || this.activeReset.resetId !== resetId) {
      return;
    }
    this.activeReset.failedParticipant = { pluginId, message };
    this.notifyResetWaiters();
  }

  private onTimelineResetCommitted(resetId: string, pluginId: string): void {
    if (!this.activeReset || this.activeReset.resetId !== resetId) {
      return;
    }
    this.activeReset.committedPlugins.add(pluginId);
    this.notifyResetWaiters();
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
    if (this.activeReset && (this.runtimeState === 'reset_preparing' || this.runtimeState === 'reset_committing')) {
      this.activeReset.failedParticipant = { pluginId, message: error.message };
      this.notifyResetWaiters();
    }
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
      timelineId: this.currentTimelineId,
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
      timelineId: this.currentTimelineId,
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

  private notifyResetWaiters(): void {
    if (!this.activeReset) {
      return;
    }
    for (const resolve of [...this.activeReset.waiters]) {
      resolve();
    }
  }

  private async waitForResetCondition(
    resetId: string,
    timeoutMs: number,
    predicate: (reset: ActiveTimelineReset) => boolean,
  ): Promise<ActiveTimelineReset> {
    const reset = this.activeReset;
    if (!reset || reset.resetId !== resetId) {
      throw new Error('Timeline reset состояние потеряно до завершения ожидания');
    }
    if (predicate(reset)) {
      return reset;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        reset.waiters.delete(onWake);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      const rejectSafely = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const resolveSafely = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };

      const onWake = () => {
        if (!this.activeReset || this.activeReset.resetId !== resetId) {
          rejectSafely(new Error('Timeline reset состояние потеряно до завершения ожидания'));
          return;
        }
        if (!predicate(this.activeReset)) {
          return;
        }
        resolveSafely();
      };

      timeoutHandle = setTimeout(() => {
        rejectSafely(new Error(`Timeline reset timeout (${timeoutMs} ms)`));
      }, timeoutMs);

      reset.waiters.add(onWake);
      onWake();
    });

    const current = this.activeReset;
    if (!current || current.resetId !== resetId) {
      throw new Error('Timeline reset состояние потеряно после ожидания');
    }
    return current;
  }

  private resolveCommitFailurePolicy(pluginId: string): 'degraded_fatal' | 'fail_participant' {
    const participant = this.timelineReset?.participants.find((entry) => entry.pluginId === pluginId);
    if (participant?.onCommitFailure === 'degraded_fatal') {
      return 'degraded_fatal';
    }
    if (participant?.onCommitFailure === 'fail_participant') {
      return 'fail_participant';
    }
    const manifest = this.pluginHosts.get(pluginId)?.getManifest();
    return manifest?.required ? 'degraded_fatal' : 'fail_participant';
  }

  private async handleTimelineResetRequest(
    requester: TimelineResetRequester,
    payload: TimelineResetRequestPayload,
  ): Promise<void> {
    const config = this.timelineReset;
    if (!config?.enabled) {
      this.emitWarningFallback({
        code: 'timeline_reset_disabled',
        message: 'Текущий профиль не поддерживает timeline reset',
        ...(requester !== 'external-ui' ? { pluginId: requester } : {}),
      });
      return;
    }
    if (!config.requesters.has(requester)) {
      this.emitWarningFallback({
        code: 'timeline_reset_forbidden',
        message: 'Requester не разрешён для timeline reset в текущем профиле',
        ...(requester !== 'external-ui' ? { pluginId: requester } : {}),
      });
      return;
    }
    if (this.runtimeState !== 'running') {
      this.emitWarningFallback({
        code: 'timeline_reset_in_progress',
        message: 'Timeline reset можно запускать только из состояния RUNNING',
      });
      return;
    }
    if (config.recorderPolicy === 'reject-if-recording' && this.hasActiveRecorder()) {
      this.emitWarningFallback({
        code: 'timeline_reset_recording_active',
        message: 'Timeline reset запрещён во время активной записи или паузы записи',
      });
      return;
    }

    const resetId = payload.requestId ?? crypto.randomUUID();
    const requestedAtSessionMs = this.sessionClock?.nowSessionMs() ?? 0;
    const nextTimelineId = crypto.randomUUID();
    const barrierHosts: ResetBarrierHost[] = [...this.pluginHosts.entries()].map(([pluginId, host]) => ({
      pluginId,
      host,
    }));

    this.activeReset = {
      resetId,
      requestedBy: requester,
      requestedAtSessionMs,
      nextTimelineId: null,
      readyPlugins: new Set<string>(),
      committedPlugins: new Set<string>(),
      failedParticipant: null,
      bufferedEvents: [],
      waiters: new Set(),
    };
    this.runtimeState = 'reset_preparing';

    try {
      await Promise.all(barrierHosts.map(({ host }) => host.quiesceAndDrain()));

      this.activeReset.nextTimelineId = nextTimelineId;
      for (const { host } of barrierHosts) {
        host.sendTimelineResetPrepare({
          resetId,
          currentTimelineId: this.currentTimelineId,
          nextTimelineId,
          requestedAtSessionMs,
        });
      }

      const prepared = await this.waitForResetCondition(
        resetId,
        config.prepareTimeoutMs,
        (reset) => reset.failedParticipant !== null || reset.readyPlugins.size === barrierHosts.length,
      );

      if (prepared.failedParticipant) {
        throw new Error(`prepare failed: ${prepared.failedParticipant.pluginId}: ${prepared.failedParticipant.message}`);
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      await this.abortTimelineReset(normalized.message, barrierHosts);
      return;
    }

    const timelineStartSessionMs = this.sessionClock?.nowSessionMs() ?? requestedAtSessionMs;
    this.currentTimelineId = nextTimelineId;
    this.timelineStartSessionMs = timelineStartSessionMs;
    this.runtimeState = 'reset_committing';

    for (const { host } of barrierHosts) {
      host.sendTimelineResetCommit({
        resetId,
        nextTimelineId,
        timelineStartSessionMs,
      });
    }

    let commitFailure: { pluginId: string; message: string } | null = null;
    try {
      const committed = await this.waitForResetCondition(
        resetId,
        config.commitTimeoutMs,
        (reset) => reset.failedParticipant !== null || reset.committedPlugins.size === barrierHosts.length,
      );

      if (committed.failedParticipant) {
        commitFailure = committed.failedParticipant;
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const timedOutHost = barrierHosts.find((entry) => !this.activeReset?.committedPlugins.has(entry.pluginId));
      commitFailure = {
        pluginId: timedOutHost?.pluginId ?? 'timeline-reset',
        message: normalized.message,
      };
    }

    if (commitFailure) {
      const flushBufferedEvents = this.handleCommitFailure(commitFailure.pluginId, commitFailure.message);
      await this.finishTimelineResetAfterCommitFailure(flushBufferedEvents);
      this.emitErrorFallback({
        code: 'timeline_reset_commit_failed',
        message: `${commitFailure.pluginId}: ${commitFailure.message}`,
        pluginId: commitFailure.pluginId,
      });
      return;
    }

    await this.finishTimelineResetSuccess();
  }

  private hasActiveRecorder(): boolean {
    for (const state of this.latestRecordingStates.values()) {
      if (state === 'recording' || state === 'paused') {
        return true;
      }
    }
    return false;
  }

  private async abortTimelineReset(
    reason: string,
    barrierHosts: ResetBarrierHost[],
  ): Promise<void> {
    const reset = this.activeReset;
    if (!reset) {
      return;
    }
    for (const { host } of barrierHosts) {
      host.sendTimelineResetAbort({
        resetId: reset.resetId,
        currentTimelineId: this.currentTimelineId,
      });
    }
    this.activeReset = null;
    this.runtimeState = 'running';
    for (const host of this.pluginHosts.values()) {
      host.resume();
    }
    await this.flushPendingUiClientAttaches();
    this.emitWarningFallback({
      code: 'timeline_reset_aborted',
      message: reason,
    });
  }

  private handleCommitFailure(pluginId: string, message: string): boolean {
    const failedHost = this.pluginHosts.get(pluginId);
    if (failedHost) {
      failedHost.forceFail(message);
      const policy = this.resolveCommitFailurePolicy(pluginId);
      if (policy === 'degraded_fatal') {
        this.runtimeState = 'degraded_fatal';
        return false;
      }
    }
    return true;
  }

  private async finishTimelineResetSuccess(): Promise<void> {
    await this.finalizeTimelineReset(true);
  }

  private async finishTimelineResetAfterCommitFailure(flushBufferedEvents: boolean): Promise<void> {
    await this.finalizeTimelineReset(flushBufferedEvents);
  }

  private async finalizeTimelineReset(flushBufferedEvents: boolean): Promise<void> {
    const reset = this.activeReset;
    if (!reset) {
      return;
    }
    const bufferedEvents = flushBufferedEvents ? [...reset.bufferedEvents] : [];
    this.activeReset = null;
    if (this.runtimeState !== 'degraded_fatal') {
      this.runtimeState = 'running';
    }
    for (const host of this.pluginHosts.values()) {
      host.resume();
    }
    for (const event of bufferedEvents) {
      await this.dispatchEvent(event);
    }
    await this.flushPendingUiClientAttaches();
  }

  private async flushPendingUiClientAttaches(): Promise<void> {
    if (this.pendingUiClientIds.size === 0) {
      return;
    }
    const clientIds = [...this.pendingUiClientIds];
    this.pendingUiClientIds.clear();
    for (const clientId of clientIds) {
      await this.attachUiClient(clientId);
    }
  }

  private async publishFromPlugin(
    eventLike: RuntimeEventInput,
    sourcePluginId: string,
    timelineId: string,
  ): Promise<void> {
    if (timelineId !== this.currentTimelineId) {
      return;
    }
    await this.publishInternal(eventLike, sourcePluginId, timelineId);
  }

  private async publish(
    eventLike: RuntimeEventInput,
    sourcePluginId: RuntimeEvent['sourcePluginId'],
  ): Promise<void> {
    await this.publishInternal(eventLike, sourcePluginId, this.currentTimelineId);
  }

  private async publishInternal(
    eventLike: RuntimeEventInput,
    sourcePluginId: RuntimeEvent['sourcePluginId'],
    timelineId: string,
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

    const event = attachRuntimeEventEnvelope(eventLike, this.nextSeq++, timelineId, nowMonoMs(), sourcePluginId);
    this.captureRuntimeState(event);

    if (this.runtimeState === 'reset_preparing') {
      return;
    }
    if (this.runtimeState === 'reset_committing') {
      this.activeReset?.bufferedEvents.push(event);
      return;
    }

    await this.dispatchEvent(event);
  }

  private captureRuntimeState(event: RuntimeEvent): void {
    if (event.type === EventTypes.recordingStateChanged) {
      const payload = event.payload as RecordingStateChangedPayload;
      this.latestRecordingStates.set(payload.writer, payload.state);
    }
  }

  private async dispatchEvent(event: RuntimeEvent): Promise<void> {

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
