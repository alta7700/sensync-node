import { afterEach, describe, expect, it } from 'vitest';
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
import { buildFakeUiSchema, buildVeloergUiSchema } from './profile-schemas.ts';

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
      'disconnect-moxy',
      'toggle-recording',
      'stop-recording',
    ]);

    const statusWidget = initMessage.schema.widgets.find((widget) => widget.id === 'status-main');
    expect(statusWidget).toMatchObject({
      kind: 'status',
      flagKeys: expect.arrayContaining([
        'recording.local.state',
        'recording.local.filePath',
      ]),
    });
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
          sensorSlot: 1,
          banner: 'Delsys Trigno System Digital Protocol Version 3.6.0',
          protocolVersion: '3.6.0',
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
      'trigno.sensorSlot': 1,
      'trigno.mode': 7,
      'trigno.startIndex': 1,
      'trigno.serial': 'SP-W02C-1759',
      'trigno.firmware': '3.6.0',
      'trigno.backwardsCompatibility': true,
      'trigno.upsampling': true,
      'trigno.emgRateHz': 1925.92592592593,
      'trigno.gyroRateHz': 148.148148148148,
    });
  });
});
