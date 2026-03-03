import { parentPort } from 'node:worker_threads';
import type { TransferListItem } from 'node:worker_threads';
import {
  getSignalBatchTransferables,
  type MainToPluginWorkerMessage,
  type PluginToMainWorkerMessage,
  type RuntimeEvent,
  type SignalBatchEvent,
} from '@sensync2/core';
import type { PluginContext, PluginModule } from './index.ts';

interface WorkerState {
  plugin: PluginModule | null;
  config: unknown;
  sessionStartMonoNs: bigint | null;
  sessionStartWallMs: number;
  queue: RuntimeEvent[];
  processing: boolean;
  shuttingDown: boolean;
  timers: Map<string, TimerState>;
}

interface TimerState {
  intervalMs: number;
  nextDueMs: number;
  eventFactory: () => Omit<RuntimeEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'>;
  handle: ReturnType<typeof setTimeout> | null;
}

const state: WorkerState = {
  plugin: null,
  config: undefined,
  sessionStartMonoNs: null,
  sessionStartWallMs: 0,
  queue: [],
  processing: false,
  shuttingDown: false,
  timers: new Map(),
};

function post(message: PluginToMainWorkerMessage, transferList?: readonly TransferListItem[]): void {
  if (!parentPort) {
    throw new Error('Plugin worker запущен без parentPort');
  }
  if (transferList && transferList.length > 0) {
    parentPort.postMessage(message, transferList);
    return;
  }
  parentPort.postMessage(message);
}

function emitError(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const message: PluginToMainWorkerMessage = {
    kind: 'plugin.error',
    message: normalized.message,
    ...(normalized.stack ? { stack: normalized.stack } : {}),
  };
  post(message);
}

function clearTimerState(timerId: string): void {
  const timer = state.timers.get(timerId);
  if (!timer) return;
  if (timer.handle) {
    clearTimeout(timer.handle);
  }
  state.timers.delete(timerId);
}

function scheduleTimer(timerId: string): void {
  const timer = state.timers.get(timerId);
  if (!timer) return;
  const delayMs = Math.max(0, timer.nextDueMs - performance.now());
  timer.handle = setTimeout(() => {
    if (state.shuttingDown) return;
    const current = state.timers.get(timerId);
    if (!current) return;

    // Таймер в worker'е не источник истины времени — он только "будильник" для событий.
    // Это позволяет плагинам считать батчи по elapsed session-time без дрейфа `setInterval`.
    void buildContext(state.plugin?.manifest.id ?? 'unknown').emit(current.eventFactory());

    const nowMs = performance.now();
    current.nextDueMs += current.intervalMs;
    while (current.nextDueMs <= nowMs) {
      current.nextDueMs += current.intervalMs;
    }
    scheduleTimer(timerId);
  }, delayMs);
}

function buildContext(pluginId: string): PluginContext {
  return {
    pluginId,
    clock: {
      nowSessionMs() {
        if (state.sessionStartMonoNs === null) {
          throw new Error('SessionClock не инициализирован в plugin worker');
        }
        const deltaNs = process.hrtime.bigint() - state.sessionStartMonoNs;
        return Number(deltaNs) / 1_000_000;
      },
      sessionStartWallMs() {
        return state.sessionStartWallMs;
      },
    },
    async emit(event) {
      const message: PluginToMainWorkerMessage = {
        kind: 'plugin.emit',
        event,
      };

      if (event.type === 'signal.batch' && 'payload' in event) {
        post(message, getSignalBatchTransferables((event as Omit<SignalBatchEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'>).payload));
        return;
      }

      post(message);
    },
    setTimer(timerId, intervalMs, eventFactory) {
      if (!(intervalMs > 0)) {
        throw new Error(`timer interval должен быть > 0, получено: ${intervalMs}`);
      }
      clearTimerState(timerId);

      const timer: TimerState = {
        intervalMs,
        nextDueMs: performance.now() + intervalMs,
        eventFactory,
        handle: null,
      };
      state.timers.set(timerId, timer);
      scheduleTimer(timerId);
    },
    clearTimer(timerId) {
      clearTimerState(timerId);
    },
    telemetry(metric) {
      post({ kind: 'plugin.telemetry', metric });
    },
    getConfig<T>() {
      return state.config as T;
    },
  };
}

async function loadPlugin(modulePath: string): Promise<PluginModule> {
  const loaded = await import(modulePath);
  const candidate = (loaded.default ?? loaded.plugin ?? loaded) as Partial<PluginModule>;
  if (!candidate || typeof candidate !== 'object' || !candidate.manifest) {
    throw new Error(`Модуль ${modulePath} не экспортирует PluginModule`);
  }

  // Заполняем пустые lifecycle-хуки, чтобы плагинам не приходилось дублировать boilerplate.
  return {
    manifest: candidate.manifest,
    onInit: candidate.onInit ?? (async () => {}),
    onEvent: candidate.onEvent ?? (async () => {}),
    onShutdown: candidate.onShutdown ?? (async () => {}),
  };
}

async function processQueue(): Promise<void> {
  if (state.processing || !state.plugin) return;
  state.processing = true;
  const ctx = buildContext(state.plugin.manifest.id);

  try {
    while (state.queue.length > 0 && !state.shuttingDown) {
      const event = state.queue.shift()!;
      const startedAt = performance.now();
      await state.plugin.onEvent(event, ctx);
      post({
        kind: 'plugin.ack',
        seq: event.seq,
        handledMs: performance.now() - startedAt,
      });
    }
  } catch (error) {
    emitError(error);
  } finally {
    state.processing = false;
    if (state.queue.length > 0 && !state.shuttingDown) {
      // Если во время await пришли новые события, продолжаем без параллелизма.
      void processQueue();
    }
  }
}

async function handleInit(message: Extract<MainToPluginWorkerMessage, { kind: 'plugin.init' }>): Promise<void> {
  state.config = message.pluginConfig;
  state.sessionStartMonoNs = message.sessionStartMonoNs;
  state.sessionStartWallMs = message.sessionStartWallMs;
  const plugin = await loadPlugin(message.pluginModulePath);
  state.plugin = plugin;
  const ctx = buildContext(plugin.manifest.id);
  await plugin.onInit(ctx);
  post({ kind: 'plugin.ready', manifest: plugin.manifest });
}

async function handleShutdown(): Promise<void> {
  if (state.shuttingDown) return;
  state.shuttingDown = true;

  for (const timerId of [...state.timers.keys()]) {
    clearTimerState(timerId);
  }
  state.timers.clear();

  if (state.plugin) {
    const ctx = buildContext(state.plugin.manifest.id);
    try {
      await state.plugin.onShutdown(ctx);
    } catch (error) {
      emitError(error);
    }
  }

  process.exit(0);
}

if (!parentPort) {
  throw new Error('Plugin worker должен запускаться через worker_threads');
}

parentPort.on('message', (raw: MainToPluginWorkerMessage) => {
  void (async () => {
    try {
      if (raw.kind === 'plugin.init') {
        await handleInit(raw);
        return;
      }
      if (raw.kind === 'plugin.deliver') {
        state.queue.push(raw.event);
        void processQueue();
        return;
      }
      if (raw.kind === 'plugin.shutdown') {
        await handleShutdown();
      }
    } catch (error) {
      emitError(error);
    }
  })();
});
