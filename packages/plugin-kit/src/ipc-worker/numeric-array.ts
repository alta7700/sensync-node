import {
  NumericArray,
  SampleFormat,
  type NumericArray as NumericArrayMessage,
} from './generated/sensync2_plugin_kit/ipc_worker/numeric_array.ts';
import type { IpcSampleFormat, IpcTypedArray } from './types.ts';

function copyTypedArrayBytes(values: IpcTypedArray): Uint8Array {
  return Uint8Array.from(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

export function sampleFormatFromTypedArray(values: IpcTypedArray): IpcSampleFormat {
  if (values instanceof Float32Array) {
    return 'f32';
  }
  if (values instanceof Float64Array) {
    return 'f64';
  }
  if (values instanceof Int16Array) {
    return 'i16';
  }
  throw new Error('Неподдерживаемый typed array для IPC numeric payload');
}

export function sampleFormatToProto(format: IpcSampleFormat): SampleFormat {
  switch (format) {
    case 'f32':
      return SampleFormat.SAMPLE_FORMAT_F32;
    case 'f64':
      return SampleFormat.SAMPLE_FORMAT_F64;
    case 'i16':
      return SampleFormat.SAMPLE_FORMAT_I16;
  }
}

export function protoSampleFormatToLocal(format: SampleFormat): IpcSampleFormat {
  switch (format) {
    case SampleFormat.SAMPLE_FORMAT_F32:
      return 'f32';
    case SampleFormat.SAMPLE_FORMAT_F64:
      return 'f64';
    case SampleFormat.SAMPLE_FORMAT_I16:
      return 'i16';
    default:
      throw new Error(`Неподдерживаемый sampleFormat в IPC payload: ${String(format)}`);
  }
}

export function createNumericArrayMessage(values: IpcTypedArray): NumericArrayMessage {
  return NumericArray.create({
    sampleFormat: sampleFormatToProto(sampleFormatFromTypedArray(values)),
    length: values.length,
    data: copyTypedArrayBytes(values),
  });
}

export function encodeNumericArray(values: IpcTypedArray): Uint8Array {
  return NumericArray.encode(createNumericArrayMessage(values)).finish();
}

export function decodeNumericArray(input: Uint8Array): IpcTypedArray {
  return numericArrayMessageToTypedArray(NumericArray.decode(input));
}

export function numericArrayMessageToTypedArray(message: NumericArrayMessage): IpcTypedArray {
  const format = protoSampleFormatToLocal(message.sampleFormat);
  const data = Uint8Array.from(message.data);
  switch (format) {
    case 'f32': {
      if (data.byteLength !== (message.length * Float32Array.BYTES_PER_ELEMENT)) {
        throw new Error('Размер payload не совпадает с длиной Float32Array');
      }
      return new Float32Array(data.buffer, 0, message.length);
    }
    case 'f64': {
      if (data.byteLength !== (message.length * Float64Array.BYTES_PER_ELEMENT)) {
        throw new Error('Размер payload не совпадает с длиной Float64Array');
      }
      return new Float64Array(data.buffer, 0, message.length);
    }
    case 'i16': {
      if (data.byteLength !== (message.length * Int16Array.BYTES_PER_ELEMENT)) {
        throw new Error('Размер payload не совпадает с длиной Int16Array');
      }
      return new Int16Array(data.buffer, 0, message.length);
    }
  }
}
