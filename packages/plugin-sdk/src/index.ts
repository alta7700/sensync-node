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

export interface PluginContext {
  pluginId: string;
  clock: SessionClockApi;
  emit<TEvent extends RuntimeEventInput>(event: TEvent): Promise<void>;
  setTimer(
    timerId: string,
    intervalMs: number,
    eventFactory: () => RuntimeEventInput,
  ): void;
  clearTimer(timerId: string): void;
  telemetry(metric: PluginMetric): void;
  getConfig<T = unknown>(): T;
}

export interface PluginModule {
  manifest: PluginManifest;
  onInit(ctx: PluginContext): Promise<void>;
  onEvent(event: RuntimeEvent, ctx: PluginContext): Promise<void>;
  onShutdown(ctx: PluginContext): Promise<void>;
}

/**
 * Helper для типобезопасного экспорта плагина.
 */
export function definePlugin(module: PluginModule): PluginModule {
  return module;
}
