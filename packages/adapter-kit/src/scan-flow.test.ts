import { describe, expect, it } from 'vitest';
import { createScanFlow } from './scan-flow.ts';

function createTestContext() {
  const emitted: unknown[] = [];
  return {
    emitted,
    ctx: {
      pluginId: 'test-plugin',
      clock: {
        nowSessionMs: () => 0,
        sessionStartWallMs: () => 0,
      },
      emit: async (event: unknown) => {
        emitted.push(event);
      },
      setTimer() {},
      clearTimer() {},
      telemetry() {},
      getConfig() {
        return undefined;
      },
    },
  };
}

describe('scan-flow', () => {
  it('кэширует plugin-specific данные и эмитит только candidateId наружу', async () => {
    const flow = createScanFlow<{ address: string }>({ adapterId: 'zephyr' });
    const { ctx, emitted } = createTestContext();

    const result = await flow.handleScanRequest(
      ctx as never,
      { adapterId: 'zephyr', requestId: 'scan-1' },
      async () => [
        { title: 'Zephyr A', data: { address: 'AA:BB' } },
      ],
    );

    expect(result.candidates).toHaveLength(1);
    const candidateId = result.candidates[0]!.candidateId;
    expect(flow.getCandidateData(candidateId)).toEqual({ address: 'AA:BB' });

    const candidatesEvent = emitted.find((event) => {
      return typeof event === 'object' && event !== null && 'type' in event && (event as { type: string }).type === 'adapter.scan.candidates';
    }) as { payload: { candidates: Array<{ connectFormData: Record<string, unknown> }> } };
    expect(candidatesEvent.payload.candidates[0]?.connectFormData).toEqual({ candidateId });
  });
});
