import { createRequire } from 'node:module';
import { once } from 'node:events';

type RawDeviceSummary = {
  kind: string;
  deviceId: number;
  deviceType: number;
  transmissionType?: number;
  rssi?: number;
  threshold?: number;
  messageType: number;
  hex: string;
};

type ScannerEntry = {
  kind: string;
  scanner: {
    on(eventName: string, listener: (...args: unknown[]) => void): unknown;
    scan(): void;
    detach?(): void;
  };
  eventName: string;
};

const require = createRequire(import.meta.url);
const ant = require('../node_modules/ant-plus/ant-plus.js');
const antBuild = require('../node_modules/ant-plus/build/ant');

const KnownDeviceTypes: Record<number, string> = {
  0x0b: 'bicycle-power',
  0x11: 'fitness-equipment',
  0x19: 'environment',
  0x1f: 'muscle-oxygen',
  0x78: 'heart-rate',
  0x79: 'speed-cadence',
  0x7a: 'cadence',
  0x7b: 'speed',
  0x7c: 'stride-speed-distance',
};

const ProbeDurationMs = readEnvNumber('SENSYNC2_ANT_PLUS_PROBE_MS', 15_000);

function readEnvNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeStateSnapshot(state: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== 'function') {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

function parseRawFrame(data: Buffer): RawDeviceSummary | null {
  if (data.length <= (antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN + 3)) {
    return null;
  }

  const extFlags = data.readUInt8(antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN);
  if ((extFlags & 0x80) === 0) {
    return null;
  }

  const messageType = data.readUInt8(antBuild.Messages.BUFFER_INDEX_MSG_TYPE);
  const deviceId = data.readUInt16LE(antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN + 1);
  const deviceType = data.readUInt8(antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN + 3);
  const transmissionType = data.length > (antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN + 4)
    ? data.readUInt8(antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN + 4)
    : undefined;
  const rssi = (extFlags & 0x40) !== 0 && data.length > (antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN + 6)
    ? data.readInt8(antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN + 6)
    : undefined;
  const threshold = (extFlags & 0x40) !== 0 && data.length > (antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN + 7)
    ? data.readInt8(antBuild.Messages.BUFFER_INDEX_EXT_MSG_BEGIN + 7)
    : undefined;

  return {
    kind: KnownDeviceTypes[deviceType] ?? `unknown-0x${deviceType.toString(16).padStart(2, '0')}`,
    deviceId,
    deviceType,
    ...(transmissionType !== undefined ? { transmissionType } : {}),
    ...(rssi !== undefined ? { rssi } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    messageType,
    hex: data.toString('hex'),
  };
}

async function openStick(
  stick: InstanceType<typeof ant.GarminStick3> | InstanceType<typeof ant.GarminStick2>,
  timeoutMs: number,
): Promise<void> {
  const startupPromise = once(stick, 'startup');
  const opened = stick.open();
  if (!opened) {
    throw new Error('ANT+ stick не открылся');
  }
  await Promise.race([
    startupPromise,
    sleep(timeoutMs).then(() => {
      throw new Error(`ANT+ stick не прислал startup за ${timeoutMs}ms`);
    }),
  ]);
}

function createScannerEntries(stick: InstanceType<typeof ant.GarminStick3> | InstanceType<typeof ant.GarminStick2>): ScannerEntry[] {
  return [
    { kind: 'heart-rate', scanner: new ant.HeartRateScanner(stick), eventName: 'hbData' },
    { kind: 'muscle-oxygen', scanner: new ant.MuscleOxygenScanner(stick), eventName: 'oxygenData' },
    { kind: 'bicycle-power', scanner: new ant.BicyclePowerScanner(stick), eventName: 'powerData' },
    { kind: 'fitness-equipment', scanner: new ant.FitnessEquipmentScanner(stick), eventName: 'fitnessData' },
    { kind: 'speed-cadence', scanner: new ant.SpeedCadenceScanner(stick), eventName: 'speedCadenceData' },
    { kind: 'speed', scanner: new ant.SpeedScanner(stick), eventName: 'speedData' },
    { kind: 'cadence', scanner: new ant.CadenceScanner(stick), eventName: 'cadenceData' },
    { kind: 'stride-speed-distance', scanner: new ant.StrideSpeedDistanceScanner(stick), eventName: 'ssdData' },
    { kind: 'environment', scanner: new ant.EnvironmentScanner(stick), eventName: 'envData' },
  ];
}

async function main(): Promise<void> {
  console.log(JSON.stringify({
    event: 'probe-starting',
    probeDurationMs: ProbeDurationMs,
  }));

  const stickCandidates = [new ant.GarminStick3(), new ant.GarminStick2()];
  let stick: InstanceType<typeof ant.GarminStick3> | InstanceType<typeof ant.GarminStick2> | null = null;

  for (const candidate of stickCandidates) {
    try {
      console.log(JSON.stringify({
        event: 'opening-stick',
        adapter: candidate.constructor.name,
      }));
      await openStick(candidate, readEnvNumber('SENSYNC2_ANT_PLUS_STICK_OPEN_TIMEOUT_MS', 5_000));
      stick = candidate;
      console.log(JSON.stringify({
        event: 'stick-opened',
        adapter: candidate.constructor.name,
      }));
      break;
    } catch (error) {
      console.log(JSON.stringify({
        event: 'stick-open-failed',
        adapter: candidate.constructor.name,
        message: error instanceof Error ? error.message : String(error),
      }));
      try {
        candidate.close();
      } catch {
        // Игнорируем ошибки закрытия на неудачной попытке.
      }
    }
  }

  if (!stick) {
    throw new Error('Не удалось открыть ANT+ stick');
  }

  const rawDevices = new Map<string, RawDeviceSummary>();
  const seenScannerKinds = new Set<string>();
  const scannerEntries = createScannerEntries(stick);

  stick.on('read', (data: Buffer) => {
    const parsed = parseRawFrame(data);
    if (!parsed) {
      return;
    }
    const key = `${parsed.deviceId}:${parsed.deviceType}:${parsed.transmissionType ?? 'x'}`;
    if (!rawDevices.has(key)) {
      rawDevices.set(key, parsed);
      console.log(JSON.stringify({
        event: 'raw-device',
        ...parsed,
      }, null, 2));
    }
  });

  // Один scanner переводит stick в scan mode, остальные подцепляются к уже открытому scan.
  const opener = scannerEntries[0];
  if (!opener) {
    throw new Error('Не удалось создать scanner opener');
  }

  console.log(JSON.stringify({
    event: 'starting-scan-mode',
    opener: opener.kind,
  }));

  opener.scanner.on('attached', () => {
    console.log(JSON.stringify({ event: 'scanner-attached', kind: opener.kind }));
  });
  opener.scanner.on('detached', () => {
    console.log(JSON.stringify({ event: 'scanner-detached', kind: opener.kind }));
  });
  opener.scanner.on(opener.eventName, (state: unknown) => {
    seenScannerKinds.add(opener.kind);
    console.log(JSON.stringify({
      event: 'scanner-state',
      kind: opener.kind,
      snapshot: normalizeStateSnapshot(state as Record<string, unknown>),
    }, null, 2));
  });
  opener.scanner.scan();

  await sleep(250);

  for (const entry of scannerEntries.slice(1)) {
    entry.scanner.on('attached', () => {
      console.log(JSON.stringify({ event: 'scanner-attached', kind: entry.kind }));
    });
    entry.scanner.on('detached', () => {
      console.log(JSON.stringify({ event: 'scanner-detached', kind: entry.kind }));
    });
    entry.scanner.on(entry.eventName, (state: unknown) => {
      seenScannerKinds.add(entry.kind);
      console.log(JSON.stringify({
        event: 'scanner-state',
        kind: entry.kind,
        snapshot: normalizeStateSnapshot(state as Record<string, unknown>),
      }, null, 2));
    });
    try {
      entry.scanner.scan();
    } catch (error) {
      console.log(JSON.stringify({
        event: 'scanner-scan-failed',
        kind: entry.kind,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  let heartbeatCount = 0;
  const heartbeatId = setInterval(() => {
    heartbeatCount += 1;
    console.log(JSON.stringify({
      event: 'probe-heartbeat',
      tick: heartbeatCount,
      seenScannerKinds: [...seenScannerKinds.values()],
      rawDevices: rawDevices.size,
    }));
  }, 1_000);

  console.log(JSON.stringify({
    event: 'probe-running',
    durationMs: ProbeDurationMs,
  }));

  await sleep(ProbeDurationMs);
  clearInterval(heartbeatId);

  console.log(JSON.stringify({
    event: 'probe-summary',
    rawDevices: [...rawDevices.values()].map((device) => ({
      kind: device.kind,
      deviceId: device.deviceId,
      deviceType: device.deviceType,
      transmissionType: device.transmissionType ?? null,
      ...(device.rssi !== undefined ? { rssi: device.rssi } : {}),
      ...(device.threshold !== undefined ? { threshold: device.threshold } : {}),
    })),
    scannerKinds: [...seenScannerKinds.values()],
  }, null, 2));

  try {
    stick.close();
  } catch {
    // Закрытие после probe не критично.
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
