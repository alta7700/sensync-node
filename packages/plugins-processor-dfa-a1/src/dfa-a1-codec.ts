import {
  NumericArray,
  SampleFormat,
} from './generated/sensync2_plugin_kit/ipc_worker/numeric_array.ts';
import {
  DfaA1FromRrRequest,
  DfaA1FromRrResponse,
} from './generated/sensync2_processors/dfa_a1/dfa_a1.ts';

export function encodeDfaA1Request(
  rrIntervalsMs: Float64Array,
  lowerScale: number,
  upperScale: number,
): Uint8Array {
  return DfaA1FromRrRequest.encode({
    rrIntervalsMs: NumericArray.create({
      sampleFormat: SampleFormat.SAMPLE_FORMAT_F64,
      length: rrIntervalsMs.length,
      data: Uint8Array.from(new Uint8Array(
        rrIntervalsMs.buffer,
        rrIntervalsMs.byteOffset,
        rrIntervalsMs.byteLength,
      )),
    }),
    lowerScale,
    upperScale,
  }).finish();
}

export function decodeDfaA1Response(payload: Uint8Array): number {
  return DfaA1FromRrResponse.decode(payload).alpha1;
}
