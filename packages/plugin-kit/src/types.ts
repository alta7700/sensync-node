import type {
  AdapterScanCandidateDetailValue,
  EventRef,
  EventSubscription,
  FrameKind,
  PluginManifest,
  RuntimeEvent,
  RuntimeEventInput,
  RuntimeEventOf,
  AdapterStateChangedPayload,
  SampleFormat,
  SignalBatchEvent,
  SignalBatchPayload,
  SignalValues,
} from '@sensync2/core';
import type {
  PluginContext,
  TimelineResetAbortContext,
  TimelineResetCommitContext,
  TimelineResetPrepareContext,
} from '@sensync2/plugin-sdk';

export type AdapterRuntimeState = AdapterStateChangedPayload['state'];

export interface OutputDescriptor {
  streamId: string;
  units?: string;
}

export type OutputDescriptorInput = string | OutputDescriptor;

export type OutputRegistryDefinition<TOutputKey extends string = string> = Record<TOutputKey, OutputDescriptorInput>;

export interface OutputRegistry<TOutputKey extends string = string> {
  has(outputKey: TOutputKey): boolean;
  get(outputKey: TOutputKey): OutputDescriptor;
  entries(): Array<[TOutputKey, OutputDescriptor]>;
}

export type UniformSignalValues = SignalBatchEvent['payload']['values'];
export type LabelSignalValues = UniformSignalValues;

export interface UniformSignalTiming {
  t0Ms: number;
  dtMs: number;
  sampleRateHz?: number;
}

export interface IrregularSignalTiming {
  timestampsMs: Float64Array;
  t0Ms?: number;
  sampleRateHz?: number;
}

export interface LabelSignalTiming {
  timestampsMs: Float64Array;
}

export type AdapterAutoconnectPolicy<TProfile = unknown> =
  | { kind: 'manual' }
  | { kind: 'auto-on-init' }
  | {
    kind: 'auto-from-persisted-profile';
    profile: TProfile | null | undefined;
    isReady?: (profile: TProfile) => boolean;
  };

export interface AdapterAutoconnectDecision<TProfile = unknown> {
  kind: AdapterAutoconnectPolicy<TProfile>['kind'];
  shouldAutoconnect: boolean;
  profile?: TProfile;
}

export interface ScanFlowCandidateInput<TCandidateData> {
  title: string;
  subtitle?: string;
  details?: Record<string, AdapterScanCandidateDetailValue>;
  data: TCandidateData;
}

export interface ScanFlowResolvedCandidate {
  candidateId: string;
  title: string;
  subtitle?: string;
  details?: Record<string, AdapterScanCandidateDetailValue>;
}

export interface ReconnectPolicyOptions {
  initialDelayMs: number;
  multiplier?: number;
  maxDelayMs?: number;
  shouldRetry?: (attempt: number) => boolean;
}

export interface SignalInputDescriptor {
  kind: 'signal';
  streamId: string;
  retain: { by: 'samples' | 'durationMs'; value: number };
}

export interface FactInputDescriptor {
  kind: 'fact';
  event: { type: string; v: number };
  retain: 'latest';
}

export type InputDescriptor = SignalInputDescriptor | FactInputDescriptor;
export type InputDescriptorInput = InputDescriptor;
export type InputMapDefinition<TInputKey extends string = string> = Record<TInputKey, InputDescriptorInput>;

export interface InputMap<TInputKey extends string = string> {
  has(inputKey: TInputKey): boolean;
  get(inputKey: TInputKey): InputDescriptor;
  entries(): Array<[TInputKey, InputDescriptor]>;
  signalEntries(): Array<[TInputKey, SignalInputDescriptor]>;
  factEntries(): Array<[TInputKey, FactInputDescriptor]>;
}

export interface ManifestFragment {
  subscriptions: EventSubscription[];
  emits: EventRef[];
}

export interface SignalWindowSlice {
  streamId: string;
  frameKind: FrameKind;
  sampleFormat: SampleFormat;
  sampleCount: number;
  values: SignalValues;
  t0Ms: number;
  t1Ms: number;
  timestampsMs?: Float64Array;
  units?: string;
}

export interface SignalWindowStore {
  descriptor(): SignalInputDescriptor;
  push(event: RuntimeEventOf<'signal.batch', 1>): boolean;
  clear(): void;
  sampleCount(): number;
  latestBatch(): RuntimeEventOf<'signal.batch', 1> | null;
  latestSamples(count: number): SignalWindowSlice | null;
  windowMs(durationMs: number): SignalWindowSlice | null;
}

export interface FactStore<TEvent extends RuntimeEvent = RuntimeEvent> {
  descriptor(): FactInputDescriptor;
  push(event: TEvent): boolean;
  clear(): void;
  latest(): TEvent | null;
  latestPayload(): TEvent extends { payload: infer TPayload } ? TPayload | null : null;
}

export interface StateCell<TValue> {
  current(): TValue | null;
  previous(): TValue | null;
  set(nextValue: TValue): {
    changed: boolean;
    previous: TValue | null;
    current: TValue;
  };
  clear(): void;
}

export type StateExpression<TStateKey extends string> =
  | { state: TStateKey; eq: unknown }
  | { and: StateExpression<TStateKey>[] }
  | { or: StateExpression<TStateKey>[] }
  | { not: StateExpression<TStateKey> };

export type CompiledStateExpression<TStateKey extends string> =
  (reader: (stateKey: TStateKey) => unknown) => boolean;

export interface InputRuntime<TInputKey extends string = string> {
  definition(): InputMap<TInputKey>;
  signal(inputKey: TInputKey): SignalWindowStore;
  fact(inputKey: TInputKey): FactStore;
  route(event: RuntimeEvent): TInputKey[];
  clear(): void;
}

export interface HandlerApi<
  TInputKey extends string = string,
  TStateKey extends string = string,
> {
  inputs: InputRuntime<TInputKey>;
  states: Record<TStateKey, StateCell<unknown>>;
}

export interface PluginHandler<
  TInputKey extends string = string,
  TStateKey extends string = string,
> {
  manifest(): ManifestFragment;
  start(ctx: PluginContext, api: HandlerApi<TInputKey, TStateKey>): Promise<void> | void;
  stop(ctx: PluginContext, api: HandlerApi<TInputKey, TStateKey>): Promise<void> | void;
  handleEvent(
    event: RuntimeEvent,
    ctx: PluginContext,
    api: HandlerApi<TInputKey, TStateKey>,
  ): Promise<void> | void;
}

export interface HandlerGroup<
  TInputKey extends string = string,
  TStateKey extends string = string,
> {
  manifest(): ManifestFragment;
  start(ctx: PluginContext): Promise<void>;
  stop(ctx: PluginContext): Promise<void>;
  dispatch(event: RuntimeEvent, ctx: PluginContext): Promise<void>;
  add(
    handler: PluginHandler<TInputKey, TStateKey>,
    ctx?: PluginContext,
  ): () => Promise<void>;
}

export interface MutablePluginManifest extends PluginManifest {
  subscriptions: EventSubscription[];
  emits?: EventRef[];
}

export interface TimelineResettableResource {
  prepare?(): Promise<void> | void;
  abort?(): Promise<void> | void;
  commit?(): Promise<void> | void;
}

export interface TimelineResetParticipantController {
  initialize(timelineId: string): void;
  currentTimelineId(): string;
  phase(): 'running' | 'preparing' | 'committing';
  bindEmit(ctx: PluginContext): <TEvent extends RuntimeEventInput>(event: TEvent) => Promise<void>;
  onPrepare(input: TimelineResetPrepareContext, ctx: PluginContext): Promise<void>;
  onAbort(input: TimelineResetAbortContext, ctx: PluginContext): Promise<void>;
  onCommit(input: TimelineResetCommitContext, ctx: PluginContext): Promise<void>;
}

export interface TimelineResetParticipantOptions {
  resources?: TimelineResettableResource[];
  onPrepare?: (input: TimelineResetPrepareContext, ctx: PluginContext) => Promise<void> | void;
  onAbort?: (input: TimelineResetAbortContext, ctx: PluginContext) => Promise<void> | void;
  onCommit?: (input: TimelineResetCommitContext, ctx: PluginContext) => Promise<void> | void;
}

export type TimelineClipResult =
  | { kind: 'drop' }
  | { kind: 'keep'; payload: SignalBatchPayload };
