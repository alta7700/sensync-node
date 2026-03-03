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
        widgetIds: ['controls-main', 'status-main', 'chart-fake-a1', 'chart-fake-a2', 'chart-fake-b', 'telemetry-main'],
      },
    ],
    widgets: [
      {
        kind: 'controls',
        id: 'controls-main',
        title: 'Управление',
        controls: [
          {
            id: 'toggle-fake',
            kind: 'button',
            label: 'Подключить fake',
            commandType: EventTypes.adapterConnectRequest,
            payload: { adapterId: 'fake' },
            variants: [
              {
                when: { flag: 'adapter.fake.state', eq: 'connected' },
                label: 'Отключить fake',
                commandType: EventTypes.adapterDisconnectRequest,
                payload: { adapterId: 'fake' },
              },
              {
                when: { flag: 'adapter.fake.state', eq: 'connecting' },
                label: 'Подключение fake...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: 'adapter.fake.state', eq: 'disconnecting' },
                label: 'Отключение fake...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: 'adapter.fake.state', eq: 'disconnected' },
                label: 'Подключить fake',
                commandType: EventTypes.adapterConnectRequest,
                payload: { adapterId: 'fake' },
              },
            ],
          },
          {
            id: 'toggle-shapes',
            kind: 'button',
            label: 'Подключить shapes',
            commandType: EventTypes.adapterConnectRequest,
            payload: { adapterId: 'shapes' },
            variants: [
              {
                when: { flag: 'adapter.shapes.state', eq: 'connected' },
                label: 'Отключить shapes',
                commandType: EventTypes.adapterDisconnectRequest,
                payload: { adapterId: 'shapes' },
              },
              {
                when: { flag: 'adapter.shapes.state', eq: 'connecting' },
                label: 'Подключение shapes...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: 'adapter.shapes.state', eq: 'disconnecting' },
                label: 'Отключение shapes...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: 'adapter.shapes.state', eq: 'disconnected' },
                label: 'Подключить shapes',
                commandType: EventTypes.adapterConnectRequest,
                payload: { adapterId: 'shapes' },
              },
            ],
          },
          {
            id: 'shape-sine',
            label: 'Shape sine',
            kind: 'button',
            commandType: EventTypes.shapeGenerateRequest,
            payload: { shapeName: 'sine' },
            visible: false,
            variants: [
              {
                when: { flag: 'adapter.shapes.state', eq: 'connected' },
                visible: true,
              },
            ],
          },
          {
            id: 'shape-triangle',
            label: 'Shape triangle',
            kind: 'button',
            commandType: EventTypes.shapeGenerateRequest,
            payload: { shapeName: 'triangle' },
            hidden: true,
            variants: [
              {
                when: { flag: 'adapter.shapes.state', eq: 'connected' },
                hidden: false,
              },
            ],
          },
          {
            id: 'toggle-interval',
            kind: 'button',
            label: 'Запустить интервал',
            commandType: EventTypes.intervalStart,
            payload: {},
            variants: [
              {
                // Демонстрация составных условий: `and + not`.
                when: {
                  and: [
                    { flag: 'interval.active', eq: true },
                    { not: { flag: 'interval.active', eq: false } },
                  ],
                },
                label: 'Остановить интервал',
                commandType: EventTypes.intervalStop,
                payload: {},
              },
              {
                // До первого события флаг может отсутствовать, поэтому считаем `null` тем же, что `false`.
                when: {
                  or: [
                    { flag: 'interval.active', eq: false },
                    { flag: 'interval.active', eq: null },
                  ],
                },
                label: 'Запустить интервал',
                commandType: EventTypes.intervalStart,
                payload: {},
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
          'adapter.fake.state',
          'adapter.shapes.state',
          'interval.active',
          'activity.active',
          'shape.lastGenerated',
        ],
      },
      {
        kind: 'chart',
        id: 'chart-fake-a1',
        title: 'График 1 (Композитный, старые параметры)',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 10000,
        showLegend: true,
        series: [
          {
            type: 'line',
            streamId: 'fake.a1',
            label: 'Fake A1',
            color: '#58a6ff',
            lineWidth: 2,
          },
          {
            type: 'line',
            streamId: 'shapes.signal',
            label: 'Shapes',
            color: '#3fb950',
            fill: true,
            fillAlpha: 0.12,
          },
          {
            type: 'interval',
            streamId: 'interval.label',
            label: 'Interval',
            color: '#ff6b6b',
            alpha: 0.14,
            startLabel: 1,
            endLabel: 0,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-fake-a2',
        title: 'График 2 (Композитный, текущие параметры)',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 10000,
        showLegend: true,
        series: [
          {
            type: 'line',
            streamId: 'fake.a2',
            label: 'Fake A2',
            color: '#58a6ff',
            lineWidth: 2,
          },
          {
            type: 'line',
            streamId: 'shapes.signal',
            label: 'Shapes',
            color: '#3fb950',
            fill: true,
            fillAlpha: 0.12,
          },
          {
            type: 'interval',
            streamId: 'interval.label',
            label: 'Interval',
            color: '#ff6b6b',
            alpha: 0.14,
            startLabel: 1,
            endLabel: 0,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-fake-b',
        title: 'График 3',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 10000,
        showLegend: true,
        series: [
          {
            type: 'line',
            streamId: 'fake.b',
            label: 'Fake B',
            color: '#f85149',
            lineWidth: 2,
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
      { type: EventTypes.intervalStateChanged, kind: 'fact', priority: 'system' },
      { type: EventTypes.activityStateChanged, kind: 'fact', priority: 'system' },
      { type: EventTypes.shapeGenerated, kind: 'fact', priority: 'control' },
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

    if (event.type === EventTypes.intervalStateChanged) {
      const payload = (event as FactEvent<{ active: boolean }>).payload;
      const { patch, version } = patchFlags({ 'interval.active': payload.active });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      return;
    }

    if (event.type === EventTypes.activityStateChanged) {
      const payload = (event as FactEvent<{ active: boolean }>).payload;
      const { patch, version } = patchFlags({ 'activity.active': payload.active });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      return;
    }

    if (event.type === EventTypes.shapeGenerated) {
      const payload = (event as FactEvent<{ shapeName: string }>).payload;
      const { patch, version } = patchFlags({ 'shape.lastGenerated': payload.shapeName });
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
