import type {
  PluginManifest,
  PluginMetric,
  RuntimeEvent,
  RuntimeEventInput,
} from '@sensync2/core';

export interface SessionClockApi {
  /**
   * Время в миллисекундах с момента старта текущей сессии runtime.
   */
  nowSessionMs(): number;
  /**
   * Абсолютное wall-clock время старта сессии.
   * Нужен для метаданных/экспорта, но не для data-path вычислений.
   */
  sessionStartWallMs(): number;
}

export interface TimelineResetPrepareContext {
  resetId: string;
  currentTimelineId: string;
  nextTimelineId: string;
  requestedAtSessionMs: number;
}

export interface TimelineResetAbortContext {
  resetId: string;
  currentTimelineId: string;
}

export interface TimelineResetCommitContext {
  resetId: string;
  nextTimelineId: string;
  timelineStartSessionMs: number;
}

export type TimelineResetRequestResultStatus = 'rejected' | 'aborted' | 'failed' | 'succeeded';

export interface TimelineResetRequestResultContext {
  requestId: string;
  status: TimelineResetRequestResultStatus;
  code: string;
  message: string;
  resetId?: string;
  nextTimelineId?: string;
  timelineStartSessionMs?: number;
}

export interface PluginContext {
  pluginId: string;
  clock: SessionClockApi;
  currentTimelineId(): string;
  timelineStartSessionMs(): number;
  emit<TEvent extends RuntimeEventInput>(event: TEvent): Promise<void>;
  setTimer(
    timerId: string,
    intervalMs: number,
    eventFactory: () => RuntimeEventInput,
  ): void;
  clearTimer(timerId: string): void;
  telemetry(metric: PluginMetric): void;
  getConfig<T = unknown>(): T;
  requestTimelineReset(reason?: string): string | null;
}

export interface PluginModule {
  manifest: PluginManifest;
  onInit(ctx: PluginContext): Promise<void>;
  onEvent(event: RuntimeEvent, ctx: PluginContext): Promise<void>;
  onTimelineResetPrepare?(input: TimelineResetPrepareContext, ctx: PluginContext): Promise<void>;
  onTimelineResetAbort?(input: TimelineResetAbortContext, ctx: PluginContext): Promise<void>;
  onTimelineResetCommit?(input: TimelineResetCommitContext, ctx: PluginContext): Promise<void>;
  onTimelineResetRequestResult?(input: TimelineResetRequestResultContext, ctx: PluginContext): Promise<void>;
  onShutdown(ctx: PluginContext): Promise<void>;
}

/**
 * Helper для типобезопасного экспорта плагина.
 */
export function definePlugin(module: PluginModule): PluginModule {
  return module;
}
