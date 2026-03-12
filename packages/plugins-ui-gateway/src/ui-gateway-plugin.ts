import {
  encodeUiSignalBatchFrameFromEvent,
  EventTypes,
  type AdapterStateChangedPayload,
  type FactEvent,
  type RecordingErrorPayload,
  type RecordingStateChangedPayload,
  type RuntimeTelemetrySnapshotPayload,
  type SignalBatchEvent,
  type SimulationStateChangedPayload,
  type UiBinaryOutPayload,
  type UiControlAction,
  type UiControlMessage,
  type UiControlOutPayload,
  type UiControlWhen,
  type UiControlVariant,
  type UiFlagPatch,
  type UiFlagSnapshot,
  type UiSchema,
  type UiStreamDeclaration,
} from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';

type UiGatewayProfile = 'fake' | 'fake-hdf5-simulation';

interface UiGatewayConfig {
  sessionId?: string;
  profile?: UiGatewayProfile;
}

const FakeRecordingChannels = [
  { channelId: 'fake.a1', minSamples: 200, maxBufferedMs: 1_000 },
  { channelId: 'fake.a2', minSamples: 200, maxBufferedMs: 1_000 },
  { channelId: 'fake.b', minSamples: 200, maxBufferedMs: 1_000 },
  { channelId: 'shapes.signal', minSamples: 200, maxBufferedMs: 1_000 },
  { channelId: 'interval.label', minSamples: 1, maxBufferedMs: 500 },
  { channelId: 'activity.label', minSamples: 1, maxBufferedMs: 500 },
] as const;
const SimulationSpeedOptions = [0.25, 0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8] as const;

let sessionId = 'sensync2-local';
let profile: UiGatewayProfile = 'fake';
let flags: UiFlagSnapshot = {};
let flagVersion = 0;
let nextStreamNumericId = 1;
const streamsById = new Map<string, UiStreamDeclaration>();

function makeFakeRecordingStartPayload(): Record<string, unknown> {
  return {
    writer: 'local',
    filenameTemplate: '{testie}-{startDateTime}',
    // Пока UI умеет только кнопки, поэтому metadata в demo-профиле фиксированные.
    metadata: {
      testie: 'fake-demo',
      profile: 'fake',
    },
    channels: FakeRecordingChannels.map((item) => ({ ...item })),
  };
}

function makeSimulationSpeedControl(adapterId: string, speed: number): UiControlAction {
  const label = `${speed}x`;
  const activeLabel = `${speed}x ✓`;
  const pausedOrDisconnected: UiControlWhen = {
    or: [
      { flag: `adapter.${adapterId}.state`, eq: 'disconnected' },
      { flag: `adapter.${adapterId}.state`, eq: 'connected' },
      { flag: `adapter.${adapterId}.state`, eq: 'paused' },
    ],
  };

  const variants: UiControlVariant[] = [
    {
      when: {
        and: [
          pausedOrDisconnected,
          { flag: `simulation.${adapterId}.speed`, eq: speed },
        ],
      },
      label: activeLabel,
      commandType: EventTypes.simulationSpeedSetRequest,
      payload: { adapterId, speed },
      disabled: true,
    },
    {
      when: pausedOrDisconnected,
      label,
      commandType: EventTypes.simulationSpeedSetRequest,
      payload: { adapterId, speed },
      disabled: false,
    },
    {
      when: {
        or: [
          { flag: `adapter.${adapterId}.state`, eq: 'connecting' },
          { flag: `adapter.${adapterId}.state`, eq: 'disconnecting' },
        ],
      },
      label,
      disabled: true,
    },
  ];

  return {
    id: `speed-${String(speed).replace('.', '_')}`,
    kind: 'button',
    label,
    disabled: true,
    variants,
  };
}

function makeSimulationControlsWidget(adapterId: string, title: string): UiSchema['widgets'][number] {
  return {
    kind: 'controls',
    id: 'controls-main',
    title,
    controls: [
      {
        id: `toggle-${adapterId}`,
        kind: 'button',
        label: 'Подключить simulation',
        commandType: EventTypes.adapterConnectRequest,
        payload: { adapterId },
        variants: [
          {
            when: { flag: `adapter.${adapterId}.state`, eq: 'connected' },
            label: 'Пауза simulation',
            commandType: EventTypes.simulationPauseRequest,
            payload: { adapterId },
          },
          {
            when: { flag: `adapter.${adapterId}.state`, eq: 'paused' },
            label: 'Продолжить simulation',
            commandType: EventTypes.simulationResumeRequest,
            payload: { adapterId },
          },
          {
            when: { flag: `adapter.${adapterId}.state`, eq: 'connecting' },
            label: 'Подключение simulation...',
            disabled: true,
            isLoading: true,
          },
          {
            when: { flag: `adapter.${adapterId}.state`, eq: 'disconnecting' },
            label: 'Отключение simulation...',
            disabled: true,
            isLoading: true,
          },
          {
            when: { flag: `adapter.${adapterId}.state`, eq: 'disconnected' },
            label: 'Подключить simulation',
            commandType: EventTypes.adapterConnectRequest,
            payload: { adapterId },
          },
          {
            when: { flag: `adapter.${adapterId}.state`, eq: 'failed' },
            label: 'Simulation недоступна',
            disabled: true,
          },
        ],
      },
      {
        id: `disconnect-${adapterId}`,
        kind: 'button',
        label: 'Отключить simulation',
        hidden: true,
        variants: [
          {
            when: {
              or: [
                { flag: `adapter.${adapterId}.state`, eq: 'connected' },
                { flag: `adapter.${adapterId}.state`, eq: 'paused' },
              ],
            },
            label: 'Отключить simulation',
            commandType: EventTypes.adapterDisconnectRequest,
            payload: { adapterId },
            hidden: false,
            disabled: false,
          },
          {
            when: { flag: `adapter.${adapterId}.state`, eq: 'disconnecting' },
            label: 'Отключение simulation...',
            hidden: false,
            disabled: true,
            isLoading: true,
          },
        ],
      },
      ...SimulationSpeedOptions.map((speed) => makeSimulationSpeedControl(adapterId, speed)),
    ],
  };
}

function fakeSchema(): UiSchema {
  return {
    version: 1,
    pages: [
      {
        id: 'main',
        title: 'Main',
        widgetIds: [
          'controls-main',
          'status-main',
          'chart-fake-a1',
          'chart-fake-a2',
          'chart-fake-b',
          'telemetry-main',
        ],
        widgetRows: [
          ['controls-main', 'status-main'],
          ['chart-fake-a1'],
          ['chart-fake-a2'],
          ['chart-fake-b'],
          ['telemetry-main'],
        ],
      },
    ],
    widgets: [
      {
        kind: 'controls',
        id: 'controls-main',
        title: 'Управление Fake',
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
            kind: 'button',
            label: 'Форма sine',
            disabled: true,
            variants: [
              {
                when: { flag: 'adapter.shapes.state', eq: 'connected' },
                label: 'Форма sine',
                commandType: EventTypes.shapeGenerateRequest,
                payload: { shapeName: 'sine' },
                disabled: false,
              },
            ],
          },
          {
            id: 'shape-triangle',
            kind: 'button',
            label: 'Форма triangle',
            disabled: true,
            variants: [
              {
                when: { flag: 'adapter.shapes.state', eq: 'connected' },
                label: 'Форма triangle',
                commandType: EventTypes.shapeGenerateRequest,
                payload: { shapeName: 'triangle' },
                disabled: false,
              },
            ],
          },
          {
            id: 'shape-pulse',
            kind: 'button',
            label: 'Форма pulse',
            disabled: true,
            variants: [
              {
                when: { flag: 'adapter.shapes.state', eq: 'connected' },
                label: 'Форма pulse',
                commandType: EventTypes.shapeGenerateRequest,
                payload: { shapeName: 'pulse' },
                disabled: false,
              },
            ],
          },
          {
            id: 'toggle-interval',
            kind: 'button',
            label: 'Интервал недоступен',
            disabled: true,
            variants: [
              {
                when: {
                  and: [
                    { flag: 'adapter.fake.state', eq: 'connected' },
                    { flag: 'interval.active', eq: false },
                  ],
                },
                label: 'Старт интервала',
                commandType: EventTypes.intervalStart,
                payload: {},
                disabled: false,
              },
              {
                when: {
                  and: [
                    { flag: 'adapter.fake.state', eq: 'connected' },
                    { flag: 'interval.active', eq: true },
                  ],
                },
                label: 'Стоп интервала',
                commandType: EventTypes.intervalStop,
                payload: {},
                disabled: false,
              },
            ],
          },
          {
            id: 'toggle-recording',
            kind: 'button',
            label: 'Запись недоступна',
            disabled: true,
            variants: [
              {
                when: {
                  and: [
                    { flag: 'adapter.fake.state', eq: 'connected' },
                    {
                      or: [
                        { flag: 'recording.local.state', eq: 'idle' },
                        { flag: 'recording.local.state', eq: 'failed' },
                      ],
                    },
                  ],
                },
                label: 'Начать запись',
                commandType: EventTypes.recordingStart,
                payload: makeFakeRecordingStartPayload(),
                disabled: false,
              },
              {
                when: { flag: 'recording.local.state', eq: 'recording' },
                label: 'Пауза записи',
                commandType: EventTypes.recordingPause,
                payload: { writer: 'local' },
                disabled: false,
              },
              {
                when: { flag: 'recording.local.state', eq: 'paused' },
                label: 'Продолжить запись',
                commandType: EventTypes.recordingResume,
                payload: { writer: 'local' },
                disabled: false,
              },
              {
                when: { flag: 'recording.local.state', eq: 'starting' },
                label: 'Открытие файла...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: 'recording.local.state', eq: 'stopping' },
                label: 'Закрытие файла...',
                disabled: true,
                isLoading: true,
              },
            ],
          },
          {
            id: 'stop-recording',
            kind: 'button',
            label: 'Завершить запись',
            hidden: true,
            variants: [
              {
                when: {
                  or: [
                    { flag: 'recording.local.state', eq: 'recording' },
                    { flag: 'recording.local.state', eq: 'paused' },
                  ],
                },
                label: 'Завершить запись',
                commandType: EventTypes.recordingStop,
                payload: { writer: 'local' },
                hidden: false,
                disabled: false,
              },
              {
                when: { flag: 'recording.local.state', eq: 'stopping' },
                label: 'Закрытие файла...',
                hidden: false,
                disabled: true,
                isLoading: true,
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
          'recording.local.state',
          'recording.local.filePath',
        ],
      },
      {
        kind: 'chart',
        id: 'chart-fake-a1',
        title: 'Fake A1 + Shapes + Interval',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 20000,
        showLegend: true,
        yAxis: { min: -1.2, max: 1.2, label: 'a.u.' },
        series: [
          {
            type: 'line',
            streamId: 'fake.a1',
            label: 'fake.a1',
            color: '#58a6ff',
            lineWidth: 2,
          },
          {
            type: 'line',
            streamId: 'shapes.signal',
            label: 'shapes.signal',
            color: '#2f9e44',
            lineWidth: 2,
            lineStyle: 'dashed',
          },
          {
            type: 'interval',
            streamId: 'interval.label',
            label: 'interval',
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
        title: 'Fake A2 + Shapes + Interval',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 20000,
        showLegend: true,
        yAxis: { min: -1.2, max: 1.2, label: 'a.u.' },
        series: [
          {
            type: 'line',
            streamId: 'fake.a2',
            label: 'fake.a2',
            color: '#58a6ff',
            lineWidth: 2,
          },
          {
            type: 'line',
            streamId: 'shapes.signal',
            label: 'shapes.signal',
            color: '#2f9e44',
            lineWidth: 2,
            lineStyle: 'dashed',
          },
          {
            type: 'interval',
            streamId: 'interval.label',
            label: 'interval',
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
        title: 'Fake B',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 20000,
        showLegend: true,
        yAxis: { min: -0.7, max: 0.7, label: 'a.u.' },
        series: [
          {
            type: 'line',
            streamId: 'fake.b',
            label: 'fake.b',
            color: '#f59f00',
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

function fakeHdf5SimulationSchema(): UiSchema {
  const adapterId = 'fake-hdf5-simulation';
  return {
    version: 1,
    pages: [
      {
        id: 'main',
        title: 'Main',
        widgetIds: [
          'controls-main',
          'status-main',
          'chart-fake-a1',
          'chart-fake-a2',
          'chart-fake-b',
          'telemetry-main',
        ],
        widgetRows: [
          ['controls-main', 'status-main'],
          ['chart-fake-a1'],
          ['chart-fake-a2'],
          ['chart-fake-b'],
          ['telemetry-main'],
        ],
      },
    ],
    widgets: [
      makeSimulationControlsWidget(adapterId, 'Управление Fake HDF5 Simulation'),
      {
        kind: 'status',
        id: 'status-main',
        title: 'Статусы',
        flagKeys: [
          `adapter.${adapterId}.state`,
          `simulation.${adapterId}.speed`,
          `simulation.${adapterId}.filePath`,
          `simulation.${adapterId}.message`,
        ],
      },
      {
        kind: 'chart',
        id: 'chart-fake-a1',
        title: 'Fake A1 + Shapes + Interval',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 20000,
        showLegend: true,
        yAxis: { min: -1.2, max: 1.2, label: 'a.u.' },
        series: [
          {
            type: 'line',
            streamId: 'fake.a1',
            label: 'fake.a1',
            color: '#58a6ff',
            lineWidth: 2,
          },
          {
            type: 'line',
            streamId: 'shapes.signal',
            label: 'shapes.signal',
            color: '#2f9e44',
            lineWidth: 2,
            lineStyle: 'dashed',
          },
          {
            type: 'interval',
            streamId: 'interval.label',
            label: 'interval',
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
        title: 'Fake A2 + Shapes + Interval',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 20000,
        showLegend: true,
        yAxis: { min: -1.2, max: 1.2, label: 'a.u.' },
        series: [
          {
            type: 'line',
            streamId: 'fake.a2',
            label: 'fake.a2',
            color: '#58a6ff',
            lineWidth: 2,
          },
          {
            type: 'line',
            streamId: 'shapes.signal',
            label: 'shapes.signal',
            color: '#2f9e44',
            lineWidth: 2,
            lineStyle: 'dashed',
          },
          {
            type: 'interval',
            streamId: 'interval.label',
            label: 'interval',
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
        title: 'Fake B',
        renderer: 'echarts',
        height: 300,
        timeWindowMs: 20000,
        showLegend: true,
        yAxis: { min: -0.7, max: 0.7, label: 'a.u.' },
        series: [
          {
            type: 'line',
            streamId: 'fake.b',
            label: 'fake.b',
            color: '#f59f00',
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

function schemaForProfile(currentProfile: UiGatewayProfile): UiSchema {
  if (currentProfile === 'fake-hdf5-simulation') return fakeHdf5SimulationSchema();
  return fakeSchema();
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
      { type: EventTypes.recordingStateChanged, kind: 'fact', priority: 'system' },
      { type: EventTypes.recordingError, kind: 'fact', priority: 'system' },
      { type: EventTypes.simulationStateChanged, kind: 'fact', priority: 'system' },
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
    if (cfg?.profile === 'fake' || cfg?.profile === 'fake-hdf5-simulation') {
      profile = cfg.profile;
    }
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.uiClientConnected) {
      const clientId = (event as FactEvent<{ clientId: string }>).payload.clientId;
      const initMsg: UiControlMessage = {
        type: 'ui.init',
        sessionId,
        schema: schemaForProfile(profile),
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
      const payload = (event as FactEvent<AdapterStateChangedPayload>).payload;
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

    if (event.type === EventTypes.recordingStateChanged) {
      const payload = (event as FactEvent<RecordingStateChangedPayload>).payload;
      const { patch, version } = patchFlags({
        [`recording.${payload.writer}.state`]: payload.state,
        [`recording.${payload.writer}.filePath`]: payload.filePath ?? null,
        [`recording.${payload.writer}.message`]: payload.message ?? null,
      });
      await ctx.emit(emitControl({ type: 'ui.flags.patch', patch, version }));
      return;
    }

    if (event.type === EventTypes.recordingError) {
      const payload = (event as FactEvent<RecordingErrorPayload>).payload;
      await ctx.emit(emitControl({
        type: 'ui.error',
        code: payload.code,
        message: payload.message,
        pluginId: 'hdf5-recorder',
      }));
      return;
    }

    if (event.type === EventTypes.simulationStateChanged) {
      const payload = (event as FactEvent<SimulationStateChangedPayload>).payload;
      const { patch, version } = patchFlags({
        [`simulation.${payload.adapterId}.speed`]: payload.speed,
        [`simulation.${payload.adapterId}.batchMs`]: payload.batchMs,
        [`simulation.${payload.adapterId}.filePath`]: payload.filePath,
        [`simulation.${payload.adapterId}.message`]: payload.message ?? null,
      });
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
      const frame = encodeUiSignalBatchFrameFromEvent(signalEvent, stream.numericId);
      await ctx.emit(emitBinary(frame));
    }
  },
  async onShutdown() {
    streamsById.clear();
    flags = {};
    flagVersion = 0;
    nextStreamNumericId = 1;
    sessionId = 'sensync2-local';
    profile = 'fake';
  },
});
