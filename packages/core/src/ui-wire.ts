import type { EventSeq, SampleFormat, SignalBatchEvent } from './events.ts';

export const UI_WIRE_VERSION = 1;
export const UI_FRAME_TYPE_SIGNAL_BATCH = 1;
export const UI_SIGNAL_BATCH_HEADER_BYTES = 36;

const UiWireFlags = {
  None: 0,
  IrregularTimestamps: 1 << 0,
} as const;

export interface UiSignalFrameEncodeInput {
  streamNumericId: number;
  seq: EventSeq;
  t0Ms: number;
  dtMs: number;
  sampleFormat: SampleFormat;
  values: Float32Array | Float64Array | Int16Array;
  timestampsMs?: Float64Array;
}

export interface DecodedUiSignalFrame {
  version: number;
  frameType: number;
  streamNumericId: number;
  seq: bigint;
  t0Ms: number;
  dtMs: number;
  sampleFormat: SampleFormat;
  sampleCount: number;
  values: Float32Array | Float64Array | Int16Array;
  timestampsMs?: Float64Array;
}

export function sampleFormatToCode(format: SampleFormat): number {
  if (format === 'f32') return 1;
  if (format === 'f64') return 2;
  return 3;
}

export function codeToSampleFormat(code: number): SampleFormat {
  if (code === 1) return 'f32';
  if (code === 2) return 'f64';
  return 'i16';
}

function splitU64(value: bigint): { low: number; high: number } {
  return {
    low: Number(value & 0xffff_ffffn),
    high: Number((value >> 32n) & 0xffff_ffffn),
  };
}

function joinU64(low: number, high: number): bigint {
  return (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
}

function alignTo8(value: number): number {
  return (value + 7) & ~7;
}

function sampleFormatByteWidth(sampleFormat: SampleFormat): number {
  if (sampleFormat === 'f64') return 8;
  if (sampleFormat === 'f32') return 4;
  return 2;
}

/**
 * Кодирует бинарный UI-фрейм для signal batch (uniform или irregular timestamps).
 *
 * Для irregular timestamps блок `Float64Array` выравнивается по 8 байтам,
 * чтобы декодер мог читать его без копирования.
 */
export function encodeUiSignalBatchFrame(input: UiSignalFrameEncodeInput): ArrayBuffer {
  const valuesBytes = input.values.byteLength;
  const hasIrregularTimestamps = input.timestampsMs !== undefined;
  if (input.timestampsMs && input.timestampsMs.length !== input.values.length) {
    throw new Error('timestampsMs.length должен совпадать с values.length');
  }

  const timestampsBytes = input.timestampsMs?.byteLength ?? 0;
  const timestampsOffset = hasIrregularTimestamps ? alignTo8(UI_SIGNAL_BATCH_HEADER_BYTES + valuesBytes) : 0;
  const totalBytes = hasIrregularTimestamps ? timestampsOffset + timestampsBytes : UI_SIGNAL_BATCH_HEADER_BYTES + valuesBytes;

  const buffer = new ArrayBuffer(totalBytes);
  const dv = new DataView(buffer);
  const { low, high } = splitU64(input.seq);

  dv.setUint8(0, UI_WIRE_VERSION);
  dv.setUint8(1, UI_FRAME_TYPE_SIGNAL_BATCH);
  dv.setUint16(2, UI_SIGNAL_BATCH_HEADER_BYTES, true);
  dv.setUint32(4, input.streamNumericId >>> 0, true);
  dv.setUint32(8, low >>> 0, true);
  dv.setUint32(12, high >>> 0, true);
  dv.setFloat64(16, input.t0Ms, true);
  dv.setFloat32(24, input.dtMs, true);
  dv.setUint32(28, input.values.length >>> 0, true);
  dv.setUint8(32, sampleFormatToCode(input.sampleFormat));
  dv.setUint8(33, hasIrregularTimestamps ? UiWireFlags.IrregularTimestamps : UiWireFlags.None);
  dv.setUint16(34, 0, true);

  new Uint8Array(buffer, UI_SIGNAL_BATCH_HEADER_BYTES).set(
    new Uint8Array(input.values.buffer, input.values.byteOffset, input.values.byteLength),
  );

  if (input.timestampsMs) {
    new Uint8Array(buffer, timestampsOffset, input.timestampsMs.byteLength).set(
      new Uint8Array(input.timestampsMs.buffer, input.timestampsMs.byteOffset, input.timestampsMs.byteLength),
    );
  }

  return buffer;
}

/**
 * Декодирует бинарный UI-фрейм в браузере/рантайме.
 *
 * Возвращаемые typed arrays указывают на исходный `buffer`.
 */
export function decodeUiSignalBatchFrame(buffer: ArrayBuffer): DecodedUiSignalFrame {
  const dv = new DataView(buffer);
  const version = dv.getUint8(0);
  const frameType = dv.getUint8(1);
  const headerBytes = dv.getUint16(2, true);
  const streamNumericId = dv.getUint32(4, true);
  const seqLow = dv.getUint32(8, true);
  const seqHigh = dv.getUint32(12, true);
  const t0Ms = dv.getFloat64(16, true);
  const dtMs = dv.getFloat32(24, true);
  const sampleCount = dv.getUint32(28, true);
  const sampleFormat = codeToSampleFormat(dv.getUint8(32));
  const flags = dv.getUint8(33);

  if (version !== UI_WIRE_VERSION) {
    throw new Error(`Неподдерживаемая версия UI wire: ${version}`);
  }
  if (frameType !== UI_FRAME_TYPE_SIGNAL_BATCH) {
    throw new Error(`Неподдерживаемый тип UI frame: ${frameType}`);
  }
  let values: Float32Array | Float64Array | Int16Array;
  if (sampleFormat === 'f32') {
    values = new Float32Array(buffer, headerBytes, sampleCount);
  } else if (sampleFormat === 'f64') {
    values = new Float64Array(buffer, headerBytes, sampleCount);
  } else {
    values = new Int16Array(buffer, headerBytes, sampleCount);
  }

  const decoded: DecodedUiSignalFrame = {
    version,
    frameType,
    streamNumericId,
    seq: joinU64(seqLow, seqHigh),
    t0Ms,
    dtMs,
    sampleFormat,
    sampleCount,
    values,
  };

  if (flags & UiWireFlags.IrregularTimestamps) {
    const valuesBytes = sampleCount * sampleFormatByteWidth(sampleFormat);
    const timestampsOffset = alignTo8(headerBytes + valuesBytes);
    const timestampsBytes = sampleCount * Float64Array.BYTES_PER_ELEMENT;
    if (buffer.byteLength < timestampsOffset + timestampsBytes) {
      throw new Error('Некорректный UI frame: timestampsMs выходят за пределы буфера');
    }
    decoded.timestampsMs = new Float64Array(buffer, timestampsOffset, sampleCount);
  }

  return decoded;
}

/** Удобный helper для `UiGatewayPlugin`. */
export function encodeUiSignalBatchFrameFromEvent(event: SignalBatchEvent, streamNumericId: number): ArrayBuffer {
  const timestampsMs = event.payload.timestampsMs;
  const hasIrregularTimestamps = timestampsMs !== undefined && timestampsMs.length > 0;
  const t0Ms = hasIrregularTimestamps ? timestampsMs[0]! : event.payload.t0Ms;
  return encodeUiSignalBatchFrame({
    streamNumericId,
    seq: event.seq,
    t0Ms,
    // Для irregular потоков `dtMs` не является источником истины.
    dtMs: hasIrregularTimestamps ? 0 : (event.payload.dtMs ?? 0),
    sampleFormat: event.payload.sampleFormat,
    values: event.payload.values,
    ...(hasIrregularTimestamps ? { timestampsMs } : {}),
  });
}
