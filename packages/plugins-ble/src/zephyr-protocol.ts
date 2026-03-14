const PacketStartByte = 0x02;
const PacketEndByte = 0x03;
const PacketAckByte = 0x06;
const PacketNakByte = 0x15;
const RtoRTransmissionStateMessageId = 0x19;
const RtoRDataMessageId = 0x24;

// В старом рабочем драйвере `sensync` подключение шло по characteristic UUID,
// а advertisement при этом показывал service `...20`. Держим оба UUID как подсказки.
export const ZephyrBioHarnessAdvertisedServiceUuid = 'BEFDFF20-C979-11E1-9B21-0800200C9A66';
export const ZephyrBioHarnessLegacyServiceUuid = 'BEFDFF60-C979-11E1-9B21-0800200C9A66';
export const ZephyrBioHarnessServiceUuids = [
  ZephyrBioHarnessAdvertisedServiceUuid,
  ZephyrBioHarnessLegacyServiceUuid,
] as const;
export const ZephyrBioHarnessTxUuid = 'BEFDFF68-C979-11E1-9B21-0800200C9A66';
export const ZephyrBioHarnessRxUuid = 'BEFDFF69-C979-11E1-9B21-0800200C9A66';

export interface ZephyrRtoRTransmissionStateResponse {
  kind: 'r-to-r-transmission-state-response';
  success: boolean;
  rawData: Buffer;
}

export interface ZephyrRtoRDataPacket {
  kind: 'r-to-r-data';
  seqNumber: number;
  year: number;
  month: number;
  day: number;
  dayMs: number;
  rr: number[];
  rawData: Buffer;
}

export type ZephyrParsedPacket = ZephyrRtoRTransmissionStateResponse | ZephyrRtoRDataPacket;

export function normalizeZephyrUuid(uuid: string): string {
  return uuid.replaceAll('-', '').toLowerCase();
}

export function isZephyrBioHarnessDeviceName(localName: string | undefined | null): boolean {
  return typeof localName === 'string' && localName.includes('BH BHT');
}

export function buildRToRTransmissionStateCommand(enable: boolean): Buffer {
  return buildZephyrCommand(RtoRTransmissionStateMessageId, Buffer.from([enable ? 1 : 0]));
}

export function buildFakeRtoRDataPacket(
  seqNumber: number,
  rrValues: number[],
  date: Date = new Date('2026-01-01T10:00:00.000Z'),
): Buffer {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const dayMs = (
    (date.getUTCHours() * 3_600_000)
    + (date.getUTCMinutes() * 60_000)
    + (date.getUTCSeconds() * 1_000)
    + date.getUTCMilliseconds()
  );
  const lapNumber = Math.floor(dayMs / 65_535);
  const lapTs = dayMs % 65_535;
  const payload = Buffer.alloc(9 + (rrValues.length * 2));
  payload[0] = seqNumber & 0xff;
  payload.writeUInt16LE(year, 1);
  payload[3] = month & 0xff;
  payload[4] = day & 0xff;
  payload.writeUInt16LE(lapTs, 5);
  payload.writeUInt16LE(lapNumber, 7);
  rrValues.forEach((value, index) => {
    payload.writeInt16LE(value, 9 + (index * 2));
  });
  return buildZephyrCommand(RtoRDataMessageId, payload);
}

export interface ZephyrRrExtractionState {
  accumulatorMs: number | null;
  lastPacketSeq: number | null;
  lastSign: boolean | null;
}

export interface ZephyrExtractedRrSample {
  timestampMs: number;
  intervalMs: number;
}

export interface ZephyrRrExtractionResult {
  samples: ZephyrExtractedRrSample[];
  state: ZephyrRrExtractionState;
  sequenceGap: {
    expectedSeqNumber: number;
    receivedSeqNumber: number;
  } | null;
}

export function parseZephyrPacket(rawData: Buffer | Uint8Array): ZephyrParsedPacket {
  const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
  if (data.length < 5) {
    throw new Error(`Zephyr packet слишком короткий: ${data.length}`);
  }

  const stx = data[0] ?? -1;
  const msgId = data[1] ?? -1;
  const declaredPayloadLength = data[2] ?? -1;
  const payload = data.subarray(3, data.length - 2);
  const crc = data[data.length - 2] ?? -1;
  const endByte = data[data.length - 1] ?? -1;

  if (stx !== PacketStartByte) {
    throw new Error('Zephyr packet без STX');
  }
  if (declaredPayloadLength !== payload.length) {
    throw new Error(`Zephyr packet с неверной длиной payload: ${declaredPayloadLength} != ${payload.length}`);
  }
  if (!isKnownPacketEnd(endByte)) {
    throw new Error(`Zephyr packet с неизвестным terminator: ${endByte}`);
  }

  const expectedCrc = crc8PushBlock(payload);
  if (crc !== expectedCrc) {
    throw new Error(`Zephyr packet с неверным CRC: ${crc} != ${expectedCrc}`);
  }

  if (msgId === RtoRTransmissionStateMessageId) {
    if (endByte === PacketEndByte) {
      throw new Error('R-to-R response не может завершаться ETX');
    }
    return {
      kind: 'r-to-r-transmission-state-response',
      success: endByte === PacketAckByte,
      rawData: Buffer.from(data),
    };
  }

  if (msgId === RtoRDataMessageId) {
    if (endByte !== PacketEndByte) {
      throw new Error('R-to-R data packet должен завершаться ETX');
    }
    if (payload.length < 9 || ((payload.length - 9) % 2) !== 0) {
      throw new Error(`R-to-R packet имеет неожиданный размер payload: ${payload.length}`);
    }
    const seqNumber = payload[0] ?? 0;
    const year = payload.readUInt16LE(1);
    const month = payload[3] ?? 0;
    const day = payload[4] ?? 0;
    const lapTs = payload.readUInt16LE(5);
    const lapNumber = payload.readUInt16LE(7);
    const rr: number[] = [];
    for (let offset = 9; offset < payload.length; offset += 2) {
      rr.push(payload.readInt16LE(offset));
    }
    return {
      kind: 'r-to-r-data',
      seqNumber,
      year,
      month,
      day,
      dayMs: (lapNumber * 65_535) + lapTs,
      rr,
      rawData: Buffer.from(data),
    };
  }

  throw new Error(`Для Zephyr packet нет обработчика msgId=${msgId}`);
}

export function createInitialZephyrRrExtractionState(referenceTimestampMs: number): ZephyrRrExtractionState {
  return {
    accumulatorMs: referenceTimestampMs,
    lastPacketSeq: 0xff,
    lastSign: null,
  };
}

export function resetZephyrRrExtractionState(): ZephyrRrExtractionState {
  return {
    accumulatorMs: null,
    lastPacketSeq: null,
    lastSign: null,
  };
}

export function extractZephyrRrSamples(
  rrValues: readonly number[],
  seqNumber: number,
  state: ZephyrRrExtractionState,
  referenceTimestampMs: number,
): ZephyrRrExtractionResult {
  let nextAccumulatorMs = state.accumulatorMs ?? referenceTimestampMs;
  let nextLastPacketSeq = state.lastPacketSeq;
  let nextLastSign = state.lastSign;
  let sequenceGap: ZephyrRrExtractionResult['sequenceGap'] = null;

  if (nextLastPacketSeq === null) {
    nextLastPacketSeq = 0xff;
    nextLastSign = null;
  }

  const expectedSeqNumber = (nextLastPacketSeq + 1) & 0xff;
  if (seqNumber !== expectedSeqNumber) {
    sequenceGap = {
      expectedSeqNumber,
      receivedSeqNumber: seqNumber,
    };
    nextLastSign = null;
  }
  nextLastPacketSeq = seqNumber;

  const pendingValues = [...rrValues];
  const extractedIntervalsMs: number[] = [];
  if (nextLastSign === null && pendingValues.length > 0) {
    const firstInterval = pendingValues.shift()!;
    nextLastSign = firstInterval > 0;
    extractedIntervalsMs.push(Math.abs(firstInterval));
  }

  for (const rr of pendingValues) {
    const nextSign = rr > 0;
    if (nextLastSign === null || nextSign !== nextLastSign) {
      extractedIntervalsMs.push(Math.abs(rr));
      nextLastSign = nextSign;
    }
  }

  const samples: ZephyrExtractedRrSample[] = extractedIntervalsMs.map((intervalMs) => {
    nextAccumulatorMs += intervalMs;
    return {
      timestampMs: nextAccumulatorMs,
      intervalMs,
    };
  });

  return {
    samples,
    state: {
      accumulatorMs: nextAccumulatorMs,
      lastPacketSeq: nextLastPacketSeq,
      lastSign: nextLastSign,
    },
    sequenceGap,
  };
}

function buildZephyrCommand(messageId: number, payload: Buffer): Buffer {
  return Buffer.from([
    PacketStartByte,
    messageId & 0xff,
    payload.length & 0xff,
    ...payload,
    crc8PushBlock(payload),
    PacketEndByte,
  ]);
}

function crc8PushByte(crc: number, byte: number): number {
  let nextCrc = crc ^ byte;
  for (let index = 0; index < 8; index += 1) {
    if ((nextCrc & 1) !== 0) {
      nextCrc = (nextCrc >> 1) ^ 0x8c;
    } else {
      nextCrc >>= 1;
    }
    nextCrc &= 0xff;
  }
  return nextCrc;
}

function crc8PushBlock(block: Uint8Array, initialCrc = 0): number {
  let crc = initialCrc;
  for (const byte of block) {
    crc = crc8PushByte(crc, byte);
  }
  return crc;
}

function isKnownPacketEnd(byte: number): boolean {
  return byte === PacketEndByte || byte === PacketAckByte || byte === PacketNakByte;
}
