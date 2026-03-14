import { describe, expect, it } from 'vitest';
import {
  buildBleTransportConnectRequest,
  makeBleScanCandidate,
  readZephyrBioHarnessEnvOverrides,
  resolveZephyrBioHarnessConfig,
  zephyrBioHarnessDiscoveryScore,
} from './ble-boundary.ts';

describe('ble-boundary', () => {
  it('читает env overrides и нормализует конфиг Zephyr', () => {
    const overrides = readZephyrBioHarnessEnvOverrides({
      SENSYNC2_ZEPHYR_BIOHARNESS_MODE: 'real',
      SENSYNC2_ZEPHYR_BIOHARNESS_SCAN_TIMEOUT_MS: '7250',
      SENSYNC2_ZEPHYR_BIOHARNESS_AUTO_RECONNECT: '0',
      SENSYNC2_ZEPHYR_BIOHARNESS_RECONNECT_RETRY_DELAY_MS: '900',
      SENSYNC2_ZEPHYR_BIOHARNESS_LOG_BLE: '1',
    });

    const config = resolveZephyrBioHarnessConfig(overrides);

    expect(config).toMatchObject({
      mode: 'real',
      scanTimeoutMs: 7250,
      autoReconnect: false,
      reconnectRetryDelayMs: 900,
      logBleDebug: true,
    });
  });

  it('строит connect request из modal form payload', () => {
    expect(buildBleTransportConnectRequest({
      candidateId: 'candidate-1',
      scanId: 'scan-1',
      peripheralId: 'peripheral-1',
      localName: 'BH BHT 01',
    })).toEqual({
      candidateId: 'candidate-1',
      scanId: 'scan-1',
      peripheralId: 'peripheral-1',
      localName: 'BH BHT 01',
    });
  });

  it('делает candidate даже без localName и поднимает вероятный Zephyr score', () => {
    const candidate = makeBleScanCandidate('scan-1', {
      id: 'peripheral-1',
      address: 'AA-BB-CC',
      rssi: -55,
      advertisement: {
        serviceUuids: ['befdff20-c979-11e1-9b21-0800200c9a66'],
        serviceData: [],
      },
      on() {},
      removeListener() {},
      connect() {},
      disconnect() {},
      discoverServices() {},
      discoverSomeServicesAndCharacteristics() {},
    });

    expect(candidate.title).toBe('AA-BB-CC');
    expect(candidate.details?.likelyZephyr).toBe(true);
    expect(zephyrBioHarnessDiscoveryScore({
      id: 'peripheral-1',
      address: 'AA-BB-CC',
      rssi: -55,
      advertisement: {
        serviceUuids: ['befdff20-c979-11e1-9b21-0800200c9a66'],
        serviceData: [],
      },
      on() {},
      removeListener() {},
      connect() {},
      disconnect() {},
      discoverServices() {},
      discoverSomeServicesAndCharacteristics() {},
    })).toBeGreaterThan(0);
  });
});
