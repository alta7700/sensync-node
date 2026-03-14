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
  type UiControlAction,
  type UiControlMessage,
  type UiControlOutPayload,
  type UiControlWhen,
  type UiControlVariant,
  type UiFlagPatch,
  type UiFlagSnapshot,
  type UiFormOption,
  type UiModalForm,
  type UiSchema,
  type UiStreamDeclaration,
} from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';
import { TrignoEventTypes, type TrignoStatusReportedPayload } from '@sensync2/plugins-trigno';

type UiGatewayProfile = 'fake' | 'fake-hdf5-simulation' | 'veloerg';

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
const formOptionsBySourceId = new Map<string, UiFormOption[]>();

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

function makeMoxyScanPayload(adapterId: string): Record<string, unknown> {
  return {
    adapterId,
    timeoutMs: 5_000,
    formData: {
      profile: 'muscle-oxygen',
    },
  };
}

function makeMoxyConnectModalForm(adapterId: string): UiModalForm {
  return {
    id: `connect-moxy-${adapterId}`,
    title: 'Выбор Moxy',
    submitLabel: 'Подключить',
    submitEventType: EventTypes.adapterConnectRequest,
    submitPayload: {
      adapterId,
      formData: {
        profile: 'muscle-oxygen',
      },
    },
    fields: [
      {
        kind: 'select',
        fieldId: 'candidateId',
        label: 'Устройство',
        required: true,
        sourceId: scanCandidatesSourceId(adapterId),
        placeholder: 'Выберите Moxy из результатов scan',
        mergeSelectedOptionPayload: true,
      },
    ],
  };
}

function makeZephyrScanPayload(adapterId: string): Record<string, unknown> {
  return {
    adapterId,
    timeoutMs: 5_000,
  };
}

function makeZephyrConnectModalForm(adapterId: string): UiModalForm {
  return {
    id: `connect-zephyr-${adapterId}`,
    title: 'Выбор Zephyr BioHarness 3',
    submitLabel: 'Подключить',
    submitEventType: EventTypes.adapterConnectRequest,
    submitPayload: {
      adapterId,
    },
    fields: [
      {
        kind: 'select',
        fieldId: 'candidateId',
        label: 'Устройство',
        required: true,
        sourceId: scanCandidatesSourceId(adapterId),
        placeholder: 'Выберите Zephyr из результатов scan',
        mergeSelectedOptionPayload: true,
      },
    ],
  };
}

function makeTrignoConnectModalForm(adapterId: string): UiModalForm {
  return {
    id: `connect-trigno-${adapterId}`,
    title: 'Подключение Trigno',
    submitLabel: 'Подключить',
    submitEventType: EventTypes.adapterConnectRequest,
    submitPayload: {
      adapterId,
    },
    fields: [
      {
        kind: 'column',
        children: [
          {
            kind: 'textInput',
            fieldId: 'host',
            label: 'Host',
            required: true,
            defaultValue: '10.9.15.71',
            placeholder: '10.9.15.71',
          },
          {
            kind: 'numberInput',
            fieldId: 'sensorSlot',
            label: 'Слот датчика',
            required: true,
            defaultValue: 1,
            min: 1,
            max: 16,
            step: 1,
          },
        ],
      },
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

function veloergSchema(): UiSchema {
  const moxyAdapterId = 'ant-plus';
  const zephyrAdapterId = 'zephyr-bioharness';
  const trignoAdapterId = 'trigno';
  return {
    version: 1,
    pages: [
      {
        id: 'main',
        title: 'Veloerg',
        widgetIds: [
          'controls-trigno',
          'status-main',
          'controls-main',
          'controls-zephyr',
          'chart-trigno-emg',
          'chart-trigno-gyro',
          'chart-moxy-smo2',
          'chart-moxy-thb',
          'chart-zephyr-rr',
          'telemetry-main',
        ],
        layout: {
          kind: 'column',
          gap: 12,
          children: [
            {
              kind: 'row',
              gap: 12,
              children: [
                {
                  kind: 'column',
                  gap: 12,
                  minWidth: 360,
                  children: [
                    { kind: 'widget', widgetId: 'controls-trigno' },
                    { kind: 'widget', widgetId: 'controls-main' },
                    { kind: 'widget', widgetId: 'controls-zephyr' },
                  ],
                },
                {
                  kind: 'widget',
                  widgetId: 'status-main',
                  minWidth: 420,
                },
              ],
            },
            {
              kind: 'row',
              gap: 12,
              children: [
                { kind: 'widget', widgetId: 'chart-trigno-emg', minWidth: 420 },
                { kind: 'widget', widgetId: 'chart-trigno-gyro', minWidth: 420 },
              ],
            },
            {
              kind: 'row',
              gap: 12,
              children: [
                { kind: 'widget', widgetId: 'chart-moxy-smo2', minWidth: 420 },
                { kind: 'widget', widgetId: 'chart-moxy-thb', minWidth: 420 },
              ],
            },
            {
              kind: 'row',
              gap: 12,
              children: [
                { kind: 'widget', widgetId: 'chart-zephyr-rr' },
              ],
            },
            {
              kind: 'row',
              gap: 12,
              children: [
                { kind: 'widget', widgetId: 'telemetry-main' },
              ],
            },
          ],
        },
      },
    ],
    widgets: [
      {
        kind: 'controls',
        id: 'controls-trigno',
        title: 'Trigno',
        controls: [
          {
            id: 'connect-trigno',
            kind: 'button',
            label: 'Подключить Trigno',
            modalForm: makeTrignoConnectModalForm(trignoAdapterId),
            variants: [
              {
                when: { flag: `adapter.${trignoAdapterId}.state`, eq: 'connecting' },
                label: 'Подключение Trigno...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: `adapter.${trignoAdapterId}.state`, eq: 'disconnecting' },
                label: 'Отключение Trigno...',
                disabled: true,
                isLoading: true,
              },
              {
                when: {
                  or: [
                    { flag: `adapter.${trignoAdapterId}.state`, eq: 'connected' },
                    { flag: `adapter.${trignoAdapterId}.state`, eq: 'paused' },
                  ],
                },
                label: 'Trigno подключён',
                disabled: true,
              },
              {
                when: { flag: `adapter.${trignoAdapterId}.state`, eq: 'failed' },
                label: 'Повторить подключение Trigno',
              },
            ],
          },
          {
            id: 'disconnect-trigno',
            kind: 'button',
            label: 'Отключить Trigno',
            hidden: true,
            variants: [
              {
                when: {
                  or: [
                    { flag: `adapter.${trignoAdapterId}.state`, eq: 'connected' },
                    { flag: `adapter.${trignoAdapterId}.state`, eq: 'paused' },
                    { flag: `adapter.${trignoAdapterId}.state`, eq: 'failed' },
                  ],
                },
                label: 'Отключить Trigno',
                commandType: EventTypes.adapterDisconnectRequest,
                payload: { adapterId: trignoAdapterId },
                hidden: false,
              },
              {
                when: { flag: `adapter.${trignoAdapterId}.state`, eq: 'disconnecting' },
                label: 'Отключение Trigno...',
                hidden: false,
                disabled: true,
                isLoading: true,
              },
            ],
          },
          {
            id: 'start-trigno',
            kind: 'button',
            label: 'Старт Trigno',
            hidden: true,
            variants: [
              {
                when: { flag: `adapter.${trignoAdapterId}.state`, eq: 'paused' },
                label: 'Старт Trigno',
                commandType: TrignoEventTypes.streamStartRequest,
                payload: { adapterId: trignoAdapterId },
                hidden: false,
              },
              {
                when: { flag: `adapter.${trignoAdapterId}.state`, eq: 'connecting' },
                label: 'Запуск Trigno...',
                hidden: false,
                disabled: true,
                isLoading: true,
              },
            ],
          },
          {
            id: 'stop-trigno',
            kind: 'button',
            label: 'Стоп Trigno',
            hidden: true,
            variants: [
              {
                when: { flag: `adapter.${trignoAdapterId}.state`, eq: 'connected' },
                label: 'Стоп Trigno',
                commandType: TrignoEventTypes.streamStopRequest,
                payload: { adapterId: trignoAdapterId },
                hidden: false,
              },
            ],
          },
          {
            id: 'refresh-trigno',
            kind: 'button',
            label: 'Обновить статус Trigno',
            hidden: true,
            variants: [
              {
                when: {
                  or: [
                    { flag: `adapter.${trignoAdapterId}.state`, eq: 'connected' },
                    { flag: `adapter.${trignoAdapterId}.state`, eq: 'paused' },
                  ],
                },
                label: 'Обновить статус Trigno',
                commandType: TrignoEventTypes.statusRefreshRequest,
                payload: { adapterId: trignoAdapterId },
                hidden: false,
              },
            ],
          },
        ],
      },
      {
        kind: 'controls',
        id: 'controls-main',
        title: 'ANT+ / Moxy',
        controls: [
          {
            id: 'scan-moxy',
            kind: 'button',
            label: 'Подключить Moxy',
            commandType: EventTypes.adapterScanRequest,
            payload: makeMoxyScanPayload(moxyAdapterId),
            // Модалка живет полностью в renderer, а runtime только присылает варианты выбора.
            modalForm: makeMoxyConnectModalForm(moxyAdapterId),
            variants: [
              {
                when: { flag: `adapter.${moxyAdapterId}.scanning`, eq: true },
                label: 'Ищем Moxy...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: `adapter.${moxyAdapterId}.state`, eq: 'connecting' },
                label: 'Подключение Moxy...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: `adapter.${moxyAdapterId}.state`, eq: 'connected' },
                label: 'Moxy подключен',
                disabled: true,
              },
              {
                when: { flag: `adapter.${moxyAdapterId}.state`, eq: 'disconnecting' },
                label: 'Отключение Moxy...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: `adapter.${moxyAdapterId}.state`, eq: 'failed' },
                label: 'Повторить поиск Moxy',
              },
            ],
          },
          {
            id: 'disconnect-moxy',
            kind: 'button',
            label: 'Отключить Moxy',
            hidden: true,
            variants: [
              {
                when: { flag: `adapter.${moxyAdapterId}.state`, eq: 'connected' },
                label: 'Отключить Moxy',
                commandType: EventTypes.adapterDisconnectRequest,
                payload: { adapterId: moxyAdapterId },
                hidden: false,
              },
              {
                when: { flag: `adapter.${moxyAdapterId}.state`, eq: 'failed' },
                label: 'Сбросить ошибку Moxy',
                commandType: EventTypes.adapterDisconnectRequest,
                payload: { adapterId: moxyAdapterId },
                hidden: false,
              },
              {
                when: { flag: `adapter.${moxyAdapterId}.state`, eq: 'disconnecting' },
                label: 'Отключение Moxy...',
                hidden: false,
                disabled: true,
                isLoading: true,
              },
            ],
          },
        ],
      },
      {
        kind: 'controls',
        id: 'controls-zephyr',
        title: 'BLE / Zephyr',
        controls: [
          {
            id: 'scan-zephyr',
            kind: 'button',
            label: 'Подключить Zephyr',
            commandType: EventTypes.adapterScanRequest,
            payload: makeZephyrScanPayload(zephyrAdapterId),
            modalForm: makeZephyrConnectModalForm(zephyrAdapterId),
            variants: [
              {
                when: { flag: `adapter.${zephyrAdapterId}.scanning`, eq: true },
                label: 'Ищем Zephyr...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: `adapter.${zephyrAdapterId}.state`, eq: 'connecting' },
                label: 'Подключение Zephyr...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: `adapter.${zephyrAdapterId}.state`, eq: 'connected' },
                label: 'Zephyr подключен',
                disabled: true,
              },
              {
                when: { flag: `adapter.${zephyrAdapterId}.state`, eq: 'disconnecting' },
                label: 'Отключение Zephyr...',
                disabled: true,
                isLoading: true,
              },
              {
                when: { flag: `adapter.${zephyrAdapterId}.state`, eq: 'failed' },
                label: 'Повторить поиск Zephyr',
              },
            ],
          },
          {
            id: 'disconnect-zephyr',
            kind: 'button',
            label: 'Отключить Zephyr',
            hidden: true,
            variants: [
              {
                when: { flag: `adapter.${zephyrAdapterId}.state`, eq: 'connected' },
                label: 'Отключить Zephyr',
                commandType: EventTypes.adapterDisconnectRequest,
                payload: { adapterId: zephyrAdapterId },
                hidden: false,
              },
              {
                when: { flag: `adapter.${zephyrAdapterId}.state`, eq: 'failed' },
                label: 'Сбросить ошибку Zephyr',
                commandType: EventTypes.adapterDisconnectRequest,
                payload: { adapterId: zephyrAdapterId },
                hidden: false,
              },
              {
                when: { flag: `adapter.${zephyrAdapterId}.state`, eq: 'disconnecting' },
                label: 'Отключение Zephyr...',
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
        title: 'Состояние',
        flagKeys: [
          `adapter.${moxyAdapterId}.state`,
          `adapter.${moxyAdapterId}.scanning`,
          `adapter.${moxyAdapterId}.scanMessage`,
          `adapter.${moxyAdapterId}.message`,
          `adapter.${zephyrAdapterId}.state`,
          `adapter.${zephyrAdapterId}.scanning`,
          `adapter.${zephyrAdapterId}.scanMessage`,
          `adapter.${zephyrAdapterId}.message`,
          `adapter.${trignoAdapterId}.state`,
          `adapter.${trignoAdapterId}.message`,
          'trigno.host',
          'trigno.sensorSlot',
          'trigno.mode',
          'trigno.startIndex',
          'trigno.serial',
          'trigno.firmware',
          'trigno.backwardsCompatibility',
          'trigno.upsampling',
          'trigno.emgRateHz',
          'trigno.gyroRateHz',
        ],
      },
      {
        kind: 'chart',
        id: 'chart-trigno-emg',
        title: 'Trigno EMG',
        renderer: 'echarts',
        height: 320,
        timeWindowMs: 20_000,
        showLegend: true,
        yAxis: { label: 'V' },
        series: [
          {
            type: 'line',
            streamId: 'trigno.avanti',
            label: 'EMG',
            color: '#ff922b',
            lineWidth: 2,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-trigno-gyro',
        title: 'Trigno Gyroscope',
        renderer: 'echarts',
        height: 320,
        timeWindowMs: 20_000,
        showLegend: true,
        yAxis: { label: 'deg/s' },
        series: [
          {
            type: 'line',
            streamId: 'trigno.avanti.gyro.x',
            label: 'gyro.x',
            color: '#f03e3e',
            lineWidth: 2,
          },
          {
            type: 'line',
            streamId: 'trigno.avanti.gyro.y',
            label: 'gyro.y',
            color: '#2b8a3e',
            lineWidth: 2,
          },
          {
            type: 'line',
            streamId: 'trigno.avanti.gyro.z',
            label: 'gyro.z',
            color: '#1c7ed6',
            lineWidth: 2,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-moxy-smo2',
        title: 'SmO2',
        renderer: 'echarts',
        height: 320,
        timeWindowMs: 20_000,
        showLegend: true,
        yAxis: { min: 40, max: 100, label: '%' },
        series: [
          {
            type: 'line',
            streamId: 'moxy.smo2',
            label: 'SmO2',
            color: '#3fb950',
            lineWidth: 3,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-moxy-thb',
        title: 'tHb',
        renderer: 'echarts',
        height: 320,
        timeWindowMs: 20_000,
        showLegend: true,
        yAxis: { min: 8, max: 18, label: 'g/dL' },
        series: [
          {
            type: 'line',
            streamId: 'moxy.thb',
            label: 'tHb',
            color: '#58a6ff',
            lineWidth: 3,
          },
        ],
      },
      {
        kind: 'chart',
        id: 'chart-zephyr-rr',
        title: 'RR',
        renderer: 'echarts',
        height: 320,
        timeWindowMs: 20_000,
        showLegend: true,
        yAxis: { min: 0.3, max: 1.8, label: 's' },
        series: [
          {
            type: 'line',
            streamId: 'zephyr.rr',
            label: 'RR',
            color: '#1f6feb',
            lineWidth: 3,
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
  if (currentProfile === 'veloerg') return veloergSchema();
  return fakeSchema();
}

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
    channelId: event.payload.channelId,
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
    if (cfg?.profile === 'fake' || cfg?.profile === 'fake-hdf5-simulation' || cfg?.profile === 'veloerg') {
      profile = cfg.profile;
    }
  },
  async onEvent(event, ctx) {
    if (event.type === EventTypes.uiClientConnected) {
      const clientId = event.payload.clientId;
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
    profile = 'fake';
  },
});
