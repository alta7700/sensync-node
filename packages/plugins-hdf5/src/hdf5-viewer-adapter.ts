import h5wasm from 'h5wasm/node';
import {
  defineRuntimeEventInput,
  EventTypes,
  type AdapterConnectRequestPayload,
  type AdapterDisconnectRequestPayload,
  type AdapterStateChangedPayload,
  type RuntimeEvent,
  type ViewerStateChangedPayload,
} from '@sensync2/core';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import {
  closeHdf5SimulationSession,
  loadHdf5SimulationSession,
  normalizeHdf5SimulationFilePath,
  readFullSignalForChannel,
  resetHdf5SimulationSessionCursor,
  type SimulationSessionState,
} from './hdf5-simulation-boundary.ts';

export interface Hdf5ViewerAdapterConfig {
  adapterId?: string;
  filePath?: string;
  allowConnectFilePathOverride?: boolean;
  streamIds?: string[];
  readChunkSamples?: number;
}

type ViewerRuntimeState = ViewerStateChangedPayload['state'];

const DefaultHdf5ViewerConfig: Required<Hdf5ViewerAdapterConfig> = {
  adapterId: 'hdf5-viewer',
  filePath: '',
  allowConnectFilePathOverride: false,
  streamIds: [],
  readChunkSamples: 4096,
};

let config = { ...DefaultHdf5ViewerConfig };
let session: SimulationSessionState | null = null;
let runtimeState: ViewerRuntimeState = 'disconnected';

function resolveHdf5ViewerConfig(
  rawConfig: Hdf5ViewerAdapterConfig | undefined,
): Required<Hdf5ViewerAdapterConfig> {
  const next = { ...DefaultHdf5ViewerConfig, ...(rawConfig ?? {}) };
  next.adapterId = typeof next.adapterId === 'string' && next.adapterId.length > 0
    ? next.adapterId
    : DefaultHdf5ViewerConfig.adapterId;

  const rawFilePath = typeof next.filePath === 'string' ? next.filePath.trim() : '';
  if (rawFilePath.length === 0 && !next.allowConnectFilePathOverride) {
    throw new Error('Не задан filePath для hdf5-viewer-adapter');
  }
  next.filePath = rawFilePath.length > 0 ? normalizeHdf5SimulationFilePath(rawFilePath) : '';
  next.streamIds = Array.isArray(next.streamIds)
    ? [...new Set(next.streamIds.map((value) => String(value).trim()).filter((value) => value.length > 0))]
    : [];
  next.readChunkSamples = Math.max(1, Math.trunc(next.readChunkSamples));
  return next;
}

function filePathFromConnectPayload(payload: AdapterConnectRequestPayload): string | null {
  const rawFilePath = payload.formData?.filePath;
  if (typeof rawFilePath !== 'string') {
    return null;
  }
  const normalized = rawFilePath.trim();
  return normalized.length > 0 ? normalized : null;
}

function closeCurrentSession(): void {
  closeHdf5SimulationSession(session);
  session = null;
}

function ensureViewerSession(filePath: string): SimulationSessionState {
  const normalizedFilePath = normalizeHdf5SimulationFilePath(filePath);
  if (session && session.filePath === normalizedFilePath) {
    return session;
  }

  closeCurrentSession();
  const nextSession = loadHdf5SimulationSession(normalizedFilePath, config.streamIds, config.readChunkSamples);
  session = nextSession;
  config.filePath = normalizedFilePath;
  return nextSession;
}

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

function makeViewerStateEvent(
  adapterId: string,
  state: ViewerRuntimeState,
  filePath: string,
  message?: string,
  requestId?: string,
) {
  const payload: ViewerStateChangedPayload = {
    adapterId,
    state,
    filePath,
    ...(session?.recordingStartSessionMs !== undefined ? { recordingStartSessionMs: session.recordingStartSessionMs } : {}),
    ...(session?.dataStartMs !== undefined ? { dataStartMs: session.dataStartMs } : {}),
    ...(session?.dataEndMs !== undefined ? { dataEndMs: session.dataEndMs } : {}),
  };
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return defineRuntimeEventInput({
    type: EventTypes.viewerStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

async function emitRuntimeState(ctx: PluginContext, nextState: ViewerRuntimeState, message?: string, requestId?: string): Promise<void> {
  runtimeState = nextState;
  await ctx.emit(makeAdapterStateEvent(config.adapterId, nextState, message, requestId));
  await ctx.emit(makeViewerStateEvent(
    config.adapterId,
    nextState,
    config.filePath,
    message,
    requestId,
  ));
}

async function connectViewer(ctx: PluginContext, payload: AdapterConnectRequestPayload): Promise<void> {
  if (runtimeState === 'connected' || runtimeState === 'connecting' || runtimeState === 'disconnecting') {
    return;
  }

  const connectFilePath = filePathFromConnectPayload(payload);
  try {
    if (connectFilePath) {
      ensureViewerSession(connectFilePath);
    } else if (!session) {
      if (config.allowConnectFilePathOverride) {
        await emitRuntimeState(ctx, 'failed', 'Выберите HDF5 файл для просмотра', payload.requestId);
        return;
      }
      if (config.filePath.length > 0) {
        ensureViewerSession(config.filePath);
      }
    }
  } catch (error) {
    await emitRuntimeState(
      ctx,
      'failed',
      error instanceof Error ? error.message : String(error),
      payload.requestId,
    );
    return;
  }

  if (!session) {
    await emitRuntimeState(ctx, 'failed', 'Файл просмотра не загружен', payload.requestId);
    return;
  }

  await emitRuntimeState(ctx, 'connecting', undefined, payload.requestId);

  try {
    resetHdf5SimulationSessionCursor(session);
    await emitRuntimeState(ctx, 'connected', undefined, payload.requestId);
    for (const channel of session.channels) {
      const event = readFullSignalForChannel(channel);
      if (!event) continue;
      await ctx.emit(event);
    }
  } catch (error) {
    closeCurrentSession();
    await emitRuntimeState(
      ctx,
      'failed',
      error instanceof Error ? error.message : String(error),
      payload.requestId,
    );
  }
}

async function disconnectViewer(ctx: PluginContext, payload: AdapterDisconnectRequestPayload): Promise<void> {
  if (runtimeState !== 'connected' && runtimeState !== 'failed') {
    return;
  }

  await emitRuntimeState(ctx, 'disconnecting', undefined, payload.requestId);
  closeCurrentSession();
  await emitRuntimeState(ctx, 'disconnected', undefined, payload.requestId);
}

export default definePlugin({
  manifest: {
    id: 'hdf5-viewer-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.adapterConnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, v: 1, kind: 'command', priority: 'control' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 64,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.adapterStateChanged, v: 1 },
      { type: EventTypes.viewerStateChanged, v: 1 },
      { type: EventTypes.signalBatch, v: 1 },
    ],
  },
  async onInit(ctx) {
    await h5wasm.ready;
    config = resolveHdf5ViewerConfig(ctx.getConfig<Hdf5ViewerAdapterConfig>());
    if (config.filePath.length > 0) {
      session = loadHdf5SimulationSession(config.filePath, config.streamIds, config.readChunkSamples);
    } else {
      session = null;
    }
    runtimeState = 'disconnected';
    const missingMessage = session && session.missingStreamIds.length > 0
      ? `Часть потоков не найдена в файле: ${session.missingStreamIds.join(', ')}`
      : undefined;
    const idleMessage = config.allowConnectFilePathOverride && config.filePath.length === 0
      ? 'Выберите HDF5 файл для просмотра'
      : missingMessage;
    await emitRuntimeState(ctx, 'disconnected', idleMessage);
  },
  async onEvent(event: RuntimeEvent, ctx) {
    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await connectViewer(ctx, payload);
      return;
    }

    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = event.payload;
      if (payload.adapterId !== config.adapterId) return;
      await disconnectViewer(ctx, payload);
    }
  },
  async onShutdown() {
    closeCurrentSession();
    runtimeState = 'disconnected';
  },
});
