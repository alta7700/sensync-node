import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachRuntimeEventEnvelope,
  defineRuntimeEventInput,
  EventTypes,
  type RuntimeEventInput,
  type UiControlMessage,
  type UiControlsWidget,
  type UiSchema,
} from '@sensync2/core';
import { TrignoEventTypes } from '@sensync2/plugins-trigno';
import plugin from './ui-gateway-plugin.ts';
import {
  buildFakeUiSchema,
  buildVeloergReplayUiSchema,
  buildVeloergFinalViewerUiSchema,
  buildVeloergUiSchema,
  buildVeloergViewerUiSchema,
} from './profile-schemas.ts';

interface CapturedEvent {
  event: RuntimeEventInput;
}

type UiInitMessage = Extract<UiControlMessage, { type: 'ui.init' }>;

function createTestContext(schema: UiSchema = buildVeloergUiSchema()) {
  const emitted: CapturedEvent[] = [];
  return {
    emitted,
    ctx: {
      pluginId: 'ui-gateway',
      clock: {
        nowSessionMs: () => 0,
        sessionStartWallMs: () => 123,
      },
      currentTimelineId: () => 'timeline-test',
      timelineStartSessionMs: () => 0,
      emit: async (event: RuntimeEventInput) => {
        emitted.push({ event });
      },
      setTimer() {},
      clearTimer() {},
      telemetry() {},
      getConfig() {
        return { schema };
      },
      requestTimelineReset() {
        return null;
      },
    },
  };
}

function toRuntimeEvent<TEvent extends RuntimeEventInput>(event: TEvent) {
  return attachRuntimeEventEnvelope(event, 1n, 'timeline-test', 0, 'runtime');
}

function extractControlMessage(emitted: CapturedEvent[]): UiControlMessage | null {
  const controlEvent = emitted.find((entry) => entry.event.type === EventTypes.uiControlOut)?.event;
  if (!controlEvent || controlEvent.type !== EventTypes.uiControlOut) {
    return null;
  }
  return controlEvent.payload.message;
}

afterEach(async () => {
  const { ctx } = createTestContext();
  await plugin.onShutdown(ctx as never);
});

describe('ui-gateway-plugin', () => {
  it('не показывает manual connect control для fake auto-source', async () => {
    const { ctx, emitted } = createTestContext(buildFakeUiSchema());
    await plugin.onInit(ctx as never);
    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.uiClientConnected,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { clientId: 'client-1' },
    })), ctx as never);

    const message = extractControlMessage(emitted);
    expect(message).not.toBeNull();
    if (!message || message.type !== 'ui.init') {
      throw new Error('Ожидалось ui.init сообщение');
    }

    const controlsWidget = message.schema.widgets.find((widget): widget is UiControlsWidget => {
      return widget.id === 'controls-main' && widget.kind === 'controls';
    });
    expect(controlsWidget?.kind).toBe('controls');
    if (!controlsWidget || controlsWidget.kind !== 'controls') {
      throw new Error('Не найден controls-main');
    }
    expect(message.flags['interval.active']).toBe(false);
    expect(message.schema.derivedFlags).toEqual([
      {
        kind: 'latest-discrete-signal-value-map',
        flagKey: 'interval.active',
        sourceStreamId: 'interval.label',
        initialValue: false,
        valueMap: {
          1: true,
          0: false,
        },
      },
    ]);

    const controlIds = controlsWidget.controls.map((control) => control.id);
    expect(controlIds).not.toContain('toggle-fake');
    expect(controlIds).toContain('toggle-shapes');

    const intervalControl = controlsWidget.controls.find((control) => control.id === 'toggle-interval');
    expect(intervalControl?.variants?.[0]).toMatchObject({
      commandType: EventTypes.labelMarkRequest,
      payload: { labelId: 'interval', value: 1 },
    });
    expect(intervalControl?.variants?.[1]).toMatchObject({
      commandType: EventTypes.labelMarkRequest,
      payload: { labelId: 'interval', value: 0 },
    });
  });

  it('деривит interval.active из потока interval.label', async () => {
    const { ctx, emitted } = createTestContext(buildFakeUiSchema());
    await plugin.onInit(ctx as never);

    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'interval.label',
        sampleFormat: 'i16',
        frameKind: 'label-batch',
        t0Ms: 120,
        sampleCount: 1,
        values: new Int16Array([1]),
        timestampsMs: new Float64Array([120]),
      },
    })), ctx as never);

    const lastPatch = emitted
      .map((entry) => entry.event)
      .filter((event): event is Extract<RuntimeEventInput, { type: typeof EventTypes.uiControlOut }> => {
        return event.type === EventTypes.uiControlOut;
      })
      .map((event) => event.payload.message)
      .filter((message): message is Extract<UiControlMessage, { type: 'ui.flags.patch' }> => {
        return message.type === 'ui.flags.patch';
      })
      .at(-1);

    expect(lastPatch?.patch['interval.active']).toBe(true);
  });

  it('деривит последнее числовое значение потока в numeric flag', async () => {
    const schema: UiSchema = {
      version: 1,
      pages: [],
      widgets: [],
      derivedFlags: [
        {
          kind: 'latest-numeric-signal-value',
          flagKey: 'power.current',
          sourceStreamId: 'power.label',
          initialValue: null,
        },
      ],
    };
    const { ctx, emitted } = createTestContext(schema);
    await plugin.onInit(ctx as never);

    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'power.label',
        sampleFormat: 'f32',
        frameKind: 'label-batch',
        t0Ms: 500,
        sampleCount: 1,
        values: new Float32Array([210]),
        timestampsMs: new Float64Array([500]),
      },
    })), ctx as never);

    const lastPatch = emitted
      .map((entry) => entry.event)
      .filter((event): event is Extract<RuntimeEventInput, { type: typeof EventTypes.uiControlOut }> => {
        return event.type === EventTypes.uiControlOut;
      })
      .map((event) => event.payload.message)
      .filter((message): message is Extract<UiControlMessage, { type: 'ui.flags.patch' }> => {
        return message.type === 'ui.flags.patch';
      })
      .at(-1);

    expect(lastPatch?.patch['power.current']).toBe(210);
  });

  it('пишет диагностический лог при смене recording state', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { ctx } = createTestContext(buildVeloergUiSchema());
      await plugin.onInit(ctx as never);

      await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
        type: EventTypes.recordingStateChanged,
        v: 1,
        kind: 'fact',
        priority: 'system',
        payload: {
          writer: 'hdf5-recorder',
          state: 'stopping',
          filePath: '/tmp/veloerg.h5',
          message: 'Закрытие файла...',
        },
      })), ctx as never);

      expect(logSpy).toHaveBeenCalledWith(
        '[ui-gateway] recording.state.changed',
        expect.objectContaining({
          writer: 'hdf5-recorder',
          state: 'stopping',
          filePath: '/tmp/veloerg.h5',
          message: 'Закрытие файла...',
          timelineId: 'timeline-test',
          timelineStartSessionMs: 0,
          version: expect.any(Number),
          patchKeys: expect.arrayContaining([
            'recording.hdf5-recorder.state',
            'recording.hdf5-recorder.filePath',
            'recording.hdf5-recorder.message',
          ]),
        }),
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('на timeline reset commit выпускает ui.timeline.reset и сбрасывает derived flags', async () => {
    const { ctx, emitted } = createTestContext(buildFakeUiSchema());
    await plugin.onInit(ctx as never);

    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.signalBatch,
      v: 1,
      kind: 'data',
      priority: 'data',
      payload: {
        streamId: 'interval.label',
        sampleFormat: 'i16',
        frameKind: 'label-batch',
        t0Ms: 120,
        sampleCount: 1,
        values: new Int16Array([1]),
        timestampsMs: new Float64Array([120]),
      },
    })), ctx as never);

    await plugin.onTimelineResetCommit?.({
      resetId: 'reset-1',
      nextTimelineId: 'timeline-next',
      timelineStartSessionMs: 500,
    }, ctx as never);

    const messages = emitted
      .map((entry) => entry.event)
      .filter((event): event is Extract<RuntimeEventInput, { type: typeof EventTypes.uiControlOut }> => {
        return event.type === EventTypes.uiControlOut;
      })
      .map((event) => event.payload.message);

    expect(messages).toContainEqual({
      type: 'ui.timeline.reset',
      timelineId: 'timeline-next',
      timelineStartSessionMs: 500,
      clearBuffers: true,
    });
    expect(messages).toContainEqual({
      type: 'ui.flags.patch',
      patch: {
        'interval.active': false,
      },
      version: expect.any(Number),
    });
  });

  it('при первом connected replay-состоянии с recordingStartSessionMs сдвигает только UI timeline', async () => {
    const { ctx, emitted } = createTestContext(buildVeloergReplayUiSchema());
    await plugin.onInit(ctx as never);

    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.simulationStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        adapterId: 'veloerg-replay',
        state: 'connecting',
        speed: 1,
        batchMs: 50,
        filePath: '/tmp/replay.h5',
        recordingStartSessionMs: 12_345,
      },
    })), ctx as never);

    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.simulationStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        adapterId: 'veloerg-replay',
        state: 'connected',
        speed: 1,
        batchMs: 50,
        filePath: '/tmp/replay.h5',
        recordingStartSessionMs: 12_345,
      },
    })), ctx as never);

    const messages = emitted
      .map((entry) => entry.event)
      .filter((event): event is Extract<RuntimeEventInput, { type: typeof EventTypes.uiControlOut }> => {
        return event.type === EventTypes.uiControlOut;
      })
      .map((event) => event.payload.message);

    expect(messages).toContainEqual({
      type: 'ui.timeline.reset',
      timelineId: 'timeline-test',
      timelineStartSessionMs: 12_345,
      clearBuffers: true,
    });
    expect(messages).toContainEqual({
      type: 'ui.flags.patch',
      patch: {
        'simulation.veloerg-replay.speed': 1,
        'simulation.veloerg-replay.batchMs': 50,
        'simulation.veloerg-replay.filePath': '/tmp/replay.h5',
        'simulation.veloerg-replay.recordingStartSessionMs': 12_345,
        'simulation.veloerg-replay.message': null,
      },
      version: expect.any(Number),
    });
  });

  it('при connected viewer-состоянии сбрасывает UI буферы и патчит viewer flags', async () => {
    const { ctx, emitted } = createTestContext(buildVeloergViewerUiSchema());
    await plugin.onInit(ctx as never);

    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.viewerStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        adapterId: 'veloerg-viewer',
        state: 'connected',
        filePath: '/tmp/viewer.h5',
        recordingStartSessionMs: 8_000,
        dataStartMs: 8_000,
        dataEndMs: 12_000,
      },
    })), ctx as never);

    const messages = emitted
      .map((entry) => entry.event)
      .filter((event): event is Extract<RuntimeEventInput, { type: typeof EventTypes.uiControlOut }> => {
        return event.type === EventTypes.uiControlOut;
      })
      .map((event) => event.payload.message);

    expect(messages).toContainEqual({
      type: 'ui.timeline.reset',
      timelineId: 'timeline-test',
      timelineStartSessionMs: 8_000,
      clearBuffers: true,
    });
    expect(messages).toContainEqual({
      type: 'ui.flags.patch',
      patch: {
        'viewer.veloerg-viewer.filePath': '/tmp/viewer.h5',
        'viewer.veloerg-viewer.recordingStartSessionMs': 8_000,
        'viewer.veloerg-viewer.dataStartMs': 8_000,
        'viewer.veloerg-viewer.dataEndMs': 12_000,
        'viewer.veloerg-viewer.message': null,
      },
      version: expect.any(Number),
    });
  });

  it('патчит viewer metadata flags и очищает ключи, которых больше нет в новом файле', async () => {
    const { ctx, emitted } = createTestContext(buildVeloergFinalViewerUiSchema());
    await plugin.onInit(ctx as never);

    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.viewerStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        adapterId: 'veloerg-final-viewer',
        state: 'connected',
        filePath: '/tmp/viewer-a.h5',
        metadata: {
          subject_name: 'Иванов И.И.',
          stop_time_sec: 632,
        },
      },
    })), ctx as never);

    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.viewerStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        adapterId: 'veloerg-final-viewer',
        state: 'connected',
        filePath: '/tmp/viewer-b.h5',
        metadata: {
          stop_time_sec: 701,
        },
      },
    })), ctx as never);

    const patches = emitted
      .map((entry) => entry.event)
      .filter((event): event is Extract<RuntimeEventInput, { type: typeof EventTypes.uiControlOut }> => {
        return event.type === EventTypes.uiControlOut && event.payload.message.type === 'ui.flags.patch';
      })
      .map((event) => event.payload.message);

    expect(patches).toContainEqual({
      type: 'ui.flags.patch',
      patch: {
        'viewer.veloerg-final-viewer.filePath': '/tmp/viewer-a.h5',
        'viewer.veloerg-final-viewer.recordingStartSessionMs': null,
        'viewer.veloerg-final-viewer.dataStartMs': null,
        'viewer.veloerg-final-viewer.dataEndMs': null,
        'viewer.veloerg-final-viewer.message': null,
        'viewer.veloerg-final-viewer.metadata.subject_name': 'Иванов И.И.',
        'viewer.veloerg-final-viewer.metadata.stop_time_sec': 632,
      },
      version: expect.any(Number),
    });
    expect(patches).toContainEqual({
      type: 'ui.flags.patch',
      patch: {
        'viewer.veloerg-final-viewer.filePath': '/tmp/viewer-b.h5',
        'viewer.veloerg-final-viewer.recordingStartSessionMs': null,
        'viewer.veloerg-final-viewer.dataStartMs': null,
        'viewer.veloerg-final-viewer.dataEndMs': null,
        'viewer.veloerg-final-viewer.message': null,
        'viewer.veloerg-final-viewer.metadata.subject_name': null,
        'viewer.veloerg-final-viewer.metadata.stop_time_sec': 701,
      },
      version: expect.any(Number),
    });
  });

  it('materializeит command.rejected в ui.warning', async () => {
    const { ctx, emitted } = createTestContext(buildFakeUiSchema());
    await plugin.onInit(ctx as never);

    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.commandRejected,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        commandType: EventTypes.labelMarkRequest,
        commandVersion: 1,
        code: 'unknown_label',
        message: 'Label "missing" не найден в конфиге',
        details: { labelId: 'missing' },
      },
    })), ctx as never);

    const warningMessage = emitted
      .map((entry) => entry.event)
      .filter((event): event is Extract<RuntimeEventInput, { type: typeof EventTypes.uiControlOut }> => {
        return event.type === EventTypes.uiControlOut;
      })
      .map((event) => event.payload.message)
      .find((message): message is Extract<UiControlMessage, { type: 'ui.warning' }> => {
        return message.type === 'ui.warning';
      });

    expect(warningMessage).toEqual({
      type: 'ui.warning',
      code: 'unknown_label',
      message: 'Label "missing" не найден в конфиге',
    });
  });

  it('материализует Trigno controls и графики в veloerg schema', async () => {
    const { ctx, emitted } = createTestContext(buildVeloergUiSchema());
    await plugin.onInit(ctx as never);
    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.uiClientConnected,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { clientId: 'client-1' },
    })), ctx as never);

    const message = extractControlMessage(emitted);
    expect(message).not.toBeNull();
    if (!message || message.type !== 'ui.init') {
      throw new Error('Ожидалось ui.init сообщение');
    }
    const initMessage = message as UiInitMessage;

    expect(initMessage.schema.pages[0]?.layout).toEqual({
      kind: 'column',
      gap: 12,
      children: [
        {
          kind: 'row',
          gap: 12,
          children: [
            {
              kind: 'widget',
              widgetId: 'status-main',
              minWidth: 320,
            },
            {
              kind: 'column',
              gap: 12,
              minWidth: 520,
              children: [
                { kind: 'widget', widgetId: 'controls-trigno' },
                {
                  kind: 'row',
                  gap: 12,
                  children: [
                    { kind: 'widget', widgetId: 'controls-main', minWidth: 250 },
                    { kind: 'widget', widgetId: 'controls-zephyr', minWidth: 250 },
                  ],
                },
                {
                  kind: 'column',
                  gap: 12,
                  children: [
                    { kind: 'widget', widgetId: 'controls-recording' },
                  ],
                },
              ],
            },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'summary-main' },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'controls-power', minWidth: 320 },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'chart-trigno-vl-emg', minWidth: 420 },
            { kind: 'widget', widgetId: 'chart-trigno-vl-gyro', minWidth: 420 },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'chart-trigno-rf-emg', minWidth: 420 },
            { kind: 'widget', widgetId: 'chart-trigno-rf-gyro', minWidth: 420 },
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
            { kind: 'widget', widgetId: 'chart-power', minWidth: 420 },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'chart-zephyr-rr', minWidth: 420 },
            { kind: 'widget', widgetId: 'chart-zephyr-hr', minWidth: 420 },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'chart-zephyr-dfa-a1', minWidth: 420 },
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
    });

    const controlsWidget = initMessage.schema.widgets.find((widget): widget is UiControlsWidget => {
      return widget.id === 'controls-trigno' && widget.kind === 'controls';
    });
    expect(controlsWidget?.kind).toBe('controls');
    if (!controlsWidget || controlsWidget.kind !== 'controls') {
      throw new Error('Не найден controls-trigno');
    }

    expect(controlsWidget.controls.map((control) => control.id)).toEqual([
      'connect-trigno',
      'disconnect-trigno',
      'start-trigno',
      'stop-trigno',
      'refresh-trigno',
    ]);

    const connectControl = controlsWidget.controls.find((control) => control.id === 'connect-trigno');
    expect(connectControl?.modalForm?.fields).toEqual([
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
            fieldId: 'vlSensorSlot',
            label: 'Слот VL',
            required: true,
            defaultValue: 1,
            min: 1,
            max: 16,
            step: 1,
          },
          {
            kind: 'numberInput',
            fieldId: 'rfSensorSlot',
            label: 'Слот RF',
            required: true,
            defaultValue: 2,
            min: 1,
            max: 16,
            step: 1,
          },
        ],
      },
    ]);

    const mainControlsWidget = initMessage.schema.widgets.find((widget): widget is UiControlsWidget => {
      return widget.id === 'controls-main' && widget.kind === 'controls';
    });
    expect(mainControlsWidget?.kind).toBe('controls');
    if (!mainControlsWidget || mainControlsWidget.kind !== 'controls') {
      throw new Error('Не найден controls-main');
    }

    expect(mainControlsWidget.controls.map((control) => control.id)).toEqual([
      'scan-moxy',
      'scan-train-red',
      'disconnect-moxy',
    ]);

    const powerControlsWidget = initMessage.schema.widgets.find((widget): widget is UiControlsWidget => {
      return widget.id === 'controls-power' && widget.kind === 'controls';
    });
    expect(powerControlsWidget?.kind).toBe('controls');
    if (!powerControlsWidget || powerControlsWidget.kind !== 'controls') {
      throw new Error('Не найден controls-power');
    }
    expect(powerControlsWidget.controls).toEqual([]);

    const summaryWidget = initMessage.schema.widgets.find((widget) => widget.id === 'summary-main');
    expect(summaryWidget).toMatchObject({
      kind: 'status',
      flagKeys: expect.arrayContaining([
        'power.current',
        'moxy.smo2',
        'moxy.thb',
        'zephyr.hr',
      ]),
    });

    const recordingControlsWidget = initMessage.schema.widgets.find((widget): widget is UiControlsWidget => {
      return widget.id === 'controls-recording' && widget.kind === 'controls';
    });
    expect(recordingControlsWidget?.kind).toBe('controls');
    if (!recordingControlsWidget || recordingControlsWidget.kind !== 'controls') {
      throw new Error('Не найден controls-recording');
    }

    expect(recordingControlsWidget.controls.map((control) => control.id)).toEqual([
      'toggle-recording',
      'stop-recording',
    ]);

    expect(initMessage.schema.pages[0]?.widgetIds).not.toContain('controls-lactate');
    expect(initMessage.schema.pages[0]?.widgetIds).not.toContain('chart-lactate');
    expect(initMessage.schema.pages[0]?.widgetIds).not.toContain('chart-pedaling-confidence');
    expect(initMessage.schema.pages[0]?.widgetIds).not.toContain('chart-pedaling-cycle-period');

    const statusWidget = initMessage.schema.widgets.find((widget) => widget.id === 'status-main');
    expect(statusWidget).toMatchObject({
      kind: 'status',
      flagKeys: expect.arrayContaining([
        'power.current',
        'recording.local.state',
        'recording.local.filePath',
      ]),
    });
  });

  it('материализует replay controls и графики в veloerg-replay schema', async () => {
    const { ctx, emitted } = createTestContext(buildVeloergReplayUiSchema());
    await plugin.onInit(ctx as never);
    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.uiClientConnected,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { clientId: 'client-1' },
    })), ctx as never);

    const message = extractControlMessage(emitted);
    expect(message).not.toBeNull();
    if (!message || message.type !== 'ui.init') {
      throw new Error('Ожидалось ui.init сообщение');
    }
    const initMessage = message as UiInitMessage;

    expect(initMessage.schema.pages[0]?.layout).toEqual({
      kind: 'column',
      gap: 12,
      children: [
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'status-main', minWidth: 320 },
            { kind: 'widget', widgetId: 'controls-main', minWidth: 520 },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'chart-trigno-vl-emg', minWidth: 420 },
            { kind: 'widget', widgetId: 'chart-trigno-vl-gyro', minWidth: 420 },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'chart-trigno-rf-emg', minWidth: 420 },
            { kind: 'widget', widgetId: 'chart-trigno-rf-gyro', minWidth: 420 },
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
            { kind: 'widget', widgetId: 'chart-power', minWidth: 420 },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'chart-zephyr-rr', minWidth: 420 },
            { kind: 'widget', widgetId: 'chart-zephyr-hr', minWidth: 420 },
          ],
        },
        {
          kind: 'row',
          gap: 12,
          children: [
            { kind: 'widget', widgetId: 'chart-zephyr-dfa-a1', minWidth: 420 },
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
    });

    const controlsWidget = initMessage.schema.widgets.find((widget): widget is UiControlsWidget => {
      return widget.id === 'controls-main' && widget.kind === 'controls';
    });
    expect(controlsWidget?.kind).toBe('controls');
    if (!controlsWidget || controlsWidget.kind !== 'controls') {
      throw new Error('Не найден controls-main');
    }

    expect(controlsWidget.controls.map((control) => control.id)).toContain('toggle-veloerg-replay');
    expect(initMessage.schema.derivedFlags).toEqual([
      {
        kind: 'latest-numeric-signal-value',
        flagKey: 'power.current',
        sourceStreamId: 'power.label',
        initialValue: null,
      },
    ]);

    const statusWidget = initMessage.schema.widgets.find((widget) => widget.id === 'status-main');
    expect(statusWidget).toMatchObject({
      kind: 'status',
      flagKeys: expect.arrayContaining([
        'simulation.veloerg-replay.speed',
        'simulation.veloerg-replay.filePath',
        'power.current',
      ]),
    });
    expect(initMessage.schema.pages[0]?.widgetIds).not.toContain('chart-lactate');
  });

  it('материализует viewer controls и history-графики в veloerg-viewer schema', async () => {
    const { ctx, emitted } = createTestContext(buildVeloergViewerUiSchema());
    await plugin.onInit(ctx as never);
    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.uiClientConnected,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { clientId: 'client-1' },
    })), ctx as never);

    const message = extractControlMessage(emitted);
    expect(message).not.toBeNull();
    if (!message || message.type !== 'ui.init') {
      throw new Error('Ожидалось ui.init сообщение');
    }
    const initMessage = message as UiInitMessage;

    const controlsWidget = initMessage.schema.widgets.find((widget): widget is UiControlsWidget => {
      return widget.id === 'controls-main' && widget.kind === 'controls';
    });
    expect(controlsWidget?.kind).toBe('controls');
    if (!controlsWidget || controlsWidget.kind !== 'controls') {
      throw new Error('Не найден controls-main');
    }
    expect(controlsWidget.controls.map((control) => control.id)).toContain('toggle-veloerg-viewer');

    const statusWidget = initMessage.schema.widgets.find((widget) => widget.id === 'status-main');
    expect(statusWidget).toMatchObject({
      kind: 'status',
      flagKeys: expect.arrayContaining([
        'viewer.veloerg-viewer.filePath',
        'viewer.veloerg-viewer.dataStartMs',
        'viewer.veloerg-viewer.dataEndMs',
        'power.current',
      ]),
    });

    const emgChart = initMessage.schema.widgets.find((widget) => widget.id === 'chart-trigno-vl-emg');
    expect(emgChart).toMatchObject({
      kind: 'chart',
      viewportMode: 'history',
    });
    expect(initMessage.schema.pages[0]?.widgetIds).not.toContain('chart-lactate');
  });

  it('материализует train.red viewer schema с новыми графиками и без legacy thb', async () => {
    const { ctx, emitted } = createTestContext(buildVeloergFinalViewerUiSchema());
    await plugin.onInit(ctx as never);
    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: EventTypes.uiClientConnected,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { clientId: 'client-1' },
    })), ctx as never);

    const message = extractControlMessage(emitted);
    expect(message).not.toBeNull();
    if (!message || message.type !== 'ui.init') {
      throw new Error('Ожидалось ui.init сообщение');
    }
    const initMessage = message as UiInitMessage;

    const controlsWidget = initMessage.schema.widgets.find((widget): widget is UiControlsWidget => {
      return widget.id === 'controls-main' && widget.kind === 'controls';
    });
    expect(controlsWidget?.kind).toBe('controls');
    if (!controlsWidget || controlsWidget.kind !== 'controls') {
      throw new Error('Не найден controls-main');
    }
    expect(controlsWidget.controls.map((control) => control.id)).toContain('toggle-veloerg-final-viewer');

    const statusWidget = initMessage.schema.widgets.find((widget) => widget.id === 'status-main');
    expect(statusWidget).toMatchObject({
      kind: 'status',
      flagKeys: expect.arrayContaining([
        'viewer.veloerg-final-viewer.filePath',
        'viewer.veloerg-final-viewer.dataStartMs',
        'viewer.veloerg-final-viewer.dataEndMs',
        'power.current',
      ]),
    });
    const metadataWidget = initMessage.schema.widgets.find((widget) => widget.id === 'status-metadata');
    expect(metadataWidget).toMatchObject({
      kind: 'status',
      flagKeys: expect.arrayContaining([
        'viewer.veloerg-final-viewer.metadata.subject_name',
        'viewer.veloerg-final-viewer.metadata.stop_time',
        'viewer.veloerg-final-viewer.metadata.stop_time_sec',
      ]),
      fields: expect.arrayContaining([
        expect.objectContaining({
          flagKey: 'viewer.veloerg-final-viewer.metadata.subject_name',
          label: 'ФИ',
        }),
        expect.objectContaining({
          flagKey: 'viewer.veloerg-final-viewer.metadata.stop_time_sec',
          label: 'Время остановки, с',
        }),
      ]),
    });
    const lt2Widget = initMessage.schema.widgets.find((widget) => widget.id === 'status-lt2');
    expect(lt2Widget).toMatchObject({
      kind: 'status',
      flagKeys: expect.arrayContaining([
        'viewer.veloerg-final-viewer.metadata.lt2_method',
        'viewer.veloerg-final-viewer.metadata.lt2_refined_time_sec',
        'viewer.veloerg-final-viewer.metadata.lt2_refined_sources',
      ]),
      fields: expect.arrayContaining([
        expect.objectContaining({
          flagKey: 'viewer.veloerg-final-viewer.metadata.lt2_method',
          label: 'Метод LT2',
        }),
        expect.objectContaining({
          flagKey: 'viewer.veloerg-final-viewer.metadata.lt2_refined_time_sec',
          label: 'LT2 refined, с',
        }),
      ]),
    });

    expect(initMessage.schema.pages[0]?.widgetIds).toContain('chart-train-red-filtered');
    expect(initMessage.schema.pages[0]?.widgetIds).toContain('chart-train-red-unfiltered');
    expect(initMessage.schema.pages[0]?.widgetIds).toContain('chart-lactate');
    expect(initMessage.schema.pages[0]?.widgetIds).toContain('status-lt2');
    expect(initMessage.schema.pages[0]?.widgetIds).not.toContain('chart-moxy-thb');

    const filteredChart = initMessage.schema.widgets.find((widget) => widget.id === 'chart-train-red-filtered');
    expect(filteredChart).toMatchObject({
      kind: 'chart',
      viewportMode: 'history',
      markers: expect.arrayContaining([
        expect.objectContaining({
          kind: 'vertical-flag',
          flagKey: 'viewer.veloerg-final-viewer.metadata.stop_time_sec',
          labelFlagKey: 'viewer.veloerg-final-viewer.metadata.stop_time',
          valueMultiplier: 1000,
        }),
        expect.objectContaining({
          kind: 'vertical-flag',
          flagKey: 'viewer.veloerg-final-viewer.metadata.lt2_refined_time_sec',
          label: 'LT2',
          color: '#ff8787',
          valueMultiplier: 1000,
        }),
      ]),
    });
    expect((filteredChart as { series?: Array<{ streamId?: string }> } | undefined)?.series?.map((series) => series.streamId))
      .toEqual(['train.red.smo2', 'train.red.hbdiff']);

    const unfilteredChart = initMessage.schema.widgets.find((widget) => widget.id === 'chart-train-red-unfiltered');
    expect(unfilteredChart).toMatchObject({
      kind: 'chart',
      viewportMode: 'history',
    });
    expect((unfilteredChart as { series?: Array<{ streamId?: string }> } | undefined)?.series?.map((series) => series.streamId))
      .toEqual([
        'train.red.smo2.unfiltered',
        'train.red.o2hb.unfiltered',
        'train.red.hhb.unfiltered',
        'train.red.thb.unfiltered',
        'train.red.hbdiff.unfiltered',
      ]);

    const lactateChart = initMessage.schema.widgets.find((widget) => widget.id === 'chart-lactate');
    expect(lactateChart).toMatchObject({
      kind: 'chart',
      viewportMode: 'history',
      yAxis: expect.objectContaining({ label: 'mmol/L' }),
      markers: expect.arrayContaining([
        expect.objectContaining({
          kind: 'vertical-flag',
          flagKey: 'viewer.veloerg-final-viewer.metadata.stop_time_sec',
        }),
        expect.objectContaining({
          kind: 'vertical-flag',
          flagKey: 'viewer.veloerg-final-viewer.metadata.lt2_refined_time_sec',
          label: 'LT2',
        }),
      ]),
    });
    expect((lactateChart as { series?: Array<{ streamId?: string; type?: string }> } | undefined)?.series)
      .toEqual([
        expect.objectContaining({ streamId: 'lactate', type: 'line' }),
        expect.objectContaining({ streamId: 'lactate', type: 'scatter' }),
      ]);
  });

  it('патчит Trigno status flags в UI', async () => {
    const { ctx, emitted } = createTestContext(buildVeloergUiSchema());
    await plugin.onInit(ctx as never);
    await plugin.onEvent(toRuntimeEvent(defineRuntimeEventInput({
      type: TrignoEventTypes.statusReported,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: {
        adapterId: 'trigno',
        status: {
          host: '10.9.15.71',
          banner: 'Delsys Trigno System Digital Protocol Version 3.6.0',
          protocolVersion: '3.6.0',
          backwardsCompatibility: true,
          upsampling: true,
          frameInterval: 0.0135,
          maxSamplesEmg: 26,
          maxSamplesAux: 2,
          sensors: {
            vl: {
              sensorSlot: 1,
              paired: true,
              mode: 7,
              startIndex: 1,
              channelCount: 4,
              emgChannelCount: 1,
              auxChannelCount: 3,
              backwardsCompatibility: true,
              upsampling: true,
              frameInterval: 0.0135,
              maxSamplesEmg: 26,
              maxSamplesAux: 2,
              serial: 'SP-W02C-1759',
              firmware: null,
              emg: {
                rateHz: 1925.92592592593,
                samplesPerFrame: 26,
                units: 'V',
                gain: 300,
              },
              gyro: {
                rateHz: 148.148148148148,
                samplesPerFrame: 2,
                units: 'deg/s',
                gain: 16.4,
              },
            },
            rf: {
              sensorSlot: 2,
              paired: true,
              mode: 7,
              startIndex: 5,
              channelCount: 4,
              emgChannelCount: 1,
              auxChannelCount: 3,
              backwardsCompatibility: true,
              upsampling: true,
              frameInterval: 0.0135,
              maxSamplesEmg: 26,
              maxSamplesAux: 2,
              serial: 'SP-W02C-1760',
              firmware: '3.6.0',
              emg: {
                rateHz: 1925.92592592593,
                samplesPerFrame: 26,
                units: 'V',
                gain: 300,
              },
              gyro: {
                rateHz: 148.148148148148,
                samplesPerFrame: 2,
                units: 'deg/s',
                gain: 16.4,
              },
            },
          },
        },
      },
    })), ctx as never);

    const patchEvent = emitted
      .map((entry) => entry.event)
      .find((event) => event.type === EventTypes.uiControlOut && event.payload.message.type === 'ui.flags.patch');

    expect(patchEvent).toBeDefined();
    if (!patchEvent || patchEvent.type !== EventTypes.uiControlOut || patchEvent.payload.message.type !== 'ui.flags.patch') {
      throw new Error('Ожидался ui.flags.patch');
    }

    expect(patchEvent.payload.message.patch).toMatchObject({
      'trigno.host': '10.9.15.71',
      'trigno.backwardsCompatibility': true,
      'trigno.upsampling': true,
      'trigno.vl.sensorSlot': 1,
      'trigno.vl.mode': 7,
      'trigno.vl.startIndex': 1,
      'trigno.vl.serial': 'SP-W02C-1759',
      'trigno.vl.firmware': '3.6.0',
      'trigno.vl.emgRateHz': 1925.92592592593,
      'trigno.vl.gyroRateHz': 148.148148148148,
      'trigno.rf.sensorSlot': 2,
      'trigno.rf.mode': 7,
      'trigno.rf.startIndex': 5,
      'trigno.rf.serial': 'SP-W02C-1760',
      'trigno.rf.firmware': '3.6.0',
      'trigno.rf.emgRateHz': 1925.92592592593,
      'trigno.rf.gyroRateHz': 148.148148148148,
    });
  });
});
