import {
  eventContractKey,
  sharedEventContracts,
  type EventContract,
  type EventRef,
  type EventSubscription,
  type PluginManifest,
} from '@sensync2/core';
import { antPlusEventContracts } from '@sensync2/plugins-ant-plus';
import { bleEventContracts } from '@sensync2/plugins-ble';
import { fakeEventContracts } from '@sensync2/plugins-fake';
import { hdf5EventContracts } from '@sensync2/plugins-hdf5';

const workspaceEventContracts = [
  ...sharedEventContracts,
  ...fakeEventContracts,
  ...hdf5EventContracts,
  ...antPlusEventContracts,
  ...bleEventContracts,
] as const;

export type WorkspaceEventContract = (typeof workspaceEventContracts)[number];

interface ValidationFailure {
  code: string;
  message: string;
}

function describeRef(ref: EventRef): string {
  return `${ref.type}@v${ref.v}`;
}

function validateSubscription(contract: EventContract, subscription: EventSubscription, pluginId: string): ValidationFailure | null {
  if (subscription.kind !== undefined && subscription.kind !== contract.kind) {
    return {
      code: 'subscription_kind_mismatch',
      message: `Подписка ${pluginId} на ${describeRef(subscription)} имеет kind=${subscription.kind}, ожидается ${contract.kind}`,
    };
  }
  if (subscription.priority !== undefined && subscription.priority !== contract.priority) {
    return {
      code: 'subscription_priority_mismatch',
      message: `Подписка ${pluginId} на ${describeRef(subscription)} имеет priority=${subscription.priority}, ожидается ${contract.priority}`,
    };
  }
  return null;
}

export class WorkspaceEventRegistry {
  private readonly byKey = new Map<string, EventContract>();

  constructor(contracts: readonly EventContract[] = workspaceEventContracts) {
    for (const contract of contracts) {
      const key = eventContractKey(contract);
      const existing = this.byKey.get(key);
      if (existing) {
        throw new Error(`Повторная регистрация контракта ${describeRef(contract)}`);
      }
      this.byKey.set(key, contract);
    }
  }

  get(ref: EventRef): EventContract | undefined {
    return this.byKey.get(eventContractKey(ref));
  }

  require(ref: EventRef): EventContract {
    const contract = this.get(ref);
    if (!contract) {
      throw new Error(`Неизвестный контракт события ${describeRef(ref)}`);
    }
    return contract;
  }

  has(ref: EventRef): boolean {
    return this.byKey.has(eventContractKey(ref));
  }

  validateManifest(manifest: PluginManifest): void {
    for (const subscription of manifest.subscriptions) {
      const contract = this.require(subscription);
      const mismatch = validateSubscription(contract, subscription, manifest.id);
      if (mismatch) {
        throw new Error(mismatch.message);
      }
    }

    for (const emitted of manifest.emits ?? []) {
      this.require(emitted);
    }
  }
}

export function isEventAllowedForPlugin(manifest: PluginManifest, event: EventRef): boolean {
  return (manifest.emits ?? []).some((candidate) => candidate.type === event.type && candidate.v === event.v);
}

export function describeEventRef(ref: EventRef): string {
  return describeRef(ref);
}
