import { defineEventContract } from '@sensync2/core';

export const AntPlusPluginEventContracts = {
  packetPoll: defineEventContract({
    type: 'ant-plus.packet.poll',
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'plugin-private',
    description: 'Внутренний тик чтения пакетов ANT+ адаптера.',
  }),
} as const;

export const antPlusEventContracts = Object.values(AntPlusPluginEventContracts);
