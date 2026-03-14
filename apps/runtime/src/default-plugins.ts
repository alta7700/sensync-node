import * as path from 'node:path';
import type { PluginDescriptor } from './types.ts';
import {
  moduleFileUrl,
  readFakeHdf5SimulationEnvOverrides,
  runtimeRepoRoot,
} from './launch-profile-boundary.ts';

const FakeSimulationChannelIds = ['fake.a1', 'fake.a2', 'fake.b', 'shapes.signal', 'interval.label', 'activity.label'] as const;

export const LaunchProfiles = ['fake', 'fake-hdf5-simulation', 'veloerg'] as const;
export type LaunchProfile = (typeof LaunchProfiles)[number];

const DefaultLaunchProfile: LaunchProfile = 'fake';

function isLaunchProfile(value: string): value is LaunchProfile {
  return (LaunchProfiles as readonly string[]).includes(value);
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
        outputDir: path.join(runtimeRepoRoot, 'recordings/fake'),
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
  const envOverrides = readFakeHdf5SimulationEnvOverrides(process.env);
  return [
    {
      id: 'hdf5-simulation-adapter',
      modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-simulation-adapter.ts'),
      config: {
        adapterId: 'fake-hdf5-simulation',
        filePath: envOverrides.filePath,
        channelIds: [...FakeSimulationChannelIds],
        batchMs: envOverrides.batchMs,
        speed: envOverrides.speed,
        readChunkSamples: envOverrides.readChunkSamples,
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

function makeVeloergPluginDescriptors(): PluginDescriptor[] {
  return [
    {
      id: 'ant-plus-adapter',
      modulePath: moduleFileUrl('packages/plugins-ant-plus/src/ant-plus-adapter.ts'),
      config: {
        adapterId: 'ant-plus',
        mode: 'real',
      },
    },
    {
      id: 'zephyr-bioharness-3-adapter',
      modulePath: moduleFileUrl('packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts'),
      config: {
        adapterId: 'zephyr-bioharness',
        mode: 'real',
      },
    },
    {
      id: 'ui-gateway',
      modulePath: moduleFileUrl('packages/plugins-ui-gateway/src/ui-gateway-plugin.ts'),
      config: {
        sessionId: 'local-desktop',
        profile: 'veloerg',
      },
    },
  ];
}

/**
 * Возвращает композицию плагинов для выбранного launch profile.
 *
 * `fake` используем как дефолтный dev-профиль, а `fake-hdf5-simulation`
 * оставляем переходным сценарием проигрывания fake-каналов из записанного HDF5.
 * `veloerg` нужен для live composite-сценария ANT+/Moxy и BLE/Zephyr с реальным transport по умолчанию.
 */
export function makePluginDescriptors(profile: LaunchProfile = DefaultLaunchProfile): PluginDescriptor[] {
  if (profile === 'fake-hdf5-simulation') {
    return makeFakeHdf5SimulationPluginDescriptors();
  }
  if (profile === 'veloerg') {
    return makeVeloergPluginDescriptors();
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
