import {
  defineRuntimeEventInput,
  EventTypes,
  type AdapterConnectRequestPayload,
  type AdapterDisconnectRequestPayload,
  type AdapterScanRequestPayload,
} from '@sensync2/core';
import {
  createAdapterStateHolder,
  createIrregularSignalEmitter,
  createOutputRegistry,
  createReconnectPolicy,
  createScanFlow,
} from '@sensync2/adapter-kit';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import {
  buildBleTransportConnectRequest,
  buildBleTransportScanRequest,
  normalizeBleError,
  previewBleHex,
  readZephyrBioHarnessEnvOverrides,
  resolveZephyrBioHarnessConfig,
  type BleTransportConnectRequest,
  type ZephyrBioHarnessAdapterConfig,
} from './ble-boundary.ts';
import { createBleTransport, type BleTransport } from './ble-central.ts';
import {
  createInitialZephyrRrExtractionState,
  extractZephyrRrSamples,
  parseZephyrPacket,
  resetZephyrRrExtractionState,
  type ZephyrRrExtractionState,
} from './zephyr-protocol.ts';

const ZephyrPollType = 'zephyr-bioharness.poll';
const ZephyrPollTimerId = 'zephyr-bioharness.poll';
const ZephyrPollIntervalMs = 250;
const NotificationSilenceTimeoutMs = 5_000;
const ZephyrRrStreamId = 'zephyr.rr';
const ZephyrOutputs = createOutputRegistry({
  rr: { streamId: ZephyrRrStreamId, units: 's' },
});
const zephyrEmitter = createIrregularSignalEmitter(ZephyrOutputs);

interface ZephyrScanCandidateData {
  scanId?: string;
  transportCandidateId?: string;
  peripheralId?: string;
  localName?: string;
}

let config = resolveZephyrBioHarnessConfig(undefined);
let transport: BleTransport | null = null;
let scanInFlight = false;
let manualDisconnectRequested = false;
let lastConnectRequest: BleTransportConnectRequest | null = null;
let reconnectReason: string | null = null;
let lastPacketSeenSessionMs: number | null = null;
let packetsReceived = 0;
let parseErrors = 0;
let rrSamplesReceived = 0;
let lastPacketKind: string | null = null;
let lastPacketSizeBytes: number | null = null;
let lastDisconnectReason: string | null = null;
let rrExtractionState: ZephyrRrExtractionState = resetZephyrRrExtractionState();
let zephyrState = createAdapterStateHolder({ adapterId: config.adapterId });
let zephyrScanFlow = createScanFlow<ZephyrScanCandidateData>({ adapterId: config.adapterId });
let reconnectPolicy = createReconnectPolicy({ initialDelayMs: config.reconnectRetryDelayMs });

function zephyrPollEvent() {
  return defineRuntimeEventInput({
    type: ZephyrPollType,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload: {},
  });
}

function normalizeError(error: unknown): string {
  return normalizeBleError(error);
}

async function setAdapterRuntimeState(
  ctx: PluginContext,
  state: Parameters<typeof zephyrState.setState>[1],
  requestId?: string,
  message?: string,
): Promise<void> {
  await zephyrState.setState(ctx, state, requestId, message);
}

function resetReconnectState(): void {
  reconnectReason = null;
  reconnectPolicy.reset();
}

function currentRuntimeState() {
  return zephyrState.getState();
}

function stringFormField(formData: Record<string, unknown> | undefined, key: string): string | undefined {
  const rawValue = formData?.[key];
  return typeof rawValue === 'string' && rawValue.trim().length > 0 ? rawValue.trim() : undefined;
}

function buildConnectRequestFromCandidate(formData: Record<string, unknown> | undefined): BleTransportConnectRequest {
  const connectRequest = buildBleTransportConnectRequest(formData);
  const selectedCandidateId = stringFormField(formData, 'candidateId');
  const scannedCandidate = selectedCandidateId ? zephyrScanFlow.getCandidateData(selectedCandidateId) : null;

  if (selectedCandidateId && scannedCandidate === null && connectRequest.peripheralId === undefined) {
    throw new Error('Выбранное устройство не найдено в последнем scan');
  }

  if (scannedCandidate) {
    if (scannedCandidate.scanId !== undefined) {
      connectRequest.scanId = scannedCandidate.scanId;
    }
    if (scannedCandidate.transportCandidateId !== undefined) {
      connectRequest.candidateId = scannedCandidate.transportCandidateId;
    }
    if (scannedCandidate.peripheralId !== undefined) {
      connectRequest.peripheralId = scannedCandidate.peripheralId;
    }
    if (connectRequest.localName === undefined && scannedCandidate.localName !== undefined) {
      connectRequest.localName = scannedCandidate.localName;
    }
  }

  return connectRequest;
}

function resetPacketStats(): void {
  lastPacketSeenSessionMs = null;
  packetsReceived = 0;
  parseErrors = 0;
  rrSamplesReceived = 0;
  lastPacketKind = null;
  lastPacketSizeBytes = null;
}

function resetRrStreamState(referenceTimestampMs: number | null = null): void {
  rrExtractionState = referenceTimestampMs === null
    ? resetZephyrRrExtractionState()
    : createInitialZephyrRrExtractionState(referenceTimestampMs);
}

function emitTransportTelemetry(ctx: PluginContext): void {
  const tags = {
    adapterId: config.adapterId,
    transport: transport?.mode ?? config.mode,
  };

  ctx.telemetry({ name: 'zephyr.packets_received', value: packetsReceived, unit: 'count', tags });
  ctx.telemetry({ name: 'zephyr.parse_errors', value: parseErrors, unit: 'count', tags });
  ctx.telemetry({ name: 'zephyr.rr_samples_received', value: rrSamplesReceived, unit: 'count', tags });
  ctx.telemetry({ name: 'zephyr.reconnect_attempt', value: reconnectPolicy.getAttempt(), unit: 'count', tags });
  if (lastPacketSeenSessionMs !== null) {
    ctx.telemetry({
      name: 'zephyr.last_packet_age_ms',
      value: Math.max(0, ctx.clock.nowSessionMs() - lastPacketSeenSessionMs),
      unit: 'ms',
      tags,
    });
  }
  if (lastPacketSizeBytes !== null) {
    ctx.telemetry({
      name: 'zephyr.last_packet_size_bytes',
      value: lastPacketSizeBytes,
      unit: 'bytes',
      tags,
    });
  }
  if (lastPacketKind !== null) {
    ctx.telemetry({
      name: 'zephyr.last_packet_kind',
      value: 1,
      tags: { ...tags, kind: lastPacketKind },
    });
  }
  if (lastDisconnectReason !== null) {
    ctx.telemetry({
      name: 'zephyr.disconnect_reason',
      value: 1,
      tags: { ...tags, reason: lastDisconnectReason },
    });
  }
}

function logDebug(scope: string, payload?: unknown): void {
  if (!config.logBleDebug) return;
  if (payload === undefined) {
    console.log('[zephyr-bioharness-adapter]', scope);
    return;
  }
  console.log('[zephyr-bioharness-adapter]', scope, payload);
}

function warnDebug(scope: string, payload?: unknown): void {
  if (!config.logBleDebug) return;
  if (payload === undefined) {
    console.warn('[zephyr-bioharness-adapter]', scope);
    return;
  }
  console.warn('[zephyr-bioharness-adapter]', scope, payload);
}

function startPolling(ctx: PluginContext): void {
  ctx.setTimer(ZephyrPollTimerId, ZephyrPollIntervalMs, zephyrPollEvent);
}

function stopPolling(ctx: PluginContext): void {
  ctx.clearTimer(ZephyrPollTimerId);
}

async function handleScan(ctx: PluginContext, payload: AdapterScanRequestPayload): Promise<void> {
  if (!transport) {
    throw new Error('BLE transport Zephyr не инициализирован');
  }
  if (scanInFlight) {
    throw new Error('Поиск Zephyr уже выполняется');
  }
  if (zephyrState.isState('connecting', 'disconnecting')) {
    throw new Error('Нельзя запускать поиск Zephyr во время connect/disconnect');
  }

  const activeTransport = transport;
  scanInFlight = true;
  try {
    await zephyrScanFlow.handleScanRequest(ctx, payload, async (scanPayload) => {
      const scanRequest = buildBleTransportScanRequest(scanPayload.formData, scanPayload.timeoutMs);
      logDebug('scan:request', { requestId: scanPayload.requestId, scanRequest });
      const result = await activeTransport.scan(scanRequest);
      logDebug('scan:result', {
        requestId: scanPayload.requestId,
        scanId: result.scanId,
        candidates: result.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          title: candidate.title,
          details: candidate.details,
        })),
      });
      return result.candidates.map((candidate) => {
        const localName = stringFormField(candidate.connectFormData, 'localName');
        const candidateData: ZephyrScanCandidateData = {
          scanId: result.scanId,
          transportCandidateId: candidate.candidateId,
          peripheralId: stringFormField(candidate.connectFormData, 'peripheralId') ?? candidate.candidateId,
        };
        if (localName !== undefined) candidateData.localName = localName;

        return {
          title: candidate.title,
          ...(candidate.subtitle !== undefined ? { subtitle: candidate.subtitle } : {}),
          ...(candidate.details !== undefined ? { details: candidate.details } : {}),
          data: candidateData,
        };
      });
    });
  } catch (error) {
    warnDebug('scan:error', { requestId: payload.requestId, message: normalizeError(error) });
  } finally {
    scanInFlight = false;
  }
}

async function handleConnect(ctx: PluginContext, payload: AdapterConnectRequestPayload): Promise<void> {
  if (!transport) {
    throw new Error('BLE transport Zephyr не инициализирован');
  }
  if (scanInFlight) {
    throw new Error('Дождись завершения поиска Zephyr перед подключением');
  }
  if (zephyrState.isState('connected', 'connecting', 'disconnecting')) {
    throw new Error('Zephyr уже подключается или подключён');
  }

  const connectRequest = buildConnectRequestFromCandidate(payload.formData);
  if (!connectRequest.candidateId) {
    throw new Error('Для подключения Zephyr нужно выбрать устройство из результатов scan');
  }

  logDebug('connect:request', { requestId: payload.requestId, connectRequest });
  manualDisconnectRequested = false;
  lastConnectRequest = connectRequest;
  resetReconnectState();
  resetPacketStats();
  await setAdapterRuntimeState(ctx, 'connecting', payload.requestId);

  try {
    await transport.connect(connectRequest);
    lastPacketSeenSessionMs = ctx.clock.nowSessionMs();
    lastDisconnectReason = null;
    resetRrStreamState(lastPacketSeenSessionMs);
    startPolling(ctx);
    logDebug('connect:success', { requestId: payload.requestId });
    await setAdapterRuntimeState(ctx, 'connected', payload.requestId);
  } catch (error) {
    stopPolling(ctx);
    await transport.disconnect().catch(() => undefined);
    lastDisconnectReason = normalizeError(error);
    resetRrStreamState();
    warnDebug('connect:error', { requestId: payload.requestId, message: lastDisconnectReason });
    await setAdapterRuntimeState(ctx, 'failed', payload.requestId, lastDisconnectReason);
  }
}

async function handleDisconnect(ctx: PluginContext, payload: AdapterDisconnectRequestPayload): Promise<void> {
  if (!transport) {
    throw new Error('BLE transport Zephyr не инициализирован');
  }
  if (!zephyrState.isState('connected', 'failed', 'connecting')) {
    return;
  }

  manualDisconnectRequested = true;
  lastConnectRequest = null;
  resetReconnectState();
  logDebug('disconnect:request', { requestId: payload.requestId, runtimeState: currentRuntimeState() });
  await setAdapterRuntimeState(ctx, 'disconnecting', payload.requestId);
  stopPolling(ctx);
  await transport.disconnect();
  lastDisconnectReason = null;
  resetPacketStats();
  resetRrStreamState();
  await setAdapterRuntimeState(ctx, 'disconnected', payload.requestId);
}

async function scheduleReconnect(ctx: PluginContext, reason: string): Promise<void> {
  if (!transport) return;
  lastDisconnectReason = reason;
  warnDebug('reconnect:schedule', {
    reason,
    manualDisconnectRequested,
    autoReconnect: config.autoReconnect,
    hasLastConnectRequest: lastConnectRequest !== null,
  });

  if (!config.autoReconnect || manualDisconnectRequested || !lastConnectRequest) {
    stopPolling(ctx);
    resetRrStreamState();
    await setAdapterRuntimeState(ctx, 'failed', undefined, reason);
    return;
  }
  if (reconnectPolicy.getNextAttemptSessionMs() !== null) {
    return;
  }

  reconnectReason = reason;
  reconnectPolicy.schedule(ctx.clock.nowSessionMs());
  await transport.disconnect().catch(() => undefined);
  logDebug('reconnect:armed', {
    reconnectAttempt: reconnectPolicy.getAttempt(),
    reconnectReason,
    reconnectNextAttemptSessionMs: reconnectPolicy.getNextAttemptSessionMs(),
  });
  await setAdapterRuntimeState(ctx, 'connecting', undefined, `Автопереподключение Zephyr: ${reason}`);
}

async function tryPendingReconnect(ctx: PluginContext): Promise<void> {
  if (!transport || !lastConnectRequest || reconnectPolicy.getNextAttemptSessionMs() === null) {
    return;
  }
  if (!reconnectPolicy.isReady(ctx.clock.nowSessionMs())) {
    return;
  }

  const reconnectAttempt = reconnectPolicy.getAttempt();
  logDebug('reconnect:attempt', {
    reconnectAttempt,
    reconnectReason,
    reconnectNextAttemptSessionMs: reconnectPolicy.getNextAttemptSessionMs(),
  });
  try {
    await transport.connect(lastConnectRequest);
    lastPacketSeenSessionMs = ctx.clock.nowSessionMs();
    lastDisconnectReason = null;
    resetRrStreamState(lastPacketSeenSessionMs);
    resetReconnectState();
    logDebug('reconnect:success', { reconnectAttempt });
    await setAdapterRuntimeState(ctx, 'connected', undefined, 'Автопереподключение Zephyr выполнено');
  } catch (error) {
    lastDisconnectReason = normalizeError(error);
    reconnectPolicy.schedule(ctx.clock.nowSessionMs());
    warnDebug('reconnect:error', {
      reconnectAttempt,
      message: lastDisconnectReason,
      nextAttemptSessionMs: reconnectPolicy.getNextAttemptSessionMs(),
    });
    await setAdapterRuntimeState(
      ctx,
      'connecting',
      undefined,
      `Автопереподключение Zephyr #${reconnectAttempt}: ${lastDisconnectReason}`,
    );
  }
}

async function emitRrSignalBatch(
  ctx: PluginContext,
  rrValues: readonly number[],
  seqNumber: number,
): Promise<void> {
  const extraction = extractZephyrRrSamples(rrValues, seqNumber, rrExtractionState, ctx.clock.nowSessionMs());
  rrExtractionState = extraction.state;
  if (extraction.sequenceGap) {
    warnDebug('packet:rr-sequence-gap', extraction.sequenceGap);
  }
  if (extraction.samples.length === 0) {
    return;
  }

  const values = new Float32Array(extraction.samples.length);
  const timestampsMs = new Float64Array(extraction.samples.length);
  extraction.samples.forEach((sample, index) => {
    values[index] = sample.intervalMs / 1000;
    timestampsMs[index] = sample.timestampMs;
  });
  rrSamplesReceived += extraction.samples.length;
  await zephyrEmitter.emit(ctx, 'rr', values, { timestampsMs });
}

async function handleTransportPacket(ctx: PluginContext, rawData: Buffer): Promise<void> {
  packetsReceived += 1;
  lastPacketSeenSessionMs = ctx.clock.nowSessionMs();
  lastPacketSizeBytes = rawData.length;
  logDebug('packet:raw', {
    bytes: rawData.length,
    hex: previewBleHex(rawData),
  });

  try {
    const packet = parseZephyrPacket(rawData);
    lastPacketKind = packet.kind;
    logDebug('packet:parsed', {
      kind: packet.kind,
      bytes: rawData.length,
      ...(packet.kind === 'r-to-r-data'
        ? { seqNumber: packet.seqNumber, rrCount: packet.rr.length }
        : { success: packet.success }),
    });
    if (packet.kind === 'r-to-r-data') {
      await emitRrSignalBatch(ctx, packet.rr, packet.seqNumber);
      return;
    }
    if (!packet.success) {
      await scheduleReconnect(ctx, 'Zephyr отклонил команду включения R-to-R передачи');
    }
  } catch (error) {
    parseErrors += 1;
    lastPacketKind = 'parse-error';
    warnDebug('packet:parse-error', {
      message: normalizeError(error),
      bytes: rawData.length,
      hex: previewBleHex(rawData),
    });
  }
}

async function handlePoll(ctx: PluginContext): Promise<void> {
  if (!transport) return;

  if (currentRuntimeState() === 'connecting' && reconnectPolicy.getNextAttemptSessionMs() !== null) {
    await tryPendingReconnect(ctx);
  }

  if (zephyrState.isState('connected')) {
    const connectionSignal = transport.takeConnectionSignal();
    if (connectionSignal) {
      warnDebug('poll:connection-signal', { signal: connectionSignal });
      await scheduleReconnect(ctx, connectionSignal);
      emitTransportTelemetry(ctx);
      return;
    }

    let packet = transport.readPacket();
    while (packet) {
      await handleTransportPacket(ctx, packet.data);
      if (!zephyrState.isState('connected')) {
        emitTransportTelemetry(ctx);
        return;
      }
      packet = transport.readPacket();
    }

    if (
      !manualDisconnectRequested
      && lastPacketSeenSessionMs !== null
      && (ctx.clock.nowSessionMs() - lastPacketSeenSessionMs) >= NotificationSilenceTimeoutMs
    ) {
      warnDebug('poll:notification-silence', {
        lastPacketSeenSessionMs,
        nowSessionMs: ctx.clock.nowSessionMs(),
        timeoutMs: NotificationSilenceTimeoutMs,
      });
      await scheduleReconnect(ctx, 'От Zephyr слишком долго не приходят BLE notifications');
    }
  }

  emitTransportTelemetry(ctx);
}

export default definePlugin({
  manifest: {
    id: 'zephyr-bioharness-3-adapter',
    version: '0.1.0',
    required: false,
    subscriptions: [
      { type: EventTypes.adapterScanRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterConnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: EventTypes.adapterDisconnectRequest, v: 1, kind: 'command', priority: 'control' },
      { type: ZephyrPollType, v: 1, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 256,
      dataCapacity: 32,
      dataPolicy: 'coalesce-latest-per-stream',
    },
    emits: [
      { type: EventTypes.adapterScanStateChanged, v: 1 },
      { type: EventTypes.adapterScanCandidates, v: 1 },
      { type: EventTypes.adapterStateChanged, v: 1 },
      { type: EventTypes.signalBatch, v: 1 },
      { type: ZephyrPollType, v: 1 },
    ],
  },
  async onInit(ctx) {
    const rawConfig = ctx.getConfig<ZephyrBioHarnessAdapterConfig>();
    config = resolveZephyrBioHarnessConfig({
      ...(rawConfig ?? {}),
      ...readZephyrBioHarnessEnvOverrides(process.env),
    });
    transport = createBleTransport(config);
    zephyrState = createAdapterStateHolder({ adapterId: config.adapterId });
    zephyrScanFlow = createScanFlow<ZephyrScanCandidateData>({ adapterId: config.adapterId });
    reconnectPolicy = createReconnectPolicy({ initialDelayMs: config.reconnectRetryDelayMs });
    scanInFlight = false;
    manualDisconnectRequested = false;
    lastConnectRequest = null;
    lastDisconnectReason = null;
    resetReconnectState();
    resetPacketStats();
    resetRrStreamState();
    logDebug('init:config', config);
    await zephyrState.emitCurrent(ctx);
    await ctx.emit(zephyrScanFlow.createScanStateEvent(false));
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.adapterScanRequest) {
      const payload = event.payload as AdapterScanRequestPayload;
      if (payload.adapterId !== config.adapterId) return;
      await handleScan(ctx, payload);
      return;
    }

    if (event.type === EventTypes.adapterConnectRequest) {
      const payload = event.payload as AdapterConnectRequestPayload;
      if (payload.adapterId !== config.adapterId) return;
      await handleConnect(ctx, payload);
      return;
    }

    if (event.type === EventTypes.adapterDisconnectRequest) {
      const payload = event.payload as AdapterDisconnectRequestPayload;
      if (payload.adapterId !== config.adapterId) return;
      await handleDisconnect(ctx, payload);
      return;
    }

    if (event.type === ZephyrPollType) {
      await handlePoll(ctx);
    }
  },
  async onShutdown(ctx) {
    stopPolling(ctx);
    if (transport) {
      await transport.disconnect().catch(() => undefined);
      transport = null;
    }
    zephyrState = createAdapterStateHolder({ adapterId: config.adapterId });
    zephyrScanFlow = createScanFlow<ZephyrScanCandidateData>({ adapterId: config.adapterId });
    reconnectPolicy = createReconnectPolicy({ initialDelayMs: config.reconnectRetryDelayMs });
    scanInFlight = false;
    manualDisconnectRequested = false;
    lastConnectRequest = null;
    lastDisconnectReason = null;
    resetReconnectState();
    resetPacketStats();
    resetRrStreamState();
  },
});
