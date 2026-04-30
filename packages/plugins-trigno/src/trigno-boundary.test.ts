import { describe, expect, it } from 'vitest';
import {
  buildTrignoExpectedStartSnapshot,
  buildTrignoConnectRequest,
  diffTrignoExpectedStartSnapshot,
  formatTrignoSnapshotMismatchMessage,
  isPairedTrignoConnectRequest,
  isPairedTrignoStatusSnapshot,
  resolveTrignoAdapterConfig,
  trignoUiCommandBoundaryGuards,
  type TrignoSingleSensorStatusSnapshot,
  type TrignoPairedSensorStatusSnapshot,
} from './trigno-boundary.ts';

function makeSnapshot(): TrignoSingleSensorStatusSnapshot {
  return {
    host: '10.9.15.71',
    sensorSlot: 1,
    banner: 'Delsys Trigno System Digital Protocol Version 3.6.0',
    protocolVersion: '3.6.0',
    paired: false,
    mode: 7,
    startIndex: 1,
    channelCount: 4,
    emgChannelCount: 1,
    auxChannelCount: 3,
    backwardsCompatibility: false,
    upsampling: false,
    frameInterval: 0.0135,
    maxSamplesEmg: 26,
    maxSamplesAux: 2,
    serial: 'SP-W02C-1759',
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
  };
}

describe('trigno-boundary', () => {
  it('нормализует конфиг и connect formData', () => {
    const config = resolveTrignoAdapterConfig({
      commandPort: 50040.7,
      emgPort: 50043.2,
      auxPort: 50044.8,
      reconnectRetryDelayMs: 25,
      backwardsCompatibility: true,
    });

    expect(config.backwardsCompatibility).toBe(true);
    expect(config.upsampling).toBe(false);
    expect(config.commandPort).toBe(50040);
    expect(config.emgPort).toBe(50043);
    expect(config.auxPort).toBe(50044);
    expect(config.reconnectRetryDelayMs).toBe(250);

    expect(buildTrignoConnectRequest({
      host: ' 10.9.15.71 ',
      sensorSlot: '1',
    })).toEqual({
      host: '10.9.15.71',
      sensorSlot: 1,
    });

    const pairedRequest = buildTrignoConnectRequest({
      host: ' 10.9.15.71 ',
      vlSensorSlot: '1',
      rfSensorSlot: '2',
    });
    expect(isPairedTrignoConnectRequest(pairedRequest)).toBe(true);
    expect(pairedRequest).toEqual({
      host: '10.9.15.71',
      vlSensorSlot: 1,
      rfSensorSlot: 2,
    });
  });

  it('валидирует диапазон sensorSlot и host', () => {
    expect(() => buildTrignoConnectRequest({ host: '', sensorSlot: 1 })).toThrow(/host/);
    expect(() => buildTrignoConnectRequest({ host: '10.0.0.1', sensorSlot: 17 })).toThrow(/1..16/);
    expect(() => buildTrignoConnectRequest({ host: '10.0.0.1', vlSensorSlot: 1 })).toThrow(/rfSensorSlot/);
    expect(() => buildTrignoConnectRequest({ host: '10.0.0.1', vlSensorSlot: 2, rfSensorSlot: 2 })).toThrow(/один и тот же слот/);
  });

  it('находит mismatch в expected start snapshot и форматирует сообщение', () => {
    const snapshot = makeSnapshot();
    snapshot.mode = 65;
    snapshot.gyro.units = 'rad/s';

    const mismatches = diffTrignoExpectedStartSnapshot(snapshot);

    expect(mismatches).toEqual([
      { field: 'mode', expected: 7, actual: 65 },
      { field: 'gyro.units', expected: 'deg/s', actual: 'rad/s' },
    ]);
    expect(formatTrignoSnapshotMismatchMessage(mismatches)).toContain('mode: ожидалось 7, получено 65');
  });

  it('не считает paired-флаг частью expected start snapshot', () => {
    const snapshot = makeSnapshot();
    snapshot.paired = true;

    expect(diffTrignoExpectedStartSnapshot(snapshot)).toEqual([]);
  });

  it('строит expected snapshot с BC/UPSAMPLE из adapter config', () => {
    expect(buildTrignoExpectedStartSnapshot({
      backwardsCompatibility: true,
      upsampling: true,
    })).toMatchObject({
      backwardsCompatibility: true,
      upsampling: true,
      emgRateHz: 1925.92592592593,
      gyroRateHz: 148.148148148148,
    });
  });

  it('экспортирует UI guards для plugin-specific команд', () => {
    const startGuard = trignoUiCommandBoundaryGuards.find((guard) => guard.type === 'trigno.stream.start.request');
    expect(startGuard).toBeDefined();
    expect(startGuard?.isPayload({ adapterId: 'trigno' })).toBe(true);
    expect(startGuard?.isPayload({ adapterId: 1 })).toBe(false);
  });

  it('распознает paired snapshot через type guard', () => {
    const snapshot: TrignoPairedSensorStatusSnapshot = {
      host: '10.9.15.71',
      banner: 'Delsys Trigno System Digital Protocol Version 3.6.0',
      protocolVersion: '3.6.0',
      backwardsCompatibility: false,
      upsampling: false,
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
          backwardsCompatibility: false,
          upsampling: false,
          frameInterval: 0.0135,
          maxSamplesEmg: 26,
          maxSamplesAux: 2,
          serial: 'VL',
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
        rf: {
          sensorSlot: 2,
          paired: true,
          mode: 7,
          startIndex: 5,
          channelCount: 4,
          emgChannelCount: 1,
          auxChannelCount: 3,
          backwardsCompatibility: false,
          upsampling: false,
          frameInterval: 0.0135,
          maxSamplesEmg: 26,
          maxSamplesAux: 2,
          serial: 'RF',
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
    };

    expect(isPairedTrignoStatusSnapshot(snapshot)).toBe(true);
  });
});
