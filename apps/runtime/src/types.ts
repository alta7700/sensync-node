import type { PluginRuntimeSnapshot, RuntimeEvent, UiBinaryOutPayload, UiControlOutPayload, UiCommandMessage } from '@sensync2/core';
import type { SessionClockSnapshot } from './session-clock.ts';

export interface PluginDescriptor {
  /** Уникальный ID экземпляра плагина. Должен совпасть с manifest.id. */
  id: string;
  /** Абсолютный URL или package specifier для импорта worker-плагина. */
  modulePath: string;
  /** Конфиг конкретного плагина. */
  config?: unknown;
}

export interface RuntimeUiSinks {
  onControl?: (payload: UiControlOutPayload, event: RuntimeEvent) => void;
  onBinary?: (payload: UiBinaryOutPayload, event: RuntimeEvent) => void;
}

export type TimelineResetRequester = 'external-ui' | string;
export type TimelineResetCommitFailurePolicy = 'inherit-required' | 'degraded_fatal' | 'fail_participant';
export type TimelineResetRecorderPolicy = 'reject-if-recording';

export interface TimelineResetParticipantConfig {
  pluginId: string;
  onCommitFailure?: TimelineResetCommitFailurePolicy;
}

export interface TimelineResetRuntimeOptions {
  enabled: true;
  requesters: TimelineResetRequester[];
  participants: Array<string | TimelineResetParticipantConfig>;
  prepareTimeoutMs?: number;
  commitTimeoutMs?: number;
  recorderPolicy?: TimelineResetRecorderPolicy;
}

export interface RuntimeOptions {
  plugins: PluginDescriptor[];
  telemetryIntervalMs?: number;
  uiSinks?: RuntimeUiSinks;
  timelineReset?: TimelineResetRuntimeOptions;
}

export interface RuntimeHostPublic {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendUiCommand(message: UiCommandMessage, clientId: string): Promise<void>;
  attachUiClient(clientId: string): Promise<void>;
  detachUiClient(clientId: string): Promise<void>;
  listPlugins(): PluginRuntimeSnapshot[];
  getDroppedCounter(): number;
}

export interface RuntimeSessionClockInfo extends SessionClockSnapshot {}
