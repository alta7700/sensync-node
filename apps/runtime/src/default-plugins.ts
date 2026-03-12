import * as path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PluginDescriptor } from './types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const FakeSimulationChannelIds = ['fake.a1', 'fake.a2', 'fake.b', 'shapes.signal', 'interval.label', 'activity.label'] as const;

export const LaunchProfiles = ['fake', 'fake-hdf5-simulation'] as const;
export type LaunchProfile = (typeof LaunchProfiles)[number];

const DefaultLaunchProfile: LaunchProfile = 'fake';

function moduleFileUrl(relativePathFromRepoRoot: string): string {
  return pathToFileURL(path.join(repoRoot, relativePathFromRepoRoot)).href;
}

function isLaunchProfile(value: string): value is LaunchProfile {
  return (LaunchProfiles as readonly string[]).includes(value);
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveHdf5SimulationFilePath(): string {
  const rawValue = process.env.SENSYNC2_HDF5_SIMULATION_FILE?.trim() ?? '';
  if (rawValue.length === 0) {
    throw new Error(
      'Для профиля fake-hdf5-simulation нужно задать SENSYNC2_HDF5_SIMULATION_FILE. '
      + 'Пример: SENSYNC2_HDF5_SIMULATION_FILE=recordings/fake/example.h5 npm run dev:fake-hdf5-simulation',
    );
  }

  const resolved = path.isAbsolute(rawValue) ? rawValue : path.resolve(repoRoot, rawValue);
  if (!existsSync(resolved)) {
    throw new Error(`HDF5 simulation файл не найден: ${resolved}`);
  }
  if (!statSync(resolved).isFile()) {
    throw new Error(`SENSYNC2_HDF5_SIMULATION_FILE должен указывать на файл, а не на директорию: ${resolved}`);
  }
  return resolved;
}

export function resolveLaunchProfile(rawValue: string | undefined | null): LaunchProfile {
  if (typeof rawValue === 'string' && isLaunchProfile(rawValue)) {
    return rawValue;
  }
  return DefaultLaunchProfile;
}

export function listLaunchProfiles(): LaunchProfile[] {
  return [...LaunchProfiles];
}

function makeFakePluginDescriptors(): PluginDescriptor[] {
  return [
    {
      id: 'fake-signal-adapter',
      modulePath: moduleFileUrl('packages/plugins-fake/src/fake-signal-adapter.ts'),
      config: {
        sampleRateHz: 200,
        batchMs: 50,
        compareSampleRateHz: 200,
        compareBatchMs: 50,
      },
    },
    {
      id: 'shape-generator-adapter',
      modulePath: moduleFileUrl('packages/plugins-fake/src/shape-generator-adapter.ts'),
      config: {
        sampleRateHz: 200,
        batchMs: 50,
      },
    },
    {
      id: 'interval-label-adapter',
      modulePath: moduleFileUrl('packages/plugins-fake/src/interval-label-adapter.ts'),
      config: {},
    },
    {
      id: 'rolling-min-processor',
      modulePath: moduleFileUrl('packages/plugins-fake/src/rolling-min-processor.ts'),
      config: {
        sourceChannelId: 'fake.a2',
        outputChannelId: 'metrics.fake.a2.rolling_min_1s',
      },
    },
    {
      id: 'activity-detector-processor',
      modulePath: moduleFileUrl('packages/plugins-fake/src/activity-detector-processor.ts'),
      config: {
        sourceChannelId: 'shapes.signal',
        threshold: 0.6,
      },
    },
    {
      id: 'hdf5-recorder',
      modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-recorder-plugin.ts'),
      config: {
        writerKey: 'local',
        outputDir: path.join(repoRoot, 'recordings/fake'),
        defaultFilenameTemplate: '{writer}-{startDateTime}',
      },
    },
    {
      id: 'ui-gateway',
      modulePath: moduleFileUrl('packages/plugins-ui-gateway/src/ui-gateway-plugin.ts'),
      config: {
        sessionId: 'local-desktop',
        profile: 'fake',
      },
    },
  ];
}

function makeFakeHdf5SimulationPluginDescriptors(): PluginDescriptor[] {
  const filePath = resolveHdf5SimulationFilePath();
  return [
    {
      id: 'hdf5-simulation-adapter',
      modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-simulation-adapter.ts'),
      config: {
        adapterId: 'fake-hdf5-simulation',
        filePath,
        channelIds: [...FakeSimulationChannelIds],
        batchMs: Math.max(1, Math.trunc(envNumber('SENSYNC2_HDF5_SIMULATION_BATCH_MS', 50))),
        speed: envNumber('SENSYNC2_HDF5_SIMULATION_SPEED', 1),
        readChunkSamples: Math.max(1, Math.trunc(envNumber('SENSYNC2_HDF5_SIMULATION_READ_CHUNK', 4096))),
      },
    },
    {
      id: 'ui-gateway',
      modulePath: moduleFileUrl('packages/plugins-ui-gateway/src/ui-gateway-plugin.ts'),
      config: {
        sessionId: 'local-desktop',
        profile: 'fake-hdf5-simulation',
      },
    },
  ];
}

/**
 * Возвращает композицию плагинов для выбранного launch profile.
 *
 * `fake` используем как дефолтный dev-профиль, а `fake-hdf5-simulation`
 * оставляем переходным сценарием проигрывания fake-каналов из записанного HDF5.
 */
export function makePluginDescriptors(profile: LaunchProfile = DefaultLaunchProfile): PluginDescriptor[] {
  if (profile === 'fake-hdf5-simulation') {
    return makeFakeHdf5SimulationPluginDescriptors();
  }
  return makeFakePluginDescriptors();
}

/**
 * Обратная совместимость для существующих точек входа.
 *
 * Если профиль не задан, запускаем `fake`.
 */
export function makeDefaultPluginDescriptors(rawProfile: string | undefined = process.env.SENSYNC2_PROFILE): PluginDescriptor[] {
  return makePluginDescriptors(resolveLaunchProfile(rawProfile));
}
