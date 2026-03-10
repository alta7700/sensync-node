import {
  encodeUiSignalBatchFrameFromEvent,
  EventTypes,
  type FactEvent,
  type RuntimeTelemetrySnapshotPayload,
  type SignalBatchEvent,
  type UiBinaryOutPayload,
  type UiControlMessage,
  type UiControlOutPayload,
  type UiFlagPatch,
  type UiFlagSnapshot,
  type UiSchema,
  type UiStreamDeclaration,
} from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';

interface UiGatewayConfig {
  sessionId?: string;
}

let sessionId = 'sensync2-local';
let flags: UiFlagSnapshot = {};
let flagVersion = 0;
let nextStreamNumericId = 1;
const streamsById = new Map<string, UiStreamDeclaration>();

function baseSchema(): UiSchema {
  return {
    version: 1,
    pages: [
      {
        id: 'main',
        title: 'Main',
        widgetIds: [
          'controls-main',
          'status-main',
          'chart-emg',
          'chart-rr',
          'chart-moxy-smo2',
          'chart-moxy-thb',
          'chart-power',
          'chart-lactate',
          'telemetry-main',
        ],
        widgetRows: [
          ['controls-main', 'status-main'],
          ['chart-emg', 'chart-rr'],
          ['chart-moxy-smo2', 'chart-moxy-thb'],
          ['chart-power', 'chart-lactate'],
          ['telemetry-main'],
        ],
      },
    ],
    widgets: [
      {
        kind: 'controls',
        id: 'controls-main',
        title: 'Управление Replay',
        controls: [
          {
            id: 'toggle-replay',
            kind: 'button',
            label: 'Запустить replay',
            commandType: EventTypes.adapterConnectRequest,
            payload: { adapterId: 'velo-replay' },
            variants: [
              {
                when: { flag: 'adapter.velo-replay.state', eq: 'connected' },
                label: 'Остановить replay',
                commandType: EventTypes.adapterDisconnectRequest,
                payload: { adapterId: 'velo-replay' },
              },
              {
                when: { flag: 'adapter.velo-replay.state', eq: 'connecting' },
                label: 'Запуск replay...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: 'adapter.velo-replay.state', eq: 'disconnecting' },
                label: 'Остановка replay...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: 'adapter.velo-replay.state', eq: 'disconnected' },
                label: 'Запустить replay',
                commandType: EventTypes.adapterConnectRequest,
                payload: { adapterId: 'velo-replay' },
              },
            ],
          },
        ],
      },
      {
        kind: 'status',
        id: 'status-main',
        title: 'Статусы',
        flagKeys: [
          'adapter.velo-replay.state',
        ],
      },
      {
        kind: 'chart',
        id: 'chart-emg',
        title: 'EMG + Activity',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 20000,
        showLegend: true,
        yAxis: { min: -0.00035, max: 0.00035, label: 'mV (raw)' },
        series: [
          {
            type: 'line',
            streamId: 'trigno.avanti',
            label: 'trigno.avanti',
            color: '#58a6ff',
            lineWidth: 1,
          },
          {
            type: 'interval',
            streamId: 'trigno.avanti.activity',
            label: 'Activity',
            color: '#ff6b6b',
            alpha: 0.14,
            // В исходном `test.h5` activity хранится маркерами 0/1, где 0 = start, 1 = end.
            startLabel: 0,
            endLabel: 1,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-rr',
        title: 'Zephyr RR',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 20000,
        showLegend: true,
        yAxis: { min: 0.2, max: 1.2, label: 'sec' },
        series: [
          {
            type: 'line',
            streamId: 'zephyr.rr',
            label: 'zephyr.rr',
            color: '#58a6ff',
            lineWidth: 2,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-moxy-smo2',
        title: 'Moxy SmO2',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 120000,
        showLegend: true,
        yAxis: { min: 30, max: 90, label: '%' },
        series: [
          {
            type: 'line',
            streamId: 'moxy.smo2',
            label: 'moxy.smo2',
            color: '#12b886',
            lineWidth: 2,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-moxy-thb',
        title: 'Moxy tHb',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 120000,
        showLegend: true,
        yAxis: { min: 11.2, max: 12.2, label: 'g/dL' },
        series: [
          {
            type: 'line',
            streamId: 'moxy.thb',
            label: 'moxy.thb',
            color: '#f08c00',
            lineWidth: 2,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-power',
        title: 'Power',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 120000,
        showLegend: true,
        yAxis: { min: 0, max: 180, label: 'W' },
        series: [
          {
            type: 'line',
            streamId: 'power.watts',
            label: 'power.watts',
            color: '#f03e3e',
            lineWidth: 2,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-lactate',
        title: 'Lactate',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 120000,
        showLegend: true,
        yAxis: { min: 0, max: 6, label: 'mmol/L' },
        series: [
          {
            type: 'scatter',
            streamId: 'lactate.label',
            label: 'lactate.label',
            color: '#e64980',
            size: 8,
          },
        ],
      },
      {
        kind: 'telemetry',
        id: 'telemetry-main',
        title: 'Telemetry',
      },
    ],
  };
}

function emitControl(message: UiControlMessage, clientId?: string): Omit<FactEvent<UiControlOutPayload>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: UiControlOutPayload = { message };
  if (clientId !== undefined) payload.clientId = clientId;
  return {
    type: EventTypes.uiControlOut,
    kind: 'fact',
    priority: 'system',
    payload,
  };
}

function emitBinary(data: ArrayBuffer, clientId?: string): Omit<FactEvent<UiBinaryOutPayload>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: UiBinaryOutPayload = { data };
  if (clientId !== undefined) payload.clientId = clientId;
  return {
    type: EventTypes.uiBinaryOut,
    kind: 'fact',
    priority: 'system',
    payload,
  };
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
    channelId: event.payload.channelId,
    sampleFormat: event.payload.sampleFormat,
    frameKind: event.payload.frameKind,
  };
  if (event.payload.units !== undefined) declared.units = event.payload.units;
  if (event.payload.sampleRateHz !== undefined) declared.sampleRateHz = event.payload.sampleRateHz;
  streamsById.set(declared.streamId, declared);
  return { declared, stream: declared };
}

export default definePlugin({
  manifest: {
    id: 'ui-gateway',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: 'signal.batch', kind: 'data', priority: 'data' },
      { type: EventTypes.adapterStateChanged, kind: 'fact', priority: 'system' },
      { type: EventTypes.runtimeTelemetrySnapshot, kind: 'fact', priority: 'system' },
      { type: EventTypes.uiClientConnected, kind: 'fact', priority: 'system' },
    ],
    mailbox: {
      controlCapacity: 512,
      dataCapacity: 256,
      dataPolicy: 'coalesce-latest-per-stream',
    },
  },
  async onInit(ctx) {
    const cfg = ctx.getConfig<UiGatewayConfig>();
    if (cfg?.sessionId) {
      sessionId = cfg.sessionId;
    }
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.uiClientConnected) {
      const clientId = (event as FactEvent<{ clientId: string }>).payload.clientId;
      const initMsg: UiControlMessage = {
        type: 'ui.init',
        sessionId,
        schema: baseSchema(),
        streams: [...streamsById.values()],
        flags,
        clock: {
          timeDomain: 'session',
          sessionStartWallMs: ctx.clock.sessionStartWallMs(),
        },
      };
      await ctx.emit(emitControl(initMsg, clientId));
      return;
    }

    if (event.type === EventTypes.adapterStateChanged) {
      const payload = (event as FactEvent<{ adapterId: string; state: string }>).payload;
      const { patch, version } = patchFlags({ [`adapter.${payload.adapterId}.state`]: payload.state });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      return;
    }

    if (event.type === EventTypes.runtimeTelemetrySnapshot) {
      const payload = (event as FactEvent<RuntimeTelemetrySnapshotPayload>).payload;
      await ctx.emit(emitControl({ type: 'ui.telemetry', queues: payload.queues, dropped: payload.dropped }));
      return;
    }

    if (event.type === 'signal.batch') {
      const signalEvent = event as SignalBatchEvent;
      const { declared, stream } = ensureStream(signalEvent);
      if (declared) {
        await ctx.emit(emitControl({ type: 'ui.stream.declare', stream: declared }));
      }
      // В `v1` не храним replay для новых клиентов, только live-stream. Историю добавим позже в `v2`.
      const frame = encodeUiSignalBatchFrameFromEvent(signalEvent, stream.numericId);
      await ctx.emit(emitBinary(frame));
    }
  },
  async onShutdown() {
    streamsById.clear();
    flags = {};
    flagVersion = 0;
    nextStreamNumericId = 1;
  },
});
