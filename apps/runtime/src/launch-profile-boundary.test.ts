import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readFakeHdf5SimulationEnvOverrides,
  resolveHdf5SimulationFilePathFromEnv,
} from './launch-profile-boundary.ts';

describe('launch-profile-boundary', () => {
  it('валидирует путь simulation-файла и читает env overrides', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-runtime-boundary-'));
    const filePath = path.join(tempDir, 'simulation.h5');
    writeFileSync(filePath, 'stub');

    const overrides = readFakeHdf5SimulationEnvOverrides({
      SENSYNC2_HDF5_SIMULATION_FILE: filePath,
      SENSYNC2_HDF5_SIMULATION_BATCH_MS: '25.9',
      SENSYNC2_HDF5_SIMULATION_SPEED: '2',
      SENSYNC2_HDF5_SIMULATION_READ_CHUNK: '1024',
    });

    expect(overrides).toEqual({
      filePath,
      batchMs: 25,
      speed: 2,
      readChunkSamples: 1024,
    });
    expect(resolveHdf5SimulationFilePathFromEnv({
      SENSYNC2_HDF5_SIMULATION_FILE: filePath,
    })).toBe(filePath);
  });

  it('падает без simulation-файла', () => {
    expect(() => resolveHdf5SimulationFilePathFromEnv({})).toThrow(/SENSYNC2_HDF5_SIMULATION_FILE/);
  });
});
