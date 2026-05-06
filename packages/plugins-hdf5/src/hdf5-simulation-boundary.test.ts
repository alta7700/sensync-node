import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import h5wasm from 'h5wasm/node';
import {
  loadHdf5SimulationSession,
  normalizeHdf5SimulationFilePath,
  readSimulationWindowForChannel,
  resolveHdf5SimulationConfig,
} from './hdf5-simulation-boundary.ts';

function createAttribute(target: InstanceType<typeof h5wasm.File> | InstanceType<typeof h5wasm.Group>, name: string, value: string | number): void {
  target.create_attribute(name, value);
}

async function createFixtureFile(): Promise<string> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-hdf5-boundary-'));
  const filePath = path.join(tempDir, 'fixture.h5');

  await h5wasm.ready;
  const file = new h5wasm.File(filePath, 'w', { track_order: true });
  try {
    createAttribute(file, 'recordingStartSessionMs', 5);
    const channels = file.create_group('channels', true);
    const group = channels.create_group('fake.a1', true);
    createAttribute(group, 'streamId', 'fake.a1');
    createAttribute(group, 'sampleFormat', 'f32');
    createAttribute(group, 'frameKind', 'uniform-signal-batch');
    createAttribute(group, 'sampleRateHz', 100);
      createAttribute(group, 'units', 'mV');

      group.create_dataset({
        name: 'timestamps',
        data: new Float64Array([10, 20, 30, 40]),
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

async function createFixtureFileWithoutSampleFormatAttr(): Promise<string> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-hdf5-boundary-legacy-'));
  const filePath = path.join(tempDir, 'fixture.h5');

  await h5wasm.ready;
  const file = new h5wasm.File(filePath, 'w', { track_order: true });
  try {
    const channels = file.create_group('channels', true);
    const group = channels.create_group('train.red.smo2', true);
    createAttribute(group, 'streamId', 'train.red.smo2');
    createAttribute(group, 'frameKind', 'irregular-signal-batch');
    createAttribute(group, 'units', '%');

    group.create_dataset({
      name: 'timestamps',
      data: new Float64Array([100, 200, 300]),
      shape: [3],
      dtype: '<d',
    });
    group.create_dataset({
      name: 'values',
      data: new Float32Array([71.5, 72.25, 73]),
      shape: [3],
      dtype: '<f',
    });
  } finally {
    file.close();
  }

  return filePath;
}

async function createFixtureFileWithoutFrameKindAttr(): Promise<string> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-hdf5-boundary-no-frame-kind-'));
  const filePath = path.join(tempDir, 'fixture.h5');

  await h5wasm.ready;
  const file = new h5wasm.File(filePath, 'w', { track_order: true });
  try {
    const channels = file.create_group('channels', true);
    const group = channels.create_group('train.red.smo2', true);
    createAttribute(group, 'streamId', 'train.red.smo2');
    createAttribute(group, 'sampleFormat', 'f32');
    createAttribute(group, 'units', '%');

    group.create_dataset({
      name: 'timestamps',
      data: new Float64Array([100, 200, 300]),
      shape: [3],
      dtype: '<d',
    });
    group.create_dataset({
      name: 'values',
      data: new Float32Array([71.5, 72.25, 73]),
      shape: [3],
      dtype: '<f',
    });
  } finally {
    file.close();
  }

  return filePath;
}

describe('hdf5-simulation-boundary', () => {
  it('нормализует config и читает окно данных из файла', async () => {
    const filePath = await createFixtureFile();
    const config = resolveHdf5SimulationConfig({
      adapterId: 'fake-hdf5-simulation',
      filePath,
      streamIds: ['fake.a1', 'fake.a1'],
      batchMs: 25.8,
      speed: 2,
      readChunkSamples: 2.9,
    });

    expect(config).toMatchObject({
      adapterId: 'fake-hdf5-simulation',
      filePath,
      streamIds: ['fake.a1'],
      batchMs: 25,
      speed: 2,
      readChunkSamples: 2,
    });
    expect(normalizeHdf5SimulationFilePath(filePath)).toBe(filePath);

    const session = loadHdf5SimulationSession(filePath, ['fake.a1'], config.readChunkSamples);
    try {
      expect(session.channels).toHaveLength(1);
      expect(session.recordingStartSessionMs).toBe(5);
      const firstEvent = readSimulationWindowForChannel(session.channels[0]!, 35);
      expect(firstEvent).not.toBeNull();
      expect(firstEvent?.payload.streamId).toBe('fake.a1');
      expect(firstEvent?.payload.sampleCount).toBe(3);
      expect(Array.from(firstEvent?.payload.values ?? [])).toEqual([1, 2, 3]);
    } finally {
      session.file.close();
    }
  });

  it('разрешает отложенный выбор файла через connect form', async () => {
    const config = resolveHdf5SimulationConfig({
      adapterId: 'pedaling-emg-replay',
      allowConnectFilePathOverride: true,
      streamIds: ['trigno.avanti'],
    });

    expect(config).toMatchObject({
      adapterId: 'pedaling-emg-replay',
      allowConnectFilePathOverride: true,
      filePath: '',
      streamIds: ['trigno.avanti'],
    });
  });

  it('если recordingStartSessionMs отсутствует или позже первого sample, использует dataStartMs', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-hdf5-boundary-fallback-'));
    const filePath = path.join(tempDir, 'fixture.h5');

    await h5wasm.ready;
    const file = new h5wasm.File(filePath, 'w', { track_order: true });
    try {
      createAttribute(file, 'recordingStartSessionMs', 50);
      const channels = file.create_group('channels', true);
      const group = channels.create_group('fake.a1', true);
      createAttribute(group, 'streamId', 'fake.a1');
      createAttribute(group, 'sampleFormat', 'f32');
      createAttribute(group, 'frameKind', 'uniform-signal-batch');
      createAttribute(group, 'sampleRateHz', 100);

      group.create_dataset({
        name: 'timestamps',
        data: new Float64Array([10, 20, 30]),
        shape: [3],
        dtype: '<d',
      });
      group.create_dataset({
        name: 'values',
        data: new Float32Array([1, 2, 3]),
        shape: [3],
        dtype: '<f',
      });
    } finally {
      file.close();
    }

    const session = loadHdf5SimulationSession(filePath, ['fake.a1'], 2);
    try {
      expect(session.recordingStartSessionMs).toBe(10);
    } finally {
      session.file.close();
    }
  });

  it('выводит sampleFormat из dtype values dataset, если attr отсутствует', async () => {
    const filePath = await createFixtureFileWithoutSampleFormatAttr();

    const session = loadHdf5SimulationSession(filePath, ['train.red.smo2'], 2);
    try {
      expect(session.channels).toHaveLength(1);
      expect(session.channels[0]?.sampleFormat).toBe('f32');

      const event = readSimulationWindowForChannel(session.channels[0]!, 350);
      expect(event?.payload.sampleFormat).toBe('f32');
      expect(Array.from(event?.payload.values ?? [])).toEqual([71.5, 72.25, 73]);
    } finally {
      session.file.close();
    }
  });

  it('для viewer может подставить irregular frameKind, а replay без attr остается строгим', async () => {
    const filePath = await createFixtureFileWithoutFrameKindAttr();

    expect(() => loadHdf5SimulationSession(filePath, ['train.red.smo2'], 2)).toThrow(
      'отсутствует обязательный attr frameKind',
    );

    const session = loadHdf5SimulationSession(filePath, ['train.red.smo2'], 2, {
      missingFrameKindFallback: 'irregular-signal-batch',
    });
    try {
      expect(session.channels[0]?.frameKind).toBe('irregular-signal-batch');

      const event = readSimulationWindowForChannel(session.channels[0]!, 350);
      expect(event?.payload.frameKind).toBe('irregular-signal-batch');
      expect(event?.payload.timestampsMs).toEqual(new Float64Array([100, 200, 300]));
    } finally {
      session.file.close();
    }
  });
});
