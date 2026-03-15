import type {
  AdapterAutoconnectDecision,
  AdapterAutoconnectPolicy,
} from './types.ts';

export function resolveAutoconnectDecision<TProfile>(
  policy: AdapterAutoconnectPolicy<TProfile>,
): AdapterAutoconnectDecision<TProfile> {
  if (policy.kind === 'manual') {
    return { kind: policy.kind, shouldAutoconnect: false };
  }
  if (policy.kind === 'auto-on-init') {
    return { kind: policy.kind, shouldAutoconnect: true };
  }

  if (policy.profile == null) {
    return { kind: policy.kind, shouldAutoconnect: false };
  }
  if (policy.isReady && !policy.isReady(policy.profile)) {
    return { kind: policy.kind, shouldAutoconnect: false };
  }
  return {
    kind: policy.kind,
    shouldAutoconnect: true,
    profile: policy.profile,
  };
}

/**
 * Выполняет уже принятое решение автоподключения.
 *
 * Helper сам по себе не выбирает lifecycle-точку запуска.
 * Для runtime-адаптеров безопаснее вызывать его после общего `runtime.started`,
 * а не внутри `onInit()`, иначе ранние state/data события могут уйти
 * до регистрации подписчиков.
 */
export async function runAutoconnect<TProfile>(
  policyOrDecision: AdapterAutoconnectPolicy<TProfile> | AdapterAutoconnectDecision<TProfile>,
  handler: (decision: AdapterAutoconnectDecision<TProfile>) => Promise<void>,
): Promise<AdapterAutoconnectDecision<TProfile>> {
  const decision = 'shouldAutoconnect' in policyOrDecision
    ? policyOrDecision
    : resolveAutoconnectDecision(policyOrDecision);
  if (decision.shouldAutoconnect) {
    await handler(decision);
  }
  return decision;
}
