import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import h5wasm from 'h5wasm/node';
import { defineRuntimeEventInput, EventTypes, type RuntimeEventInput } from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import plugin from './hdf5-viewer-adapter.ts';

function createAttribute(target: InstanceType<typeof h5wasm.File> | InstanceType<typeof h5wasm.Group>, name: string, value: string | number): void {
  target.create_attribute(name, value);
}

async function createFixtureFile(): Promise<string> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-hdf5-viewer-adapter-'));
  const filePath = path.join(tempDir, 'fixture.h5');

  await h5wasm.ready;
  const file = new h5wasm.File(filePath, 'w', { track_order: true });
  try {
    createAttribute(file, 'recordingStartSessionMs', 1234);
    const channels = file.create_group('channels', true);
    const group = channels.create_group('trigno.avanti', true);
    createAttribute(group, 'streamId', 'trigno.avanti');
    createAttribute(group, 'sampleFormat', 'f32');
    createAttribute(group, 'frameKind', 'uniform-signal-batch');
    createAttribute(group, 'sampleRateHz', 1000);
    createAttribute(group, 'units', 'V');

    group.create_dataset({
      name: 'timestamps',
      data: new Float64Array([1234, 1235, 1236, 1237]),
      shape: [4],
      dtype: '<d',
    });
    group.create_dataset({
      name: 'values',
      data: new Float32Array([1, 2, 3, 4]),
      shape: [4],
      dtype: '<f',
    });
  } finally {
    file.close();
  }

  return filePath;
}

function createHarness(config: Record<string, unknown>) {
  const emitted: RuntimeEventInput[] = [];
  const ctx: PluginContext = {
    pluginId: 'hdf5-viewer-adapter',
    clock: {
      nowSessionMs: () => 0,
      sessionStartWallMs: () => 0,
    },
    currentTimelineId: () => 'timeline-test',
    timelineStartSessionMs: () => 0,
    emit: async (event) => {
      emitted.push(event);
    },
    setTimer: () => {},
    clearTimer: () => {},
    telemetry: () => {},
    getConfig: <T>() => config as T,
    requestTimelineReset: () => null,
  };
  return { ctx, emitted };
}

afterEach(async () => {
  const { ctx } = createHarness({
    adapterId: 'pedaling-emg-viewer',
    allowConnectFilePathOverride: true,
  });
  await plugin.onShutdown(ctx);
});

describe('hdf5-viewer-adapter', () => {
  it('разрешает выбрать файл через connect formData и отдает полный поток сразу', async () => {
    const filePath = await createFixtureFile();
    const { ctx, emitted } = createHarness({
      adapterId: 'pedaling-emg-viewer',
      allowConnectFilePathOverride: true,
      streamIds: ['trigno.avanti'],
    });

    await plugin.onInit(ctx);
    expect(emitted.at(-1)).toMatchObject({
      type: EventTypes.viewerStateChanged,
      payload: {
        adapterId: 'pedaling-emg-viewer',
        state: 'disconnected',
        message: 'Выберите HDF5 файл для просмотра',
      },
    });

    await plugin.onEvent({
      ...defineRuntimeEventInput({
        type: EventTypes.adapterConnectRequest,
        v: 1,
        kind: 'command',
        priority: 'control',
        payload: {
          adapterId: 'pedaling-emg-viewer',
          formData: {
            filePath,
          },
        },
      }),
      seq: 1n,
      timelineId: 'timeline-test',
      tsMonoMs: 0,
      sourcePluginId: 'external-ui',
    }, ctx);

    const viewerStates = emitted
      .filter((event) => event.type === EventTypes.viewerStateChanged)
      .map((event) => event.payload);
    expect(viewerStates.map((payload) => payload.state)).toContain('connecting');
    expect(viewerStates.at(-1)).toMatchObject({
      state: 'connected',
      recordingStartSessionMs: 1234,
      dataStartMs: 1234,
      dataEndMs: 1237,
    });

    const dataEvent = emitted.find((event) => event.type === EventTypes.signalBatch);
    expect(dataEvent).toMatchObject({
      payload: {
        streamId: 'trigno.avanti',
        sampleCount: 4,
        values: new Float32Array([1, 2, 3, 4]),
        timestampsMs: new Float64Array([1234, 1235, 1236, 1237]),
      },
    });
    if (dataEvent?.type === EventTypes.signalBatch) {
      expect(dataEvent.payload.dtMs).toBeUndefined();
      expect(dataEvent.payload.sampleRateHz).toBeUndefined();
    }
  });
});
