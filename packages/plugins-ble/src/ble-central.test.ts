import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveZephyrBioHarnessConfig } from './ble-boundary.ts';
import { createBleTransport } from './ble-central.ts';

describe('ble-central fake transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('проходит fake scan -> connect -> packet flow', async () => {
    const transport = createBleTransport(resolveZephyrBioHarnessConfig({
      mode: 'fake',
      scanTimeoutMs: 20,
      fakePacketIntervalMs: 100,
    }));

    const scanPromise = transport.scan({ timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    const scan = await scanPromise;
    expect(scan.candidates).toHaveLength(1);

    const candidate = scan.candidates[0];
    expect(candidate).toBeDefined();
    await transport.connect({
      candidateId: candidate!.candidateId,
      scanId: String(candidate!.connectFormData.scanId),
    });

    await vi.advanceTimersByTimeAsync(100);
    const packet = transport.readPacket();
    expect(packet).not.toBeNull();
  });

  it('отдаёт connection signal после fake disconnect', async () => {
    const transport = createBleTransport(resolveZephyrBioHarnessConfig({
      mode: 'fake',
      scanTimeoutMs: 20,
      fakePacketIntervalMs: 100,
      fakeAutoDisconnectAfterMs: 300,
    }));

    const scanPromise = transport.scan({ timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    const scan = await scanPromise;
    const candidate = scan.candidates[0];
    expect(candidate).toBeDefined();

    await transport.connect({
      candidateId: candidate!.candidateId,
      scanId: String(candidate!.connectFormData.scanId),
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(transport.takeConnectionSignal()).toMatch(/разрыв соединения/i);
  });
});
