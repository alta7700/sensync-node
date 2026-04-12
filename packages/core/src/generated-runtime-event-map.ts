// Этот файл сгенерирован `npm run generate:runtime-event-map`.
// Не редактируй его вручную: править нужно *.spec.ts и генератор.

import type { AdapterConnectRequestPayload, AdapterDisconnectRequestPayload, AdapterScanCandidatesPayload, AdapterScanRequestPayload, AdapterScanStateChangedPayload, AdapterStateChangedPayload, CommandEvent, CommandRejectedPayload, FactEvent, LabelMarkRequestPayload, RecordingErrorPayload, RecordingPausePayload, RecordingResumePayload, RecordingStartPayload, RecordingStateChangedPayload, RecordingStopPayload, RuntimeStartedPayload, ShapeGeneratedPayload, ShapeGenerateRequestPayload, SignalBatchEvent, SimulationPauseRequestPayload, SimulationResumeRequestPayload, SimulationSpeedSetRequestPayload, SimulationStateChangedPayload, TimelineResetRequestPayload, ViewerStateChangedPayload } from './events.ts';
import type { RuntimeTelemetrySnapshotPayload, UiBinaryOutPayload, UiClientConnectedPayload, UiClientDisconnectedPayload, UiControlOutPayload } from './ui.ts';

export type SignalBatchRuntimeEvent = SignalBatchEvent;

export type AdapterScanRequestEvent = CommandEvent<AdapterScanRequestPayload, 'adapter.scan.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type AdapterScanStateChangedEvent = FactEvent<AdapterScanStateChangedPayload, 'adapter.scan.state.changed'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type AdapterScanCandidatesEvent = FactEvent<AdapterScanCandidatesPayload, 'adapter.scan.candidates'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type AdapterConnectRequestEvent = CommandEvent<AdapterConnectRequestPayload, 'adapter.connect.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type AdapterDisconnectRequestEvent = CommandEvent<AdapterDisconnectRequestPayload, 'adapter.disconnect.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type AdapterStateChangedEvent = FactEvent<AdapterStateChangedPayload, 'adapter.state.changed'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type SimulationPauseRequestEvent = CommandEvent<SimulationPauseRequestPayload, 'simulation.pause.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type SimulationResumeRequestEvent = CommandEvent<SimulationResumeRequestPayload, 'simulation.resume.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type SimulationSpeedSetRequestEvent = CommandEvent<SimulationSpeedSetRequestPayload, 'simulation.speed.set.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type SimulationStateChangedEvent = FactEvent<SimulationStateChangedPayload, 'simulation.state.changed'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type ViewerStateChangedEvent = FactEvent<ViewerStateChangedPayload, 'viewer.state.changed'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type RecordingStartEvent = CommandEvent<RecordingStartPayload, 'recording.start'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type RecordingStopEvent = CommandEvent<RecordingStopPayload, 'recording.stop'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type RecordingPauseEvent = CommandEvent<RecordingPausePayload, 'recording.pause'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type RecordingResumeEvent = CommandEvent<RecordingResumePayload, 'recording.resume'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type RecordingStateChangedEvent = FactEvent<RecordingStateChangedPayload, 'recording.state.changed'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type RecordingErrorEvent = FactEvent<RecordingErrorPayload, 'recording.error'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type ShapeGenerateRequestEvent = CommandEvent<ShapeGenerateRequestPayload, 'shape.generate.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type ShapeGeneratedEvent = FactEvent<ShapeGeneratedPayload, 'shape.generated'> & {
  v: 1;
  kind: 'fact';
  priority: 'control';
};

export type LabelMarkRequestEvent = CommandEvent<LabelMarkRequestPayload, 'label.mark.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type TimelineResetRequestEvent = CommandEvent<TimelineResetRequestPayload, 'timeline.reset.request'> & {
  v: 1;
  kind: 'command';
  priority: 'control';
};

export type CommandRejectedEvent = FactEvent<CommandRejectedPayload, 'command.rejected'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type ActivityStateChangedEvent = FactEvent<{ active: boolean }, 'activity.state.changed'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type RuntimeStartedEvent = FactEvent<RuntimeStartedPayload, 'runtime.started'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type RuntimeTelemetrySnapshotEvent = FactEvent<RuntimeTelemetrySnapshotPayload, 'runtime.telemetry.snapshot'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type UiClientConnectedEvent = FactEvent<UiClientConnectedPayload, 'ui.client.connected'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type UiClientDisconnectedEvent = FactEvent<UiClientDisconnectedPayload, 'ui.client.disconnected'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type UiControlOutEvent = FactEvent<UiControlOutPayload, 'ui.control.out'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

export type UiBinaryOutEvent = FactEvent<UiBinaryOutPayload, 'ui.binary.out'> & {
  v: 1;
  kind: 'fact';
  priority: 'system';
};

declare module './events.ts' {
  interface RuntimeEventMap {
    'signal.batch@1': SignalBatchRuntimeEvent;
    'adapter.scan.request@1': AdapterScanRequestEvent;
    'adapter.scan.state.changed@1': AdapterScanStateChangedEvent;
    'adapter.scan.candidates@1': AdapterScanCandidatesEvent;
    'adapter.connect.request@1': AdapterConnectRequestEvent;
    'adapter.disconnect.request@1': AdapterDisconnectRequestEvent;
    'adapter.state.changed@1': AdapterStateChangedEvent;
    'simulation.pause.request@1': SimulationPauseRequestEvent;
    'simulation.resume.request@1': SimulationResumeRequestEvent;
    'simulation.speed.set.request@1': SimulationSpeedSetRequestEvent;
    'simulation.state.changed@1': SimulationStateChangedEvent;
    'viewer.state.changed@1': ViewerStateChangedEvent;
    'recording.start@1': RecordingStartEvent;
    'recording.stop@1': RecordingStopEvent;
    'recording.pause@1': RecordingPauseEvent;
    'recording.resume@1': RecordingResumeEvent;
    'recording.state.changed@1': RecordingStateChangedEvent;
    'recording.error@1': RecordingErrorEvent;
    'shape.generate.request@1': ShapeGenerateRequestEvent;
    'shape.generated@1': ShapeGeneratedEvent;
    'label.mark.request@1': LabelMarkRequestEvent;
    'timeline.reset.request@1': TimelineResetRequestEvent;
    'command.rejected@1': CommandRejectedEvent;
    'activity.state.changed@1': ActivityStateChangedEvent;
    'runtime.started@1': RuntimeStartedEvent;
    'runtime.telemetry.snapshot@1': RuntimeTelemetrySnapshotEvent;
    'ui.client.connected@1': UiClientConnectedEvent;
    'ui.client.disconnected@1': UiClientDisconnectedEvent;
    'ui.control.out@1': UiControlOutEvent;
    'ui.binary.out@1': UiBinaryOutEvent;
  }
}

export {};
