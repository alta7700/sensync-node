import { defineEventContract } from '@sensync2/core';
import { TrignoEventTypes } from './trigno-boundary.ts';

export const TrignoPluginEventContracts = {
  streamStartRequest: defineEventContract({
    type: TrignoEventTypes.streamStartRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
    description: 'Запрос на запуск live-стрима Trigno.',
  }),
  streamStopRequest: defineEventContract({
    type: TrignoEventTypes.streamStopRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
    description: 'Запрос на остановку live-стрима Trigno без закрытия TCP-сессии.',
  }),
  statusRefreshRequest: defineEventContract({
    type: TrignoEventTypes.statusRefreshRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
    description: 'Запрос на повторное чтение статуса Trigno по command socket.',
  }),
  statusReported: defineEventContract({
    type: TrignoEventTypes.statusReported,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
    description: 'Снимок текущего статуса Trigno после connect/refresh/start gate.',
  }),
  poll: defineEventContract({
    type: TrignoEventTypes.poll,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'plugin-private',
    description: 'Внутренний watchdog/poll тик адаптера Trigno.',
  }),
} as const;

export const trignoEventContracts = Object.values(TrignoPluginEventContracts);
