import type { PluginManifest, PluginMetric } from './plugin.ts';
import type { RuntimeEvent, RuntimeEventInput } from './events.ts';

export interface PluginWorkerInitMessage {
  kind: 'plugin.init';
  pluginModulePath: string;
  pluginConfig?: unknown;
  currentTimelineId: string;
  timelineStartSessionMs: number;
  /**
   * Монотонная отметка старта сессии в наносекундах (`process.hrtime.bigint()` в main runtime).
   * Используется в worker'ах для вычисления времени с начала сессии без привязки к локали.
   */
  sessionStartMonoNs: bigint;
  /**
   * Абсолютное время старта сессии (wall-clock) только для метаданных/экспорта.
   * Для data-path источником истины остается `session time`.
   */
  sessionStartWallMs: number;
}

export interface PluginWorkerDeliverMessage {
  kind: 'plugin.deliver';
  event: RuntimeEvent;
}

export interface PluginWorkerShutdownMessage {
  kind: 'plugin.shutdown';
}

export interface PluginWorkerTimelineResetPrepareMessage {
  kind: 'plugin.timeline-reset.prepare';
  resetId: string;
  currentTimelineId: string;
  nextTimelineId: string;
  requestedAtSessionMs: number;
}

export interface PluginWorkerTimelineResetAbortMessage {
  kind: 'plugin.timeline-reset.abort';
  resetId: string;
  currentTimelineId: string;
}

export interface PluginWorkerTimelineResetCommitMessage {
  kind: 'plugin.timeline-reset.commit';
  resetId: string;
  nextTimelineId: string;
  timelineStartSessionMs: number;
}

export type MainToPluginWorkerMessage =
  | PluginWorkerInitMessage
  | PluginWorkerDeliverMessage
  | PluginWorkerTimelineResetPrepareMessage
  | PluginWorkerTimelineResetAbortMessage
  | PluginWorkerTimelineResetCommitMessage
  | PluginWorkerShutdownMessage;

export interface PluginWorkerReadyMessage {
  kind: 'plugin.ready';
  manifest: PluginManifest;
}

export interface PluginWorkerEmitMessage {
  kind: 'plugin.emit';
  event: RuntimeEventInput;
  timelineId: string;
}

export interface PluginWorkerAckMessage {
  kind: 'plugin.ack';
  seq: bigint;
  handledMs: number;
}

export interface PluginWorkerTelemetryMessage {
  kind: 'plugin.telemetry';
  metric: PluginMetric;
}

export interface PluginWorkerErrorMessage {
  kind: 'plugin.error';
  message: string;
  stack?: string;
}

export type PluginTimerToken = string;

export interface PluginWorkerSetTimerMessage {
  kind: 'plugin.set-timer';
  timerId: PluginTimerToken;
  intervalMs: number;
  eventTemplate: RuntimeEventInput;
}

export interface PluginWorkerClearTimerMessage {
  kind: 'plugin.clear-timer';
  timerId: PluginTimerToken;
}

export interface PluginWorkerTimelineResetRequestMessage {
  kind: 'plugin.timeline-reset.request';
  requestedByPluginId: string;
  reason?: string;
}

export interface PluginWorkerTimelineResetReadyMessage {
  kind: 'plugin.timeline-reset.ready';
  resetId: string;
  pluginId: string;
}

export interface PluginWorkerTimelineResetFailedMessage {
  kind: 'plugin.timeline-reset.failed';
  resetId: string;
  pluginId: string;
  message: string;
}

export interface PluginWorkerTimelineResetCommittedMessage {
  kind: 'plugin.timeline-reset.committed';
  resetId: string;
  pluginId: string;
}

export type PluginToMainWorkerMessage =
  | PluginWorkerReadyMessage
  | PluginWorkerEmitMessage
  | PluginWorkerTimelineResetRequestMessage
  | PluginWorkerTimelineResetReadyMessage
  | PluginWorkerTimelineResetFailedMessage
  | PluginWorkerTimelineResetCommittedMessage
  | PluginWorkerAckMessage
  | PluginWorkerTelemetryMessage
  | PluginWorkerErrorMessage
  | PluginWorkerSetTimerMessage
  | PluginWorkerClearTimerMessage;
