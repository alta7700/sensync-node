import { defineEventContract } from '@sensync2/core';

export const BlePluginEventContracts = {
  zephyrPoll: defineEventContract({
    type: 'zephyr-bioharness.poll',
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'plugin-private',
    description: 'Внутренний тик BLE-адаптера Zephyr BioHarness для polling и reconnect watchdog.',
  }),
} as const;

export const bleEventContracts = Object.values(BlePluginEventContracts);
