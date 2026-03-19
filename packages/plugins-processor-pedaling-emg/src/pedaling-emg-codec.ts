import {
  NumericArray,
  SampleFormat,
} from './generated/sensync2_plugin_kit/ipc_worker/numeric_array.ts';
import {
  PedalingEmgAnalysisRequest,
  PedalingEmgAnalysisResponse,
  PedalingEmgStatus,
} from './generated/pedaling_emg.ts';

export interface EncodedPedalingEmgRequestInput {
  cycleId: number;
  windowStartSessionMs: number;
  sampleRateHz: number;
  values: Float32Array;
  expectedActiveStartOffsetMs: number;
  expectedActiveEndOffsetMs: number;
  previousBaseline?: number;
  previousThresholdHigh?: number;
  previousThresholdLow?: number;
}

export interface DecodedPedalingEmgResponse {
  detectedOnsetOffsetMs: number | null;
  detectedOffsetOffsetMs: number | null;
  confidence: number;
  baseline: number;
  thresholdHigh: number;
  thresholdLow: number;
  status: 'ok' | 'low_snr' | 'no_activation' | 'invalid_window';
}

function decodeStatus(status: PedalingEmgStatus): DecodedPedalingEmgResponse['status'] {
  if (status === PedalingEmgStatus.PEDALING_EMG_STATUS_OK) {
    return 'ok';
  }
  if (status === PedalingEmgStatus.PEDALING_EMG_STATUS_LOW_SNR) {
    return 'low_snr';
  }
  if (status === PedalingEmgStatus.PEDALING_EMG_STATUS_NO_ACTIVATION) {
    return 'no_activation';
  }
  return 'invalid_window';
}

export function encodePedalingEmgRequest(input: EncodedPedalingEmgRequestInput): Uint8Array {
  return PedalingEmgAnalysisRequest.encode({
    cycleId: input.cycleId,
    windowStartSessionMs: input.windowStartSessionMs,
    sampleRateHz: input.sampleRateHz,
    emgSamples: NumericArray.create({
      sampleFormat: SampleFormat.SAMPLE_FORMAT_F32,
      length: input.values.length,
      data: Uint8Array.from(new Uint8Array(
        input.values.buffer,
        input.values.byteOffset,
        input.values.byteLength,
      )),
    }),
    expectedActiveStartOffsetMs: input.expectedActiveStartOffsetMs,
    expectedActiveEndOffsetMs: input.expectedActiveEndOffsetMs,
    ...(input.previousBaseline !== undefined ? { previousBaseline: input.previousBaseline } : {}),
    ...(input.previousThresholdHigh !== undefined ? { previousThresholdHigh: input.previousThresholdHigh } : {}),
    ...(input.previousThresholdLow !== undefined ? { previousThresholdLow: input.previousThresholdLow } : {}),
  }).finish();
}

export function decodePedalingEmgResponse(payload: Uint8Array): DecodedPedalingEmgResponse {
  const response = PedalingEmgAnalysisResponse.decode(payload);
  return {
    detectedOnsetOffsetMs: response.detectedOnsetOffsetMs ?? null,
    detectedOffsetOffsetMs: response.detectedOffsetOffsetMs ?? null,
    confidence: response.confidence,
    baseline: response.baseline,
    thresholdHigh: response.thresholdHigh,
    thresholdLow: response.thresholdLow,
    status: decodeStatus(response.status),
  };
}
