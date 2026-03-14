import h5wasm from 'h5wasm/node';
import {
  defineRuntimeEventInput,
  EventTypes,
  type AdapterConnectRequestPayload,
  type AdapterDisconnectRequestPayload,
  type AdapterStateChangedPayload,
  type RuntimeEvent,
  type SimulationPauseRequestPayload,
  type SimulationResumeRequestPayload,
  type SimulationSpeedSetRequestPayload,
  type SimulationStateChangedPayload,
} from '@sensync2/core';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import {
  DefaultHdf5SimulationConfig,
  closeHdf5SimulationSession,
  isAllowedSimulationSpeed,
  loadHdf5SimulationSession,
  readSimulationWindowForChannel,
  resetHdf5SimulationSessionCursor,
  resolveHdf5SimulationConfig,
  type Hdf5SimulationAdapterConfig,
  type SimulationSessionState,
} from './hdf5-simulation-boundary.ts';

type SimulationRuntimeState = SimulationStateChangedPayload['state'];

const SimulationTickType = 'hdf5.simulation.tick';

let config = { ...DefaultHdf5SimulationConfig };
let session: SimulationSessionState | null = null;
let runtimeState: SimulationRuntimeState = 'disconnected';

function makeAdapterStateEvent(
  adapterId: string,
  state: AdapterStateChangedPayload['state'],
  message?: string,
  requestId?: string,
) {
  const payload: AdapterStateChangedPayload = { adapterId, state };
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return defineRuntimeEventInput({
    type: EventTypes.adapterStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

function makeSimulationStateEvent(
  adapterId: string,
  state: SimulationRuntimeState,
  speed: number,
  batchMs: number,
  filePath: string,
  message?: string,
  requestId?: string,
) {
  const payload: SimulationStateChangedPayload = {
    adapterId,
    state,
    speed,
    batchMs,
    filePath,
  };
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return defineRuntimeEventInput({
    type: EventTypes.simulationStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

async function emitRuntimeState(ctx: PluginContext, nextState: SimulationRuntimeState, message?: string, requestId?: string): Promise<void> {
  runtimeState = nextState;
  await ctx.emit(makeAdapterStateEvent(config.adapterId, nextState, message, requestId));
  await ctx.emit(makeSimulationStateEvent(config.adapterId, nextState, config.speed, config.batchMs, config.filePath, message, requestId));
}

async function emitSimulationSnapshot(ctx: PluginContext, message?: string, requestId?: string): Promise<void> {
  await ctx.emit(makeSimulationStateEvent(config.adapterId, runtimeState, config.speed, config.batchMs, config.filePath, message, requestId));
}

function stopTimer(ctx: PluginContext): void {
  ctx.clearTimer('hdf5.simulation.timer');
}

function startTimer(ctx: PluginContext): void {
  const intervalMs = Math.max(1, Math.round(config.batchMs / config.speed));
  ctx.setTimer('hdf5.simulation.timer', intervalMs, () => ({
    type: SimulationTickType,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload: {},
  }));
}

async function pauseSimulation(ctx: PluginContext, payload: SimulationPauseRequestPayload): Promise<void> {
  if (runtimeState !== 'connected') {
    await emitSimulationSnapshot(ctx, `Нельзя выполнить pause из состояния ${runtimeState}`, payload.requestId);
    return;
  }
  stopTimer(ctx);
  await emitRuntimeState(ctx, 'paused', undefined, payload.requestId);
}

async function resumeSimulation(ctx: PluginContext, payload: SimulationResumeRequestPayload): Promise<void> {
  if (runtimeState !== 'paused') {
    await emitSimulationSnapshot(ctx, `Нельзя выполнить resume из состояния ${runtimeState}`, payload.requestId);
    return;
  }
  startTimer(ctx);
  await emitRuntimeState(ctx, 'connected', undefined, payload.requestId);
}

async function setSimulationSpeed(ctx: PluginContext, payload: SimulationSpeedSetRequestPayload): Promise<void> {
  if (!isAllowedSimulationSpeed(payload.speed)) {
    await emitSimulationSnapshot(ctx, `Недопустимая скорость ${payload.speed}`, payload.requestId);
    return;
  }

  config.speed = payload.speed;
  if (runtimeState === 'connected') {
    startTimer(ctx);
  }
  await emitSimulationSnapshot(ctx, undefined, payload.requestId);
}

async function connectSimulation(ctx: PluginContext, payload: AdapterConnectRequestPayload): Promise<void> {
  if (!session) {
    await emitRuntimeState(ctx, 'failed', 'Файл симуляции не загружен', payload.requestId);
    return;
  }
  if (runtimeState === 'connected' || runtimeState === 'paused' || runtimeState === 'connecting' || runtimeState === 'disconnecting') {
    return;
  }

  await emitRuntimeState(ctx, 'connecting', undefined, payload.requestId);
  resetHdf5SimulationSessionCursor(session);
  startTimer(ctx);
  await emitRuntimeState(ctx, 'connected', undefined, payload.requestId);
}

async function disconnectSimulation(ctx: PluginContext, payload: AdapterDisconnectRequestPayload): Promise<void> {
  if (runtimeState !== 'connected' && runtimeState !== 'paused') {
    return;
  }

  await emitRuntimeState(ctx, 'disconnecting', undefined, payload.requestId);
  stopTimer(ctx);
  if (session) {
    resetHdf5SimulationSessionCursor(session);
  }
  await emitRuntimeState(ctx, 'disconnected', undefined, payload.requestId);
}

async function emitSimulationTick(ctx: PluginContext): Promise<void> {
  if (runtimeState !== 'connected' || !session) return;

  const windowEndMs = session.currentWindowStartMs + config.batchMs;
  for (const channel of session.channels) {
    const event = readSimulationWindowForChannel(channel, windowEndMs);
    if (!event) continue;
    await ctx.emit(event);
  }

  session.currentWindowStartMs = windowEndMs;
  session.cycleIndex += 1;

  const finished = session.channels.every((channel) => channel.cursor >= channel.sampleCount);
  if (finished && session.currentWindowStartMs >= session.dataEndMs) {
    stopTimer(ctx);
    await emitRuntimeState(ctx, 'disconnected', 'Симуляция завершена');
  }
}

export default definePlugin({
  manifest: {
    id: 'hdf5-simulation-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.adapterConnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.simulationPauseRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.simulationResumeRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.simulationSpeedSetRequest, v: 1, kind: 'command', priority: 'control' },
      { type: SimulationTickType, v: 1, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.adapterStateChanged, v: 1 },
      { type: EventTypes.simulationStateChanged, v: 1 },
      { type: EventTypes.signalBatch, v: 1 },
      { type: SimulationTickType, v: 1 },
    ],
  },
  async onInit(ctx) {
    await h5wasm.ready;
    config = resolveHdf5SimulationConfig(ctx.getConfig<Hdf5SimulationAdapterConfig>());
    session = loadHdf5SimulationSession(config.filePath, config.channelIds, config.readChunkSamples);
    runtimeState = 'disconnected';
    const missingMessage = session.missingChannelIds.length > 0
      ? `Часть каналов не найдена в файле: ${session.missingChannelIds.join(', ')}`
      : undefined;
    await emitRuntimeState(ctx, 'disconnected', missingMessage);
  },
  async onEvent(event: RuntimeEvent, ctx) {
    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await connectSimulation(ctx, payload);
      return;
    }

    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await disconnectSimulation(ctx, payload);
      return;
    }

    if (event.type === EventTypes.simulationPauseRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await pauseSimulation(ctx, payload);
      return;
    }

    if (event.type === EventTypes.simulationResumeRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await resumeSimulation(ctx, payload);
      return;
    }

    if (event.type === EventTypes.simulationSpeedSetRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await setSimulationSpeed(ctx, payload);
      return;
    }

    if (event.type === SimulationTickType) {
      await emitSimulationTick(ctx);
    }
  },
  async onShutdown(ctx) {
    stopTimer(ctx);
    closeHdf5SimulationSession(session);
    session = null;
    runtimeState = 'disconnected';
  },
});
