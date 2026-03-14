import type { PluginManifest, PluginMetric } from './plugin.ts';
import type { RuntimeEvent, RuntimeEventInput } from './events.ts';

export interface PluginWorkerInitMessage {
  kind: 'plugin.init';
  pluginModulePath: string;
  pluginConfig?: unknown;
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

export type MainToPluginWorkerMessage =
  | PluginWorkerInitMessage
  | PluginWorkerDeliverMessage
  | PluginWorkerShutdownMessage;

export interface PluginWorkerReadyMessage {
  kind: 'plugin.ready';
  manifest: PluginManifest;
}

export interface PluginWorkerEmitMessage {
  kind: 'plugin.emit';
  event: RuntimeEventInput;
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

export type PluginToMainWorkerMessage =
  | PluginWorkerReadyMessage
  | PluginWorkerEmitMessage
  | PluginWorkerAckMessage
  | PluginWorkerTelemetryMessage
  | PluginWorkerErrorMessage
  | PluginWorkerSetTimerMessage
  | PluginWorkerClearTimerMessage;
