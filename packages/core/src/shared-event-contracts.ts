import { EventTypes } from './event-types.ts';
import { defineEventContract } from './event-contracts.ts';

/**
 * Shared runtime-события, доступные нескольким пакетам.
 *
 * Все текущие shared-контракты стартуют с версии `v=1`.
 */
export const SharedEventContracts = {
  signalBatch: defineEventContract({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    visibility: 'shared',
    description: 'Батч сигналов или меток в session time.',
  }),
  adapterScanRequest: defineEventContract({
    type: EventTypes.adapterScanRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  adapterScanStateChanged: defineEventContract({
    type: EventTypes.adapterScanStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  adapterScanCandidates: defineEventContract({
    type: EventTypes.adapterScanCandidates,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  adapterConnectRequest: defineEventContract({
    type: EventTypes.adapterConnectRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  adapterDisconnectRequest: defineEventContract({
    type: EventTypes.adapterDisconnectRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  adapterStateChanged: defineEventContract({
    type: EventTypes.adapterStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  simulationPauseRequest: defineEventContract({
    type: EventTypes.simulationPauseRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  simulationResumeRequest: defineEventContract({
    type: EventTypes.simulationResumeRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  simulationSpeedSetRequest: defineEventContract({
    type: EventTypes.simulationSpeedSetRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  simulationStateChanged: defineEventContract({
    type: EventTypes.simulationStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  recordingStart: defineEventContract({
    type: EventTypes.recordingStart,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  recordingStop: defineEventContract({
    type: EventTypes.recordingStop,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  recordingPause: defineEventContract({
    type: EventTypes.recordingPause,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  recordingResume: defineEventContract({
    type: EventTypes.recordingResume,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  recordingStateChanged: defineEventContract({
    type: EventTypes.recordingStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  recordingError: defineEventContract({
    type: EventTypes.recordingError,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  shapeGenerateRequest: defineEventContract({
    type: EventTypes.shapeGenerateRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  shapeGenerated: defineEventContract({
    type: EventTypes.shapeGenerated,
    v: 1,
    kind: 'fact',
    priority: 'control',
    visibility: 'shared',
  }),
  labelMarkRequest: defineEventContract({
    type: EventTypes.labelMarkRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  timelineResetRequest: defineEventContract({
    type: EventTypes.timelineResetRequest,
    v: 1,
    kind: 'command',
    priority: 'control',
    visibility: 'shared',
  }),
  commandRejected: defineEventContract({
    type: EventTypes.commandRejected,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  activityStateChanged: defineEventContract({
    type: EventTypes.activityStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  runtimeStarted: defineEventContract({
    type: EventTypes.runtimeStarted,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  runtimeTelemetrySnapshot: defineEventContract({
    type: EventTypes.runtimeTelemetrySnapshot,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  uiClientConnected: defineEventContract({
    type: EventTypes.uiClientConnected,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  uiClientDisconnected: defineEventContract({
    type: EventTypes.uiClientDisconnected,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  uiControlOut: defineEventContract({
    type: EventTypes.uiControlOut,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
  uiBinaryOut: defineEventContract({
    type: EventTypes.uiBinaryOut,
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'shared',
  }),
} as const;

export const sharedEventContracts = Object.values(SharedEventContracts);

export type SharedEventContract = (typeof sharedEventContracts)[number];
