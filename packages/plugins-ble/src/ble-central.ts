import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AdapterScanCandidate } from '@sensync2/core';
import {
  buildRToRTransmissionStateCommand,
  buildFakeRtoRDataPacket,
  normalizeZephyrUuid,
  ZephyrBioHarnessRxUuid,
  ZephyrBioHarnessTxUuid,
} from './zephyr-protocol.ts';
import {
  describeBlePeripheral,
  zephyrBioHarnessDiscoveryScore,
  loadNobleApi,
  makeBleScanCandidate,
  normalizeBleError,
  previewBleHex,
  type BleTransportConnectRequest,
  type BleTransportNotification,
  type BleTransportScanRequest,
  type NobleApiLike,
  type NobleCharacteristicLike,
  type NoblePeripheralLike,
  type NobleServiceLike,
  type ZephyrBioHarnessAdapterConfig,
} from './ble-boundary.ts';

const RealTxUuid = normalizeZephyrUuid(ZephyrBioHarnessTxUuid);
const RealRxUuid = normalizeZephyrUuid(ZephyrBioHarnessRxUuid);

interface ConnectedPeripheralState {
  peripheral: NoblePeripheralLike;
  txCharacteristic: NobleCharacteristicLike;
  rxCharacteristic: NobleCharacteristicLike;
  onData: (data: unknown) => void;
  onDisconnect: () => void;
}

export interface BleTransportScanResult {
  scanId: string;
  candidates: AdapterScanCandidate[];
}

export interface BleTransport {
  readonly mode: 'fake' | 'real';
  scan(request: BleTransportScanRequest): Promise<BleTransportScanResult>;
  connect(request: BleTransportConnectRequest): Promise<void>;
  disconnect(): Promise<void>;
  readPacket(): BleTransportNotification | null;
  takeConnectionSignal(): string | null;
}

export function createBleTransport(config: Required<ZephyrBioHarnessAdapterConfig>): BleTransport {
  if (config.mode === 'real') {
    return new RealBleTransport(config);
  }
  return new FakeBleTransport(config);
}

class FakeBleTransport implements BleTransport {
  readonly mode = 'fake' as const;

  private readonly scanTimeoutMs: number;
  private readonly includeCandidate: boolean;
  private readonly packetIntervalMs: number;
  private readonly autoDisconnectAfterMs: number | null;
  private readonly candidateId = 'zephyr-bioharness-fake-1';
  private readonly candidateLocalName = 'BH BHT Fake';
  private readonly candidateAddress = 'FAKE-BLE-0001';
  private readonly packetQueue: BleTransportNotification[] = [];
  private readonly connectionSignals: string[] = [];
  private lastScanId: string | null = null;
  private connected = false;
  private packetSeq = 0;
  private packetInterval: ReturnType<typeof setInterval> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Required<ZephyrBioHarnessAdapterConfig>) {
    this.scanTimeoutMs = config.scanTimeoutMs;
    this.includeCandidate = config.fakeHasCandidate;
    this.packetIntervalMs = config.fakePacketIntervalMs;
    this.autoDisconnectAfterMs = config.fakeAutoDisconnectAfterMs;
  }

  async scan(request: BleTransportScanRequest): Promise<BleTransportScanResult> {
    this.lastScanId = randomUUID();
    this.stopFakeStreaming();
    const timeoutMs = request.timeoutMs ?? this.scanTimeoutMs;
    await sleep(Math.min(timeoutMs, 25));
    return {
      scanId: this.lastScanId,
      candidates: this.includeCandidate
        ? [
          {
            candidateId: this.candidateId,
            title: this.candidateLocalName,
            subtitle: this.candidateAddress,
            details: {
              rssi: -41,
              peripheralId: this.candidateId,
              address: this.candidateAddress,
              localName: this.candidateLocalName,
            },
            connectFormData: {
              scanId: this.lastScanId,
              peripheralId: this.candidateId,
              localName: this.candidateLocalName,
            },
          },
        ]
        : [],
    };
  }

  async connect(request: BleTransportConnectRequest): Promise<void> {
    if (!this.includeCandidate) {
      throw new Error('Fake transport настроен без доступного Zephyr-устройства');
    }
    if (!request.candidateId || request.candidateId !== this.candidateId) {
      throw new Error('Выбранный Zephyr-кандидат не найден в fake transport');
    }
    if (this.lastScanId && request.scanId && request.scanId !== this.lastScanId) {
      throw new Error('Результаты scan для Zephyr устарели, запусти поиск заново');
    }

    await this.disconnect();
    this.connected = true;
    this.packetQueue.length = 0;
    this.connectionSignals.length = 0;
    this.packetSeq = 0;
    this.packetInterval = setInterval(() => {
      if (!this.connected) return;
      this.packetSeq = (this.packetSeq + 1) % 255;
      const rrValue = 780 + (this.packetSeq % 5) * 4;
      this.packetQueue.push({
        // Для fake-потока чередуем знак RR, чтобы extraction логика видела новые интервалы.
        data: buildFakeRtoRDataPacket(this.packetSeq, [rrValue, -rrValue]),
        receivedMonoMs: performance.now(),
      });
    }, this.packetIntervalMs);

    if (this.autoDisconnectAfterMs !== null) {
      this.disconnectTimer = setTimeout(() => {
        if (!this.connected) return;
        this.stopFakeStreaming();
        this.connectionSignals.push('Fake BLE transport имитировал разрыв соединения');
      }, this.autoDisconnectAfterMs);
    }
  }

  async disconnect(): Promise<void> {
    this.stopFakeStreaming();
    this.packetQueue.length = 0;
  }

  readPacket(): BleTransportNotification | null {
    return this.packetQueue.shift() ?? null;
  }

  takeConnectionSignal(): string | null {
    return this.connectionSignals.shift() ?? null;
  }

  private stopFakeStreaming(): void {
    this.connected = false;
    if (this.packetInterval) {
      clearInterval(this.packetInterval);
      this.packetInterval = null;
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }
}

class RealBleTransport implements BleTransport {
  readonly mode = 'real' as const;

  private readonly noble: NobleApiLike;
  private readonly scanTimeoutMs: number;
  private readonly logBleDebug: boolean;
  private readonly packetQueue: BleTransportNotification[] = [];
  private readonly connectionSignals: string[] = [];
  private readonly candidatesById = new Map<string, AdapterScanCandidate>();
  private readonly peripheralsById = new Map<string, NoblePeripheralLike>();
  private lastScanId: string | null = null;
  private connectedState: ConnectedPeripheralState | null = null;
  private suppressDisconnectSignal = false;
  private scanningActive = false;

  constructor(config: Required<ZephyrBioHarnessAdapterConfig>) {
    this.noble = loadNobleApi();
    this.scanTimeoutMs = config.scanTimeoutMs;
    this.logBleDebug = config.logBleDebug;
    this.noble.on('scanStart', () => {
      this.scanningActive = true;
      debugLog(this.logBleDebug, 'scanStart event');
    });
    this.noble.on('scanStop', () => {
      this.scanningActive = false;
      debugLog(this.logBleDebug, 'scanStop event');
    });
  }

  async scan(request: BleTransportScanRequest): Promise<BleTransportScanResult> {
    const timeoutMs = request.timeoutMs ?? this.scanTimeoutMs;
    debugLog(this.logBleDebug, 'scan:start', {
      timeoutMs,
      nobleState: this.noble.state ?? 'unknown',
    });
    await this.stopScanningSafely();
    this.lastScanId = randomUUID();
    this.candidatesById.clear();
    this.peripheralsById.clear();

    const discoverListener = (rawPeripheral: unknown) => {
      const peripheral = rawPeripheral as NoblePeripheralLike;
      const firstSeen = !this.peripheralsById.has(peripheral.id);
      const candidate = makeBleScanCandidate(this.lastScanId as string, peripheral);
      this.candidatesById.set(candidate.candidateId, candidate);
      this.peripheralsById.set(peripheral.id, peripheral);
      if (firstSeen) {
        debugLog(this.logBleDebug, 'scan:discover', describeBlePeripheral(peripheral));
      }
    };

    this.noble.on('discover', discoverListener);
    try {
      await waitForPoweredOn(this.noble, timeoutMs);
      await startScanning(this.noble, this.logBleDebug);
      await sleep(timeoutMs);
      await this.stopScanningSafely();
    } catch (error) {
      await this.stopScanningSafely();
      warnLog(this.logBleDebug, 'scan:error', { message: normalizeBleError(error) });
      throw new Error(normalizeBleError(error));
    } finally {
      this.noble.removeListener('discover', discoverListener);
    }

    const candidates = [...this.peripheralsById.values()]
      .sort((left, right) => {
        // Сначала поднимаем устройства, которые больше похожи на Zephyr,
        // а затем уже сортируем по уровню сигнала.
        const scoreDelta = zephyrBioHarnessDiscoveryScore(right) - zephyrBioHarnessDiscoveryScore(left);
        if (scoreDelta !== 0) return scoreDelta;
        return right.rssi - left.rssi;
      })
      .map((peripheral) => this.candidatesById.get(peripheral.id))
      .filter((candidate): candidate is AdapterScanCandidate => candidate !== undefined);

    debugLog(this.logBleDebug, 'scan:done', {
      scanId: this.lastScanId,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        title: candidate.title,
        subtitle: candidate.subtitle,
        details: candidate.details,
      })),
    });

    return {
      scanId: this.lastScanId,
      candidates,
    };
  }

  async connect(request: BleTransportConnectRequest): Promise<void> {
    const selection = this.resolveSelection(request);
    debugLog(this.logBleDebug, 'connect:start', {
      request,
      peripheral: describeBlePeripheral(selection.peripheral),
    });
    await this.disconnect();
    this.packetQueue.length = 0;
    this.connectionSignals.length = 0;

    try {
      await connectPeripheral(selection.peripheral);
      debugLog(this.logBleDebug, 'connect:connected', describeBlePeripheral(selection.peripheral));
      const { txCharacteristic, rxCharacteristic } = await discoverCharacteristics(selection.peripheral, this.logBleDebug);
      debugLog(this.logBleDebug, 'connect:characteristics-ready', {
        txCharacteristic: describeCharacteristic(txCharacteristic),
        rxCharacteristic: describeCharacteristic(rxCharacteristic),
      });
      const onData = (rawData: unknown) => {
        const data = toBuffer(rawData);
        if (!data) return;
        debugLog(this.logBleDebug, 'notification:data', {
          bytes: data.length,
          hex: previewBleHex(data),
        });
        this.packetQueue.push({
          data,
          receivedMonoMs: performance.now(),
        });
      };
      const onDisconnect = () => {
        const disconnectedPeripheral = this.connectedState?.peripheral;
        this.cleanupConnectedState();
        if (this.suppressDisconnectSignal) return;
        if (disconnectedPeripheral?.id === selection.peripheral.id) {
          warnLog(this.logBleDebug, 'connect:disconnect-signal', describeBlePeripheral(selection.peripheral));
          this.connectionSignals.push('BLE-соединение с Zephyr было закрыто устройством или ОС');
        }
      };
      selection.peripheral.on('disconnect', onDisconnect);
      txCharacteristic.on('data', onData);
      debugLog(this.logBleDebug, 'connect:subscribe-tx', describeCharacteristic(txCharacteristic));
      await subscribeCharacteristic(txCharacteristic);
      debugLog(this.logBleDebug, 'connect:write-rx-start-stream', {
        characteristic: describeCharacteristic(rxCharacteristic),
        hex: previewBleHex(buildRToRTransmissionStateCommand(true)),
      });
      await writeCharacteristic(rxCharacteristic, buildRToRTransmissionStateCommand(true), false);
      this.connectedState = {
        peripheral: selection.peripheral,
        txCharacteristic,
        rxCharacteristic,
        onData,
        onDisconnect,
      };
      debugLog(this.logBleDebug, 'connect:ready', describeBlePeripheral(selection.peripheral));
    } catch (error) {
      warnLog(this.logBleDebug, 'connect:error', { message: normalizeBleError(error) });
      await this.disconnect().catch(() => undefined);
      throw new Error(normalizeBleError(error));
    }
  }

  async disconnect(): Promise<void> {
    const state = this.connectedState;
    this.cleanupConnectedState();
    this.packetQueue.length = 0;
    if (!state) return;

    debugLog(this.logBleDebug, 'disconnect:start', describeBlePeripheral(state.peripheral));
    this.suppressDisconnectSignal = true;
    try {
      state.txCharacteristic.removeListener('data', state.onData);
      await writeCharacteristic(state.rxCharacteristic, buildRToRTransmissionStateCommand(false), false).catch(() => undefined);
      await unsubscribeCharacteristic(state.txCharacteristic).catch(() => undefined);
      await disconnectPeripheral(state.peripheral).catch(() => undefined);
    } finally {
      state.peripheral.removeListener('disconnect', state.onDisconnect);
      this.suppressDisconnectSignal = false;
      debugLog(this.logBleDebug, 'disconnect:done', describeBlePeripheral(state.peripheral));
    }
  }

  readPacket(): BleTransportNotification | null {
    return this.packetQueue.shift() ?? null;
  }

  takeConnectionSignal(): string | null {
    return this.connectionSignals.shift() ?? null;
  }

  private resolveSelection(request: BleTransportConnectRequest): { peripheral: NoblePeripheralLike } {
    if (this.lastScanId && request.scanId && request.scanId !== this.lastScanId) {
      throw new Error('Результаты BLE scan устарели, запусти поиск Zephyr заново');
    }

    const peripheralId = request.peripheralId ?? request.candidateId;
    if (!peripheralId) {
      throw new Error('Для подключения Zephyr нужно выбрать устройство из результатов scan');
    }
    const peripheral = this.peripheralsById.get(peripheralId);
    if (!peripheral) {
      throw new Error('Выбранное Zephyr-устройство больше не доступно в результатах scan');
    }
    return { peripheral };
  }

  private cleanupConnectedState(): void {
    const state = this.connectedState;
    if (!state) return;
    state.txCharacteristic.removeListener('data', state.onData);
    state.peripheral.removeListener('disconnect', state.onDisconnect);
    this.connectedState = null;
  }

  private async stopScanningSafely(): Promise<void> {
    if (!this.scanningActive) {
      return;
    }
    await stopScanning(this.noble, this.logBleDebug).catch(() => undefined);
    this.scanningActive = false;
  }
}

function toBuffer(rawData: unknown): Buffer | null {
  if (Buffer.isBuffer(rawData)) return rawData;
  if (rawData instanceof Uint8Array) return Buffer.from(rawData);
  return null;
}

function waitForPoweredOn(noble: NobleApiLike, timeoutMs: number): Promise<void> {
  if (noble.state === 'poweredOn') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const listener = (nextState: unknown) => {
      if (nextState === 'poweredOn') {
        if (timeoutId) clearTimeout(timeoutId);
        noble.removeListener('stateChange', listener);
        resolve();
        return;
      }
      if (typeof nextState === 'string' && ['unsupported', 'unauthorized', 'poweredOff'].includes(nextState)) {
        if (timeoutId) clearTimeout(timeoutId);
        noble.removeListener('stateChange', listener);
        reject(new Error(`Bluetooth adapter в состоянии ${nextState}`));
      }
    };

    timeoutId = setTimeout(() => {
      noble.removeListener('stateChange', listener);
      reject(new Error('Bluetooth adapter не перешёл в состояние poweredOn'));
    }, timeoutMs);

    noble.on('stateChange', listener);
  });
}

async function startScanning(noble: NobleApiLike, logBleDebug: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      noble.removeListener('scanStart', onScanStart);
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(normalizeBleError(error)));
    };

    const onScanStart = () => finishResolve();

    noble.on('scanStart', onScanStart);

    timeoutId = setTimeout(() => {
      // На macOS `noble` иногда реально начинает scan, но `scanStart`
      // не доходит предсказуемо до JS-коллбэка. Не блокируем lifecycle бесконечно.
      debugLog(logBleDebug, 'scan:start fallback timeout');
      finishResolve();
    }, 200);

    try {
      noble.startScanning([], true, (error) => {
        if (error) {
          finishReject(error);
        }
      });
    } catch (error) {
      finishReject(error);
    }
  });
}

async function stopScanning(noble: NobleApiLike, logBleDebug: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      noble.removeListener('scanStop', onScanStop);
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(normalizeBleError(error)));
    };

    const onScanStop = () => finishResolve();

    noble.on('scanStop', onScanStop);

    timeoutId = setTimeout(() => {
      // Если `scanStop` не пришёл, всё равно не держим scan lifecycle подвешенным.
      debugLog(logBleDebug, 'scan:stop fallback timeout');
      finishResolve();
    }, 300);

    try {
      noble.stopScanning(() => finishResolve());
    } catch (error) {
      finishReject(error);
    }
  });
}

async function connectPeripheral(peripheral: NoblePeripheralLike): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    peripheral.connect((error) => {
      if (error) {
        reject(new Error(normalizeBleError(error)));
        return;
      }
      resolve();
    });
  });
}

async function disconnectPeripheral(peripheral: NoblePeripheralLike): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    peripheral.disconnect((error) => {
      if (error) {
        reject(new Error(normalizeBleError(error)));
        return;
      }
      resolve();
    });
  });
}

async function discoverCharacteristics(
  peripheral: NoblePeripheralLike,
  logBleDebug: boolean,
): Promise<{ txCharacteristic: NobleCharacteristicLike; rxCharacteristic: NobleCharacteristicLike }> {
  const services = await discoverServices(peripheral);
  debugLog(logBleDebug, 'gatt:services', services.map(describeService));
  const characteristicsByService = new Map<string, NobleCharacteristicLike[]>();
  for (const service of services) {
    const serviceUuid = normalizeZephyrUuid(service.uuid);
    const characteristics = await discoverServiceCharacteristics(service);
    characteristicsByService.set(serviceUuid, characteristics);
    debugLog(logBleDebug, 'gatt:characteristics', {
      serviceUuid,
      characteristics: characteristics.map(describeCharacteristic),
    });
  }

  const allCharacteristics = [...characteristicsByService.values()].flat();
  const txCharacteristic = allCharacteristics.find((candidate) => normalizeZephyrUuid(candidate.uuid) === RealTxUuid);
  const rxCharacteristic = allCharacteristics.find((candidate) => normalizeZephyrUuid(candidate.uuid) === RealRxUuid);
  if (!txCharacteristic || !rxCharacteristic) {
    throw new Error(
      'У Zephyr не найдены обязательные GATT characteristics. '
      + `Ожидались tx=${RealTxUuid}, rx=${RealRxUuid}. `
      + `Найдены services: ${joinOrFallback([...characteristicsByService.keys()], 'нет')}. `
      + `Найдены characteristics: ${joinOrFallback(allCharacteristics.map((candidate) => normalizeZephyrUuid(candidate.uuid)), 'нет')}`,
    );
  }

  return { txCharacteristic, rxCharacteristic };
}

async function subscribeCharacteristic(characteristic: NobleCharacteristicLike): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    characteristic.subscribe((error) => {
      if (error) {
        reject(new Error(normalizeBleError(error)));
        return;
      }
      resolve();
    });
  });
}

async function unsubscribeCharacteristic(characteristic: NobleCharacteristicLike): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    characteristic.unsubscribe((error) => {
      if (error) {
        reject(new Error(normalizeBleError(error)));
        return;
      }
      resolve();
    });
  });
}

async function writeCharacteristic(
  characteristic: NobleCharacteristicLike,
  data: Buffer,
  withoutResponse: boolean,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    characteristic.write(data, withoutResponse, (error) => {
      if (error) {
        reject(new Error(normalizeBleError(error)));
        return;
      }
      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverServices(peripheral: NoblePeripheralLike): Promise<NobleServiceLike[]> {
  return new Promise((resolve, reject) => {
    peripheral.discoverServices([], (error, services) => {
      if (error) {
        reject(new Error(normalizeBleError(error)));
        return;
      }
      resolve(services ?? []);
    });
  });
}

async function discoverServiceCharacteristics(service: NobleServiceLike): Promise<NobleCharacteristicLike[]> {
  return new Promise((resolve, reject) => {
    service.discoverCharacteristics([], (error, characteristics) => {
      if (error) {
        reject(new Error(normalizeBleError(error)));
        return;
      }
      resolve(characteristics ?? []);
    });
  });
}

function describeService(service: NobleServiceLike): Record<string, unknown> {
  return {
    uuid: normalizeZephyrUuid(service.uuid),
  };
}

function describeCharacteristic(characteristic: NobleCharacteristicLike): Record<string, unknown> {
  return {
    uuid: normalizeZephyrUuid(characteristic.uuid),
    properties: characteristic.properties ?? [],
  };
}

function joinOrFallback(values: string[], fallback: string): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

function debugLog(enabled: boolean, scope: string, payload?: unknown): void {
  if (!enabled) return;
  if (payload === undefined) {
    console.log('[zephyr-bioharness-ble]', scope);
    return;
  }
  console.log('[zephyr-bioharness-ble]', scope, payload);
}

function warnLog(enabled: boolean, scope: string, payload?: unknown): void {
  if (!enabled) return;
  if (payload === undefined) {
    console.warn('[zephyr-bioharness-ble]', scope);
    return;
  }
  console.warn('[zephyr-bioharness-ble]', scope, payload);
}
