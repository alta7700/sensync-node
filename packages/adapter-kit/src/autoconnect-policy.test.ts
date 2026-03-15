import { describe, expect, it } from 'vitest';
import {
  resolveAutoconnectDecision,
  runAutoconnect,
} from './autoconnect-policy.ts';

describe('autoconnect-policy', () => {
  it('выполняет разрешённое автоподключение', async () => {
    const calls: string[] = [];
    const decision = await runAutoconnect({ kind: 'auto-on-init' }, async () => {
      calls.push('auto');
    });

    expect(decision.shouldAutoconnect).toBe(true);
    expect(calls).toEqual(['auto']);
  });

  it('не требует повторного resolve для готового решения', async () => {
    const calls: string[] = [];
    const decision = await runAutoconnect({
      kind: 'auto-from-persisted-profile',
      shouldAutoconnect: true,
      profile: { host: 'demo' },
    }, async (input) => {
      calls.push(input.profile!.host);
    });

    expect(decision.profile).toEqual({ host: 'demo' });
    expect(calls).toEqual(['demo']);
  });

  it('требует готовый persisted profile', () => {
    expect(resolveAutoconnectDecision({
      kind: 'auto-from-persisted-profile',
      profile: null,
    }).shouldAutoconnect).toBe(false);

    expect(resolveAutoconnectDecision({
      kind: 'auto-from-persisted-profile',
      profile: { host: 'demo' },
      isReady: (profile) => profile.host.length > 0,
    })).toMatchObject({
      shouldAutoconnect: true,
      profile: { host: 'demo' },
    });
  });
});
