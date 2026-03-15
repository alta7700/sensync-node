import {
  EventTypes,
  type UiControlAction,
  type UiControlWhen,
  type UiControlVariant,
  type UiModalForm,
  type UiSchema,
} from '@sensync2/core';
import { TrignoEventTypes } from '@sensync2/plugins-trigno';

const FakeRecordingChannels = [
  { streamId: 'fake.a1', minSamples: 200, maxBufferedMs: 1_000 },
  { streamId: 'fake.a2', minSamples: 200, maxBufferedMs: 1_000 },
  { streamId: 'fake.b', minSamples: 200, maxBufferedMs: 1_000 },
  { streamId: 'shapes.signal', minSamples: 200, maxBufferedMs: 1_000 },
  { streamId: 'interval.label', minSamples: 1, maxBufferedMs: 500 },
  { streamId: 'activity.label', minSamples: 1, maxBufferedMs: 500 },
] as const;
const SimulationSpeedOptions = [0.25, 0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8] as const;


function scanCandidatesSourceId(adapterId: string): string {
  return `adapter.${adapterId}.scan.candidates`;
}

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

export function buildFakeUiSchema(): UiSchema {
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

export function buildFakeHdf5SimulationUiSchema(): UiSchema {
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

export function buildVeloergUiSchema(): UiSchema {
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
