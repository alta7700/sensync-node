import {
  defineRuntimeEventInput,
  encodeUiSignalBatchFrameFromEvent,
  EventTypes,
  type AdapterScanCandidatesPayload,
  type AdapterScanStateChangedPayload,
  type AdapterStateChangedPayload,
  type RecordingErrorPayload,
  type RecordingStateChangedPayload,
  type RuntimeTelemetrySnapshotPayload,
  type SignalBatchEvent,
  type SimulationStateChangedPayload,
  type UiBinaryOutPayload,
  type UiControlMessage,
  type UiControlOutPayload,
  type UiFlagPatch,
  type UiFlagSnapshot,
  type UiFormOption,
  type UiSchema,
  type UiStreamDeclaration,
} from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';
import { TrignoEventTypes, type TrignoStatusReportedPayload } from '@sensync2/plugins-trigno';
import { buildFakeUiSchema } from './profile-schemas.ts';

interface UiGatewayConfig {
  sessionId?: string;
  schema?: UiSchema;
}

let sessionId = 'sensync2-local';
let currentSchema: UiSchema = buildFakeUiSchema();
let flags: UiFlagSnapshot = {};
let flagVersion = 0;
let nextStreamNumericId = 1;
const streamsById = new Map<string, UiStreamDeclaration>();
const formOptionsBySourceId = new Map<string, UiFormOption[]>();

function emitControl(message: UiControlMessage, clientId?: string) {
  const payload: UiControlOutPayload = { message };
  if (clientId !== undefined) payload.clientId = clientId;
  return defineRuntimeEventInput({
    type: EventTypes.uiControlOut,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

function emitBinary(data: ArrayBuffer, clientId?: string) {
  const payload: UiBinaryOutPayload = { data };
  if (clientId !== undefined) payload.clientId = clientId;
  return defineRuntimeEventInput({
    type: EventTypes.uiBinaryOut,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

function patchFlags(patch: UiFlagPatch): { patch: UiFlagPatch; version: number } {
  flags = { ...flags, ...patch };
  flagVersion += 1;
  return { patch, version: flagVersion };
}

function ensureStream(event: SignalBatchEvent): { declared?: UiStreamDeclaration; stream: UiStreamDeclaration } {
  const existing = streamsById.get(event.payload.streamId);
  if (existing) {
    return { stream: existing };
  }

  const declared: UiStreamDeclaration = {
    streamId: event.payload.streamId,
    numericId: nextStreamNumericId++,
    label: event.payload.streamId,
    sampleFormat: event.payload.sampleFormat,
    frameKind: event.payload.frameKind,
  };
  if (event.payload.units !== undefined) declared.units = event.payload.units;
  if (event.payload.sampleRateHz !== undefined) declared.sampleRateHz = event.payload.sampleRateHz;
  streamsById.set(declared.streamId, declared);
  return { declared, stream: declared };
}

function scanCandidatesSourceId(adapterId: string): string {
  return `adapter.${adapterId}.scan.candidates`;
}

function candidateDetailsSummary(options: AdapterScanCandidatesPayload['candidates'][number]['details']): string | undefined {
  if (!options) return undefined;
  const parts = Object.entries(options).map(([key, value]) => `${key}: ${String(value)}`);
  return parts.length > 0 ? parts.join(' • ') : undefined;
}

function makeUiFormOptions(payload: AdapterScanCandidatesPayload): UiFormOption[] {
  return payload.candidates.map((candidate) => {
    const description = candidate.subtitle ?? candidateDetailsSummary(candidate.details);
    return {
      value: candidate.candidateId,
      label: candidate.title,
      ...(description !== undefined ? { description } : {}),
      payload: { ...candidate.connectFormData },
    };
  });
}

function setFormOptions(sourceId: string, options: UiFormOption[]): UiControlMessage {
  formOptionsBySourceId.set(sourceId, options);
  return {
    type: 'ui.form.options.patch',
    sourceId,
    options,
  };
}

export default definePlugin({
  manifest: {
    id: 'ui-gateway',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.signalBatch, v: 1, kind: 'data', priority: 'data' },
      { type: EventTypes.adapterScanStateChanged, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.adapterScanCandidates, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.adapterStateChanged, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.intervalStateChanged, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.activityStateChanged, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.recordingStateChanged, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.recordingError, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.simulationStateChanged, v: 1, kind: 'fact', priority: 'system' },
      { type: TrignoEventTypes.statusReported, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.runtimeTelemetrySnapshot, v: 1, kind: 'fact', priority: 'system' },
      { type: EventTypes.uiClientConnected, v: 1, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 512,
      dataCapacity: 256,
      dataPolicy: 'coalesce-latest-per-stream',
    },
    emits: [
      { type: EventTypes.uiControlOut, v: 1 },
      { type: EventTypes.uiBinaryOut, v: 1 },
    ],
  },
  async onInit(ctx) {
    const cfg = ctx.getConfig<UiGatewayConfig>();
    if (cfg?.sessionId) {
      sessionId = cfg.sessionId;
    }
    if (cfg?.schema) {
      currentSchema = cfg.schema;
    }
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.uiClientConnected) {
      const clientId = event.payload.clientId;
      const initMsg: UiControlMessage = {
        type: 'ui.init',
        sessionId,
        schema: currentSchema,
        streams: [...streamsById.values()],
        flags,
        clock: {
          timeDomain: 'session',
          sessionStartWallMs: ctx.clock.sessionStartWallMs(),
        },
      };
      await ctx.emit(emitControl(initMsg, clientId));
      for (const [sourceId, options] of formOptionsBySourceId.entries()) {
        await ctx.emit(emitControl({
          type: 'ui.form.options.patch',
          sourceId,
          options,
        }, clientId));
      }
      return;
    }

    if (event.type === EventTypes.adapterScanStateChanged) {
      const payload: AdapterScanStateChangedPayload = event.payload;
      const { patch, version } = patchFlags({
        [`adapter.${payload.adapterId}.scanning`]: payload.scanning,
        [`adapter.${payload.adapterId}.scanMessage`]: payload.message ?? null,
      });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      if (payload.scanning) {
        await ctx.emit(emitControl(setFormOptions(scanCandidatesSourceId(payload.adapterId), [])));
      }
      if (!payload.scanning && payload.message) {
        await ctx.emit(emitControl({
          type: 'ui.error',
          code: 'adapter_scan_failed',
          message: payload.message,
          pluginId: payload.adapterId,
        }));
      }
      return;
    }

    if (event.type === EventTypes.adapterScanCandidates) {
      const payload: AdapterScanCandidatesPayload = event.payload;
      const sourceId = scanCandidatesSourceId(payload.adapterId);
      await ctx.emit(emitControl(setFormOptions(sourceId, makeUiFormOptions(payload))));
      return;
    }

    if (event.type === EventTypes.adapterStateChanged) {
      const payload: AdapterStateChangedPayload = event.payload;
      const { patch, version } = patchFlags({
        [`adapter.${payload.adapterId}.state`]: payload.state,
        [`adapter.${payload.adapterId}.message`]: payload.message ?? null,
      });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      if (payload.state === 'failed' && payload.message) {
        await ctx.emit(emitControl({
          type: 'ui.error',
          code: 'adapter_connect_failed',
          message: payload.message,
          pluginId: payload.adapterId,
        }));
      }
      return;
    }

    if (event.type === EventTypes.intervalStateChanged) {
      const payload = event.payload;
      const { patch, version } = patchFlags({ 'interval.active': payload.active });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      return;
    }

    if (event.type === EventTypes.activityStateChanged) {
      const payload = event.payload;
      const { patch, version } = patchFlags({ 'activity.active': payload.active });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      return;
    }

    if (event.type === EventTypes.recordingStateChanged) {
      const payload: RecordingStateChangedPayload = event.payload;
      const { patch, version } = patchFlags({
        [`recording.${payload.writer}.state`]: payload.state,
        [`recording.${payload.writer}.filePath`]: payload.filePath ?? null,
        [`recording.${payload.writer}.message`]: payload.message ?? null,
      });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      return;
    }

    if (event.type === EventTypes.recordingError) {
      const payload: RecordingErrorPayload = event.payload;
      await ctx.emit(emitControl({
        type: 'ui.error',
        code: payload.code,
        message: payload.message,
        pluginId: 'hdf5-recorder',
      }));
      return;
    }

    if (event.type === EventTypes.simulationStateChanged) {
      const payload: SimulationStateChangedPayload = event.payload;
      const { patch, version } = patchFlags({
        [`simulation.${payload.adapterId}.speed`]: payload.speed,
        [`simulation.${payload.adapterId}.batchMs`]: payload.batchMs,
        [`simulation.${payload.adapterId}.filePath`]: payload.filePath,
        [`simulation.${payload.adapterId}.message`]: payload.message ?? null,
      });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      return;
    }

    if (event.type === TrignoEventTypes.statusReported) {
      const payload: TrignoStatusReportedPayload = event.payload;
      const { patch, version } = patchFlags({
        'trigno.host': payload.status.host,
        'trigno.sensorSlot': payload.status.sensorSlot,
        'trigno.mode': payload.status.mode,
        'trigno.startIndex': payload.status.startIndex,
        'trigno.serial': payload.status.serial ?? null,
        'trigno.firmware': payload.status.firmware ?? payload.status.protocolVersion ?? null,
        'trigno.backwardsCompatibility': payload.status.backwardsCompatibility,
        'trigno.upsampling': payload.status.upsampling,
        'trigno.emgRateHz': payload.status.emg.rateHz,
        'trigno.gyroRateHz': payload.status.gyro.rateHz,
      });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      return;
    }

    if (event.type === EventTypes.runtimeTelemetrySnapshot) {
      const payload: RuntimeTelemetrySnapshotPayload = event.payload;
      await ctx.emit(emitControl({
        type: 'ui.telemetry',
        queues: payload.queues,
        dropped: payload.dropped,
        metrics: payload.metrics,
      }));
      return;
    }

    if (event.type === EventTypes.signalBatch) {
      const { declared, stream } = ensureStream(event);
      if (declared) {
        await ctx.emit(emitControl({ type: 'ui.stream.declare', stream: declared }));
      }
      const frame = encodeUiSignalBatchFrameFromEvent(event, stream.numericId);
      await ctx.emit(emitBinary(frame));
    }
  },
  async onShutdown() {
    streamsById.clear();
    formOptionsBySourceId.clear();
    flags = {};
    flagVersion = 0;
    nextStreamNumericId = 1;
    sessionId = 'sensync2-local';
    currentSchema = buildFakeUiSchema();
  },
});
