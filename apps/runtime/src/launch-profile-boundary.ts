import * as path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const runtimeRepoRoot = path.resolve(__dirname, '../../..');

export function moduleFileUrl(relativePathFromRepoRoot: string): string {
  return pathToFileURL(path.join(runtimeRepoRoot, relativePathFromRepoRoot)).href;
}

export function readEnvNumber(rawValue: string | undefined, fallback: number): number {
  if (rawValue === undefined || rawValue === '') return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Валидирует и резолвит путь HDF5-файла для simulation-профиля.
 *
 * Boundary остаётся здесь, а не внутри launch profile builder, чтобы runtime
 * не смешивал сборку композиции плагинов с чтением внешнего окружения.
 */
export function resolveHdf5SimulationFilePathFromEnv(env: NodeJS.ProcessEnv): string {
  const rawValue = env.SENSYNC2_HDF5_SIMULATION_FILE?.trim() ?? '';
  if (rawValue.length === 0) {
    throw new Error(
      'Для профиля fake-hdf5-simulation нужно задать SENSYNC2_HDF5_SIMULATION_FILE. '
      + 'Пример: SENSYNC2_HDF5_SIMULATION_FILE=recordings/fake/example.h5 npm run dev:fake-hdf5-simulation',
    );
  }

  const resolved = path.isAbsolute(rawValue) ? rawValue : path.resolve(runtimeRepoRoot, rawValue);
  if (!existsSync(resolved)) {
    throw new Error(`HDF5 simulation файл не найден: ${resolved}`);
  }
  if (!statSync(resolved).isFile()) {
    throw new Error(`SENSYNC2_HDF5_SIMULATION_FILE должен указывать на файл, а не на директорию: ${resolved}`);
  }
  return resolved;
}

export interface FakeHdf5SimulationEnvOverrides {
  filePath: string;
  batchMs: number;
  speed: number;
  readChunkSamples: number;
}

export function readFakeHdf5SimulationEnvOverrides(env: NodeJS.ProcessEnv): FakeHdf5SimulationEnvOverrides {
  return {
    filePath: resolveHdf5SimulationFilePathFromEnv(env),
    batchMs: Math.max(1, Math.trunc(readEnvNumber(env.SENSYNC2_HDF5_SIMULATION_BATCH_MS, 50))),
    speed: readEnvNumber(env.SENSYNC2_HDF5_SIMULATION_SPEED, 1),
    readChunkSamples: Math.max(1, Math.trunc(readEnvNumber(env.SENSYNC2_HDF5_SIMULATION_READ_CHUNK, 4096))),
  };
}
