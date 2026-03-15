import type {
  AdapterScanCandidateDetailValue,
  AdapterStateChangedPayload,
  SignalBatchEvent,
} from '@sensync2/core';

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
