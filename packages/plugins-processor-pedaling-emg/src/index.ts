export {
  createPedalingPhaseEngine,
  createEmgSegmentBuffer,
  type PedalingPhaseEngine,
  type PedalingPhaseEngineConfig,
  type CompletedCycle,
  type EmgSegmentBuffer,
  type EmgSegmentRequest,
  type PedalingLabelState,
} from './pedaling-emg.ts';
export { default as pedalingEmgProcessor } from './pedaling-emg-processor.ts';
