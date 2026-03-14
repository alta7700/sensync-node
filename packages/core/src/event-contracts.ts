import type { EventKind, EventPriority, EventType } from './events.ts';

export type EventVersion = number;
export type EventVisibility = 'shared' | 'plugin-private';

export interface EventRef<
  TType extends EventType = EventType,
  TVersion extends EventVersion = EventVersion,
> {
  type: TType;
  v: TVersion;
}

export interface EventContract<
  TType extends EventType = EventType,
  TVersion extends EventVersion = EventVersion,
  TKind extends EventKind = EventKind,
  TPriority extends EventPriority = EventPriority,
> extends EventRef<TType, TVersion> {
  kind: TKind;
  priority: TPriority;
  visibility: EventVisibility;
  description?: string;
  payloadDescription?: string;
}

export function defineEventContract<
  TType extends EventType,
  TVersion extends EventVersion,
  TKind extends EventKind,
  TPriority extends EventPriority,
>(
  contract: EventContract<TType, TVersion, TKind, TPriority>,
): EventContract<TType, TVersion, TKind, TPriority> {
  return contract;
}

export function eventContractKey(ref: EventRef): string {
  return `${ref.type}@${ref.v}`;
}

export function isSameEventRef(left: EventRef, right: EventRef): boolean {
  return left.type === right.type && left.v === right.v;
}
