import { describe, expect, it, vi } from 'vitest';
import {
  buildAntTransportConnectRequest,
  buildAntTransportScanRequest,
  decodeRawMoxyPacketMeta,
  readAntPlusEnvOverrides,
  realPacketFromState,
} from './ant-plus-boundary.ts';

describe('ant-plus-boundary', () => {
  it('нормализует env overrides и formData', () => {
    expect(readAntPlusEnvOverrides({
      SENSYNC2_ANT_PLUS_MODE: 'real',
      SENSYNC2_ANT_PLUS_STICK_PRESENT: '0',
      SENSYNC2_ANT_PLUS_SCAN_DELAY_MS: '1500',
      SENSYNC2_ANT_PLUS_PACKET_INTERVAL_MS: '33',
      SENSYNC2_ANT_PLUS_LOG_PACKET_TIMING: 'true',
    })).toEqual({
      mode: 'real',
      stickPresent: false,
      scanDelayMs: 1500,
      packetIntervalMs: 33,
      logPacketTiming: true,
    });

    expect(buildAntTransportScanRequest({ profile: 'muscle-oxygen' }, 1200)).toEqual({
      profile: 'muscle-oxygen',
      timeoutMs: 1200,
    });

    expect(buildAntTransportConnectRequest({
      profile: 'muscle-oxygen',
      scanId: 'scan-1',
      candidateId: 'moxy:1',
      deviceId: '123',
    })).toEqual({
      profile: 'muscle-oxygen',
      scanId: 'scan-1',
      candidateId: 'moxy:1',
      deviceId: 123,
    });
  });

  it('декодирует raw пакет и предпочитает интервал из устройства', () => {
    const buffer = Buffer.alloc(12);
    buffer.writeUInt8(0x4e, 2);
    buffer.writeUInt8(7, 3);
    buffer.writeUInt8(0x01, 4);
    buffer.writeUInt8(42, 5);
    buffer.writeUInt16LE(512, 6);

    const meta = decodeRawMoxyPacketMeta(buffer, 7);
    expect(meta).not.toBeNull();
    expect(meta?.eventCount).toBe(42);
    expect(meta?.rawMeasurementIntervalMs).toBe(500);

    const warn = vi.fn();
    const mark = vi.fn();
    const packet = realPacketFromState({
      DeviceID: 1,
      _EventCount: 42,
      MeasurementInterval: 0.25,
      CurrentSaturatedHemoglobinPercentage: 823,
      TotalHemoglobinConcentration: 1345,
    }, meta ?? undefined, {
      lastSignature: null,
      lastAtMonoMs: null,
      onWarn: warn,
      mark,
    });

    expect(packet).toMatchObject({
      eventCount: 42,
      measurementIntervalMs: 500,
      smo2: 82.3,
      thb: 13.45,
      rawMeasurementIntervalMs: 500,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(mark).toHaveBeenCalledOnce();
  });
});
