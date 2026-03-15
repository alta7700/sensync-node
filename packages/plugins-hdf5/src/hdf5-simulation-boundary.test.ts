import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import h5wasm from 'h5wasm/node';
import {
  loadHdf5SimulationSession,
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
    const channels = file.create_group('channels', true);
    const group = channels.create_group('fake.a1', true);
    createAttribute(group, 'streamId', 'fake.a1');
    createAttribute(group, 'sampleFormat', 'f32');
    createAttribute(group, 'frameKind', 'uniform-signal-batch');
    createAttribute(group, 'sampleRateHz', 100);
    createAttribute(group, 'units', 'mV');

    group.create_dataset({
      name: 'timestamps',
      data: new Float64Array([0, 10, 20, 30]),
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

    const session = loadHdf5SimulationSession(filePath, ['fake.a1'], config.readChunkSamples);
    try {
      expect(session.channels).toHaveLength(1);
      const firstEvent = readSimulationWindowForChannel(session.channels[0]!, 25);
      expect(firstEvent).not.toBeNull();
      expect(firstEvent?.payload.streamId).toBe('fake.a1');
      expect(firstEvent?.payload.sampleCount).toBe(3);
      expect(Array.from(firstEvent?.payload.values ?? [])).toEqual([1, 2, 3]);
    } finally {
      session.file.close();
    }
  });
});
