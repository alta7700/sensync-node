import { parentPort } from 'node:worker_threads';
import type { TransferListItem } from 'node:worker_threads';
import {
  defineRuntimeEventInput,
  getSignalBatchTransferables,
  isSignalBatchEventInput,
  type MainToPluginWorkerMessage,
  type PluginToMainWorkerMessage,
  type RuntimeEvent,
  type RuntimeEventInput,
} from '@sensync2/core';
import type { PluginContext, PluginModule } from './index.ts';

interface WorkerState {
  plugin: PluginModule | null;
  config: unknown;
  sessionStartMonoNs: bigint | null;
  sessionStartWallMs: number;
  currentTimelineId: string;
  timelineStartSessionMs: number;
  queue: RuntimeEvent[];
  processing: boolean;
  shuttingDown: boolean;
  resetPhase: 'running' | 'preparing' | 'committing';
  activeResetId: string | null;
  timers: Map<string, TimerState>;
}

interface TimerState {
  intervalMs: number;
  nextDueMs: number;
  eventFactory: () => RuntimeEventInput;
  handle: ReturnType<typeof setTimeout> | null;
}

const state: WorkerState = {
  plugin: null,
  config: undefined,
  sessionStartMonoNs: null,
  sessionStartWallMs: 0,
  currentTimelineId: 'timeline-initializing',
  timelineStartSessionMs: 0,
  queue: [],
  processing: false,
  shuttingDown: false,
  resetPhase: 'running',
  activeResetId: null,
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

function clearAllTimers(): void {
  for (const timerId of [...state.timers.keys()]) {
    clearTimerState(timerId);
  }
  state.timers.clear();
}

function scheduleTimer(timerId: string): void {
  const timer = state.timers.get(timerId);
  if (!timer) return;
  const delayMs = Math.max(0, timer.nextDueMs - performance.now());
  timer.handle = setTimeout(() => {
    if (state.shuttingDown || state.resetPhase !== 'running') return;
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
    currentTimelineId() {
      return state.currentTimelineId;
    },
    timelineStartSessionMs() {
      return state.timelineStartSessionMs;
    },
    async emit<TEvent extends RuntimeEventInput>(event: TEvent) {
      if (state.resetPhase === 'preparing') {
        throw new Error(`Плагин ${pluginId} не может emit во время timeline reset prepare`);
      }
      const message: PluginToMainWorkerMessage = {
        kind: 'plugin.emit',
        event,
        timelineId: state.currentTimelineId,
      };

      if (isSignalBatchEventInput(event)) {
        post(message, getSignalBatchTransferables(event.payload));
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
        eventFactory: () => defineRuntimeEventInput(eventFactory()),
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
    requestTimelineReset(reason) {
      if (state.shuttingDown || state.resetPhase !== 'running') {
        return;
      }
      post({
        kind: 'plugin.timeline-reset.request',
        requestedByPluginId: pluginId,
        ...(reason !== undefined ? { reason } : {}),
      });
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
    ...(candidate.onTimelineResetPrepare ? { onTimelineResetPrepare: candidate.onTimelineResetPrepare } : {}),
    ...(candidate.onTimelineResetAbort ? { onTimelineResetAbort: candidate.onTimelineResetAbort } : {}),
    ...(candidate.onTimelineResetCommit ? { onTimelineResetCommit: candidate.onTimelineResetCommit } : {}),
  };
}

async function processQueue(): Promise<void> {
  if (state.processing || !state.plugin || state.resetPhase !== 'running') return;
  state.processing = true;
  const ctx = buildContext(state.plugin.manifest.id);

  try {
    while (state.queue.length > 0 && !state.shuttingDown && state.resetPhase === 'running') {
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
    if (state.queue.length > 0 && !state.shuttingDown && state.resetPhase === 'running') {
      // Если во время await пришли новые события, продолжаем без параллелизма.
      void processQueue();
    }
  }
}

async function handleInit(message: Extract<MainToPluginWorkerMessage, { kind: 'plugin.init' }>): Promise<void> {
  state.config = message.pluginConfig;
  state.sessionStartMonoNs = message.sessionStartMonoNs;
  state.sessionStartWallMs = message.sessionStartWallMs;
  state.currentTimelineId = message.currentTimelineId;
  state.timelineStartSessionMs = message.timelineStartSessionMs;
  const plugin = await loadPlugin(message.pluginModulePath);
  state.plugin = plugin;
  const ctx = buildContext(plugin.manifest.id);
  await plugin.onInit(ctx);
  post({ kind: 'plugin.ready', manifest: plugin.manifest });
}

async function handleShutdown(): Promise<void> {
  if (state.shuttingDown) return;
  state.shuttingDown = true;

  clearAllTimers();

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

async function waitUntilIdle(): Promise<void> {
  while (state.processing) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1);
    });
  }
}

async function handleTimelineResetPrepare(
  message: Extract<MainToPluginWorkerMessage, { kind: 'plugin.timeline-reset.prepare' }>,
): Promise<void> {
  if (!state.plugin) {
    throw new Error('Plugin worker не инициализирован');
  }
  if (state.activeResetId !== null) {
    post({
      kind: 'plugin.timeline-reset.failed',
      resetId: message.resetId,
      pluginId: state.plugin.manifest.id,
      message: 'Reset уже выполняется в worker',
    });
    return;
  }

  state.activeResetId = message.resetId;
  state.resetPhase = 'preparing';
  await waitUntilIdle();
  state.queue = [];
  clearAllTimers();

  const ctx = buildContext(state.plugin.manifest.id);
  try {
    await state.plugin.onTimelineResetPrepare?.({
      resetId: message.resetId,
      currentTimelineId: message.currentTimelineId,
      nextTimelineId: message.nextTimelineId,
      requestedAtSessionMs: message.requestedAtSessionMs,
    }, ctx);
    post({
      kind: 'plugin.timeline-reset.ready',
      resetId: message.resetId,
      pluginId: state.plugin.manifest.id,
    });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    state.resetPhase = 'running';
    state.activeResetId = null;
    post({
      kind: 'plugin.timeline-reset.failed',
      resetId: message.resetId,
      pluginId: state.plugin.manifest.id,
      message: normalized.message,
    });
  }
}

async function handleTimelineResetAbort(
  message: Extract<MainToPluginWorkerMessage, { kind: 'plugin.timeline-reset.abort' }>,
): Promise<void> {
  if (!state.plugin) {
    throw new Error('Plugin worker не инициализирован');
  }
  if (state.activeResetId !== message.resetId) {
    return;
  }

  const ctx = buildContext(state.plugin.manifest.id);
  try {
    await state.plugin.onTimelineResetAbort?.({
      resetId: message.resetId,
      currentTimelineId: message.currentTimelineId,
    }, ctx);
  } finally {
    state.resetPhase = 'running';
    state.activeResetId = null;
    if (state.queue.length > 0) {
      state.queue = [];
    }
  }
}

async function handleTimelineResetCommit(
  message: Extract<MainToPluginWorkerMessage, { kind: 'plugin.timeline-reset.commit' }>,
): Promise<void> {
  if (!state.plugin) {
    throw new Error('Plugin worker не инициализирован');
  }
  if (state.activeResetId !== message.resetId) {
    return;
  }

  state.currentTimelineId = message.nextTimelineId;
  state.timelineStartSessionMs = message.timelineStartSessionMs;
  state.resetPhase = 'committing';
  const ctx = buildContext(state.plugin.manifest.id);
  try {
    await state.plugin.onTimelineResetCommit?.({
      resetId: message.resetId,
      nextTimelineId: message.nextTimelineId,
      timelineStartSessionMs: message.timelineStartSessionMs,
    }, ctx);
    post({
      kind: 'plugin.timeline-reset.committed',
      resetId: message.resetId,
      pluginId: state.plugin.manifest.id,
    });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    post({
      kind: 'plugin.timeline-reset.failed',
      resetId: message.resetId,
      pluginId: state.plugin.manifest.id,
      message: normalized.message,
    });
  } finally {
    state.resetPhase = 'running';
    state.activeResetId = null;
    if (state.queue.length > 0) {
      state.queue = [];
    }
  }
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
        if (state.resetPhase !== 'running') {
          return;
        }
        state.queue.push(raw.event);
        void processQueue();
        return;
      }
      if (raw.kind === 'plugin.timeline-reset.prepare') {
        await handleTimelineResetPrepare(raw);
        return;
      }
      if (raw.kind === 'plugin.timeline-reset.abort') {
        await handleTimelineResetAbort(raw);
        return;
      }
      if (raw.kind === 'plugin.timeline-reset.commit') {
        await handleTimelineResetCommit(raw);
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
