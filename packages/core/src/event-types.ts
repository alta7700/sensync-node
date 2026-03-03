/**
 * Единый словарь event types для `v1`.
 *
 * Здесь только те события, которые реально используются в runtime и fake-плагинах.
 */
export const EventTypes = {
  adapterConnectRequest: 'adapter.connect.request',
  adapterDisconnectRequest: 'adapter.disconnect.request',
  adapterStateChanged: 'adapter.state.changed',

  shapeGenerateRequest: 'shape.generate.request',
  shapeGenerated: 'shape.generated',

  intervalStart: 'interval.start',
  intervalStop: 'interval.stop',
  intervalStateChanged: 'interval.state.changed',

  activityStateChanged: 'activity.state.changed',

  runtimeTelemetrySnapshot: 'runtime.telemetry.snapshot',

  uiClientConnected: 'ui.client.connected',
  uiClientDisconnected: 'ui.client.disconnected',
  uiControlOut: 'ui.control.out',
  uiBinaryOut: 'ui.binary.out',
} as const;

export type KnownEventType = (typeof EventTypes)[keyof typeof EventTypes];
