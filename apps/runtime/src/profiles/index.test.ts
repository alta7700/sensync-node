import { mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runtimeRepoRoot } from '../launch-profile-boundary.ts';
import { buildLaunchProfile, LaunchProfiles, resolveLaunchProfile } from './index.ts';

function uiGatewayConfig(
  profileId: 'fake' | 'fake-hdf5-simulation' | 'veloerg' | 'pedaling-emg-test' | 'pedaling-emg-replay',
  env: NodeJS.ProcessEnv = process.env,
) {
  const profile = buildLaunchProfile(profileId, env);
  const descriptor = profile.plugins.find((plugin) => plugin.id === 'ui-gateway');
  if (!descriptor) {
    throw new Error(`В профиле ${profileId} не найден ui-gateway`);
  }
  return descriptor.config as { sessionId: string; schema: { pages: Array<{ title: string }> } };
}

describe('launch profiles registry', () => {
  it('резолвит неизвестный профиль в fake', () => {
    expect(resolveLaunchProfile('unknown')).toBe('fake');
  });


  it('каждый зарегистрированный профиль собирается в ResolvedLaunchProfile с ui-gateway и schema', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-profile-all-'));
    const hdf5Path = path.join(tempDir, 'simulation.h5');
    writeFileSync(hdf5Path, 'stub');

    for (const profileId of LaunchProfiles) {
      const env = profileId === 'fake-hdf5-simulation'
        ? {
            ...process.env,
            SENSYNC2_HDF5_SIMULATION_FILE: hdf5Path,
          }
        : process.env;
      const profile = buildLaunchProfile(profileId, env);
      expect(profile.id).toBe(profileId);
      expect(profile.title.length).toBeGreaterThan(0);
      expect(profile.plugins.length).toBeGreaterThan(0);

      const uniqueIds = new Set(profile.plugins.map((plugin) => plugin.id));
      expect(uniqueIds.size).toBe(profile.plugins.length);

      const uiGateway = profile.plugins.find((plugin) => plugin.id === 'ui-gateway');
      expect(uiGateway).toBeDefined();
      const config = uiGateway?.config as { schema?: { pages?: Array<{ title?: string }> } } | undefined;
      expect(config?.schema?.pages?.length).toBeGreaterThan(0);
    }
  });

  it('в fake-профиле передает готовую fake schema в ui-gateway', () => {
    const config = uiGatewayConfig('fake');
    expect(config.sessionId).toBe('local-desktop');
    expect(config.schema.pages[0]?.title).toBe('Main');
  });

  it('в fake-профиле подключает generic label-generator для interval.label', () => {
    const profile = buildLaunchProfile('fake');
    const generator = profile.plugins.find((plugin) => plugin.id === 'label-generator-adapter');

    expect(generator).toBeDefined();
    expect(generator?.config).toMatchObject({
      labels: {
        interval: {
          streamId: 'interval.label',
          sampleFormat: 'i16',
        },
      },
    });
  });

  it('в fake-профиле включает profile-level timeline reset', () => {
    const profile = buildLaunchProfile('fake');

    expect(profile.timelineReset).toMatchObject({
      enabled: true,
      requesters: ['external-ui'],
      participants: [
        'ui-gateway',
        'fake-signal-adapter',
        'shape-generator-adapter',
        'rolling-min-processor',
        'activity-detector-processor',
      ],
      recorderPolicy: 'reject-if-recording',
    });
  });

  it('в veloerg-профиле передает готовую veloerg schema в ui-gateway', () => {
    const config = uiGatewayConfig('veloerg');
    expect(config.schema.pages[0]?.title).toBe('Veloerg');
  });

  it('в pedaling-emg-test профиле передает отдельную schema в ui-gateway', () => {
    const config = uiGatewayConfig('pedaling-emg-test');
    expect(config.schema.pages[0]?.title).toBe('Pedaling EMG test');
  });

  it('в pedaling-emg-replay профиле передает replay schema в ui-gateway', () => {
    const config = uiGatewayConfig('pedaling-emg-replay');
    expect(config.schema.pages[0]?.title).toBe('Pedaling EMG replay');
  });

  it('в veloerg-профиле подключает generic hr-from-rr processor', () => {
    const profile = buildLaunchProfile('veloerg');
    const processor = profile.plugins.find((plugin) => plugin.id === 'hr-from-rr-processor');
    const dfaProcessor = profile.plugins.find((plugin) => plugin.id === 'dfa-a1-from-rr-processor');
    const pedalingProcessor = profile.plugins.find((plugin) => plugin.id === 'pedaling-emg-processor');

    expect(processor).toBeDefined();
    expect(processor?.config).toMatchObject({
      sourceStreamId: 'zephyr.rr',
      outputStreamId: 'zephyr.hr',
    });
    expect(dfaProcessor).toBeDefined();
    expect(dfaProcessor?.config).toMatchObject({
      sourceStreamId: 'zephyr.rr',
      outputStreamId: 'zephyr.dfa_a1',
      rrUnit: 's',
      required: true,
    });
    expect(pedalingProcessor).toBeDefined();
    expect(pedalingProcessor?.config).toMatchObject({
      emgStreamId: 'trigno.avanti',
      phaseLabelStreamId: 'pedaling.phase.coarse',
      activityLabelStreamId: 'pedaling.activity.vastus-lateralis',
      required: true,
    });
  });

  it('в veloerg-профиле включает recorder-driven timeline reset и live recorder config', () => {
    const profile = buildLaunchProfile('veloerg');
    const recorder = profile.plugins.find((plugin) => plugin.id === 'hdf5-recorder');
    const zephyr = profile.plugins.find((plugin) => plugin.id === 'zephyr-bioharness-3-adapter');
    const hrProcessor = profile.plugins.find((plugin) => plugin.id === 'hr-from-rr-processor');
    const dfaProcessor = profile.plugins.find((plugin) => plugin.id === 'dfa-a1-from-rr-processor');
    const pedalingProcessor = profile.plugins.find((plugin) => plugin.id === 'pedaling-emg-processor');

    expect(profile.timelineReset).toMatchObject({
      enabled: true,
      requesters: ['hdf5-recorder'],
      participants: [
        'ui-gateway',
        'ant-plus-adapter',
        'zephyr-bioharness-3-adapter',
        'hr-from-rr-processor',
        'dfa-a1-from-rr-processor',
        'pedaling-emg-processor',
        'trigno-adapter',
        'hdf5-recorder',
      ],
      recorderPolicy: 'reject-if-recording',
    });

    expect(recorder).toBeDefined();
    expect(recorder?.config).toMatchObject({
      writerKey: 'local',
      resetTimelineOnStart: true,
      resetTimelineOnStop: true,
      required: true,
      outputDir: path.join(runtimeRepoRoot, 'recordings/veloerg'),
    });
    expect(recorder?.config).toMatchObject({
      startConditions: {
        checks: [
          { where: { adapterId: 'ant-plus' }, field: 'state', eq: 'connected' },
          { where: { adapterId: 'zephyr-bioharness' }, field: 'state', eq: 'connected' },
          { where: { adapterId: 'trigno' }, field: 'state', eq: 'connected' },
        ],
      },
    });
    expect(zephyr?.config).toMatchObject({ required: true });
    expect(hrProcessor?.config).toMatchObject({ required: true });
    expect(dfaProcessor?.config).toMatchObject({ required: true });
    expect(pedalingProcessor?.config).toMatchObject({ required: true });
  });

  it('в pedaling-emg-test профиле включает Trigno, pedaling processor и raw HDF5 recorder', () => {
    const profile = buildLaunchProfile('pedaling-emg-test');
    const trigno = profile.plugins.find((plugin) => plugin.id === 'trigno-adapter');
    const pedalingProcessor = profile.plugins.find((plugin) => plugin.id === 'pedaling-emg-processor');
    const recorder = profile.plugins.find((plugin) => plugin.id === 'hdf5-recorder');

    expect(profile.timelineReset).toMatchObject({
      enabled: true,
      requesters: ['hdf5-recorder'],
      participants: [
        'ui-gateway',
        'trigno-adapter',
        'pedaling-emg-processor',
        'hdf5-recorder',
      ],
      recorderPolicy: 'reject-if-recording',
    });
    expect(trigno?.config).toMatchObject({
      adapterId: 'trigno',
      mode: 'real',
      backwardsCompatibility: false,
      upsampling: false,
    });
    expect(pedalingProcessor?.config).toMatchObject({
      emgStreamId: 'trigno.avanti',
      activityLabelStreamId: 'pedaling.activity.vastus-lateralis',
      required: true,
    });
    expect(recorder?.config).toMatchObject({
      outputDir: path.join(runtimeRepoRoot, 'recordings/pedaling-emg-test'),
      resetTimelineOnStart: true,
      resetTimelineOnStop: true,
      required: true,
      startConditions: {
        checks: [
          { where: { adapterId: 'trigno' }, field: 'state', eq: 'connected' },
        ],
      },
    });
  });

  it('в pedaling-emg-replay профиле включает HDF5 replay с выбором файла и pedaling processor', () => {
    const profile = buildLaunchProfile('pedaling-emg-replay');
    const simulation = profile.plugins.find((plugin) => plugin.id === 'hdf5-simulation-adapter');
    const pedalingProcessor = profile.plugins.find((plugin) => plugin.id === 'pedaling-emg-processor');

    expect(profile.timelineReset).toBeUndefined();
    expect(simulation?.config).toMatchObject({
      adapterId: 'pedaling-emg-replay',
      allowConnectFilePathOverride: true,
      streamIds: [
        'trigno.avanti',
        'trigno.avanti.gyro.x',
        'trigno.avanti.gyro.y',
        'trigno.avanti.gyro.z',
      ],
      batchMs: 50,
      speed: 1,
    });
    expect(pedalingProcessor?.config).toMatchObject({
      emgStreamId: 'trigno.avanti',
      activityLabelStreamId: 'pedaling.activity.vastus-lateralis',
      required: true,
    });
  });

  it('в fake-hdf5-simulation профиле применяет env overrides до сборки plugins', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'sensync2-profile-'));
    const hdf5Path = path.join(tempDir, 'simulation.h5');
    writeFileSync(hdf5Path, 'stub');

    const profile = buildLaunchProfile('fake-hdf5-simulation', {
      ...process.env,
      SENSYNC2_HDF5_SIMULATION_FILE: hdf5Path,
      SENSYNC2_HDF5_SIMULATION_BATCH_MS: '125',
      SENSYNC2_HDF5_SIMULATION_SPEED: '2.5',
      SENSYNC2_HDF5_SIMULATION_READ_CHUNK: '2048',
    });

    const simulation = profile.plugins.find((plugin) => plugin.id === 'hdf5-simulation-adapter');
    expect(simulation?.config).toMatchObject({
      filePath: hdf5Path,
      batchMs: 125,
      speed: 2.5,
      readChunkSamples: 2048,
    });
  });
});
