/**
 * Единый словарь event types для `v1`.
 *
 * Здесь только те события, которые реально используются в runtime и fake-плагинах.
 */
export const EventTypes = {
  signalBatch: 'signal.batch',
  adapterScanRequest: 'adapter.scan.request',
  adapterScanStateChanged: 'adapter.scan.state.changed',
  adapterScanCandidates: 'adapter.scan.candidates',
  adapterConnectRequest: 'adapter.connect.request',
  adapterDisconnectRequest: 'adapter.disconnect.request',
  adapterStateChanged: 'adapter.state.changed',
  simulationPauseRequest: 'simulation.pause.request',
  simulationResumeRequest: 'simulation.resume.request',
  simulationSpeedSetRequest: 'simulation.speed.set.request',
  simulationStateChanged: 'simulation.state.changed',
  viewerStateChanged: 'viewer.state.changed',

  recordingStart: 'recording.start',
  recordingStop: 'recording.stop',
  recordingPause: 'recording.pause',
  recordingResume: 'recording.resume',
  recordingStateChanged: 'recording.state.changed',
  recordingError: 'recording.error',

  shapeGenerateRequest: 'shape.generate.request',
  shapeGenerated: 'shape.generated',

  labelMarkRequest: 'label.mark.request',
  timelineResetRequest: 'timeline.reset.request',
  commandRejected: 'command.rejected',

  activityStateChanged: 'activity.state.changed',

  runtimeStarted: 'runtime.started',
  runtimeTelemetrySnapshot: 'runtime.telemetry.snapshot',

  uiClientConnected: 'ui.client.connected',
  uiClientDisconnected: 'ui.client.disconnected',
  uiControlOut: 'ui.control.out',
  uiBinaryOut: 'ui.binary.out',
} as const;

export type KnownEventType = (typeof EventTypes)[keyof typeof EventTypes];
