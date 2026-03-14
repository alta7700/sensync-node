import { createRequire } from 'node:module';
import type { AdapterScanCandidate, AdapterScanCandidateDetailValue } from '@sensync2/core';
import {
  isZephyrBioHarnessDeviceName,
  normalizeZephyrUuid,
  ZephyrBioHarnessServiceUuids,
} from './zephyr-protocol.ts';

const require = createRequire(import.meta.url);

export interface ZephyrBioHarnessAdapterConfig {
  adapterId?: string;
  mode?: 'fake' | 'real';
  scanTimeoutMs?: number;
  autoReconnect?: boolean;
  reconnectRetryDelayMs?: number;
  logBleDebug?: boolean;
  fakeHasCandidate?: boolean;
  fakePacketIntervalMs?: number;
  fakeAutoDisconnectAfterMs?: number | null;
}

export interface BleTransportScanRequest {
  timeoutMs?: number;
}

export interface BleTransportConnectRequest {
  candidateId?: string;
  scanId?: string;
  peripheralId?: string;
  localName?: string;
}

export interface BleTransportNotification {
  data: Buffer;
  receivedMonoMs: number;
}

export interface BleEventEmitterLike {
  on(eventName: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(eventName: string, listener: (...args: unknown[]) => void): unknown;
}

export interface NobleAdvertisementLike {
  localName?: string;
  serviceUuids?: string[];
  serviceData?: Array<{ uuid: string; data: Buffer }>;
  manufacturerData?: Buffer;
  txPowerLevel?: number;
}

export interface NobleCharacteristicLike extends BleEventEmitterLike {
  uuid: string;
  properties?: string[];
  subscribe(callback: (error?: Error | string | null) => void): void;
  unsubscribe(callback: (error?: Error | string | null) => void): void;
  write(data: Buffer, withoutResponse: boolean, callback: (error?: Error | string | null) => void): void;
}

export interface NobleServiceLike extends BleEventEmitterLike {
  uuid: string;
  discoverCharacteristics(
    characteristicUuids: string[],
    callback: (error: Error | string | null, characteristics: NobleCharacteristicLike[]) => void,
  ): void;
}

export interface NoblePeripheralLike extends BleEventEmitterLike {
  id: string;
  address: string;
  rssi: number;
  state?: string;
  advertisement: NobleAdvertisementLike;
  connect(callback: (error?: Error | string | null) => void): void;
  disconnect(callback: (error?: Error | string | null) => void): void;
  discoverServices(
    serviceUuids: string[],
    callback: (error: Error | string | null, services: NobleServiceLike[]) => void,
  ): void;
  discoverSomeServicesAndCharacteristics(
    serviceUuids: string[],
    characteristicUuids: string[],
    callback: (error: Error | string | null, services: NobleServiceLike[], characteristics: NobleCharacteristicLike[]) => void,
  ): void;
}

export interface NobleApiLike extends BleEventEmitterLike {
  state?: string;
  startScanning(
    serviceUuids: string[],
    allowDuplicates: boolean,
    callback?: (error?: Error | string | null) => void,
  ): void | Promise<void>;
  stopScanning(callback?: () => void): void | Promise<void>;
}

export const DefaultZephyrBioHarnessConfig: Required<ZephyrBioHarnessAdapterConfig> = {
  adapterId: 'zephyr-bioharness',
  mode: 'fake',
  scanTimeoutMs: 5_000,
  autoReconnect: true,
  reconnectRetryDelayMs: 1_500,
  logBleDebug: false,
  fakeHasCandidate: true,
  fakePacketIntervalMs: 1_000,
  fakeAutoDisconnectAfterMs: null,
};

export function envBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === undefined || rawValue === '') return fallback;
  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function envNumber(rawValue: string | undefined, fallback: number): number {
  if (rawValue === undefined || rawValue === '') return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveZephyrBioHarnessConfig(
  rawConfig: ZephyrBioHarnessAdapterConfig | undefined,
): Required<ZephyrBioHarnessAdapterConfig> {
  const merged = { ...DefaultZephyrBioHarnessConfig, ...(rawConfig ?? {}) };
  return {
    adapterId: merged.adapterId,
    mode: merged.mode,
    scanTimeoutMs: Math.max(500, Math.trunc(merged.scanTimeoutMs)),
    autoReconnect: merged.autoReconnect,
    reconnectRetryDelayMs: Math.max(250, Math.trunc(merged.reconnectRetryDelayMs)),
    logBleDebug: merged.logBleDebug,
    fakeHasCandidate: merged.fakeHasCandidate,
    fakePacketIntervalMs: Math.max(100, Math.trunc(merged.fakePacketIntervalMs)),
    fakeAutoDisconnectAfterMs: merged.fakeAutoDisconnectAfterMs === null
      ? null
      : Math.max(250, Math.trunc(merged.fakeAutoDisconnectAfterMs)),
  };
}

export function readZephyrBioHarnessEnvOverrides(env: NodeJS.ProcessEnv): Partial<ZephyrBioHarnessAdapterConfig> {
  const envMode = env.SENSYNC2_ZEPHYR_BIOHARNESS_MODE;
  return {
    ...((envMode === 'fake' || envMode === 'real') ? { mode: envMode } : {}),
    ...(env.SENSYNC2_ZEPHYR_BIOHARNESS_SCAN_TIMEOUT_MS !== undefined
      ? { scanTimeoutMs: envNumber(env.SENSYNC2_ZEPHYR_BIOHARNESS_SCAN_TIMEOUT_MS, DefaultZephyrBioHarnessConfig.scanTimeoutMs) }
      : {}),
    ...(env.SENSYNC2_ZEPHYR_BIOHARNESS_AUTO_RECONNECT !== undefined
      ? { autoReconnect: envBoolean(env.SENSYNC2_ZEPHYR_BIOHARNESS_AUTO_RECONNECT, DefaultZephyrBioHarnessConfig.autoReconnect) }
      : {}),
    ...(env.SENSYNC2_ZEPHYR_BIOHARNESS_RECONNECT_RETRY_DELAY_MS !== undefined
      ? {
        reconnectRetryDelayMs: envNumber(
          env.SENSYNC2_ZEPHYR_BIOHARNESS_RECONNECT_RETRY_DELAY_MS,
          DefaultZephyrBioHarnessConfig.reconnectRetryDelayMs,
        ),
      }
      : {}),
    ...(env.SENSYNC2_ZEPHYR_BIOHARNESS_LOG_BLE !== undefined
      ? {
        logBleDebug: envBoolean(
          env.SENSYNC2_ZEPHYR_BIOHARNESS_LOG_BLE,
          DefaultZephyrBioHarnessConfig.logBleDebug,
        ),
      }
      : {}),
  };
}

export function buildBleTransportScanRequest(
  _formData: Record<string, unknown> | undefined,
  timeoutMs: number | undefined,
): BleTransportScanRequest {
  const request: BleTransportScanRequest = {};
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)) {
    request.timeoutMs = Math.max(500, Math.trunc(timeoutMs));
  }
  return request;
}

export function buildBleTransportConnectRequest(
  formData: Record<string, unknown> | undefined,
): BleTransportConnectRequest {
  const request: BleTransportConnectRequest = {};
  const candidateId = stringField(formData, 'candidateId');
  const scanId = stringField(formData, 'scanId');
  const peripheralId = stringField(formData, 'peripheralId');
  const localName = stringField(formData, 'localName');
  if (candidateId !== undefined) request.candidateId = candidateId;
  if (scanId !== undefined) request.scanId = scanId;
  if (peripheralId !== undefined) request.peripheralId = peripheralId;
  if (localName !== undefined) request.localName = localName;
  return request;
}

export function loadNobleApi(): NobleApiLike {
  try {
    const loaded = require('@abandonware/noble');
    return ((loaded as { default?: NobleApiLike }).default ?? loaded) as NobleApiLike;
  } catch {
    throw new Error(
      'Режим real требует установленный пакет `@abandonware/noble`. '
      + 'Запусти `npm install` в корне репозитория и проверь доступ приложения к Bluetooth.',
    );
  }
}

export function normalizeBleError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'Неизвестная BLE ошибка';
}

export function zephyrBioHarnessDiscoveryScore(peripheral: NoblePeripheralLike): number {
  let score = 0;
  const localName = sanitizeString(peripheral.advertisement?.localName);
  if (isZephyrBioHarnessDeviceName(localName)) {
    score += 100;
  }

  const zephyrServiceUuids = new Set(
    ZephyrBioHarnessServiceUuids.map((candidate) => normalizeZephyrUuid(candidate)),
  );
  const serviceUuids = peripheral.advertisement?.serviceUuids ?? [];
  if (serviceUuids.some((candidate) => zephyrServiceUuids.has(normalizeZephyrUuid(candidate)))) {
    score += 60;
  }

  const serviceData = peripheral.advertisement?.serviceData ?? [];
  if (serviceData.some((candidate) => zephyrServiceUuids.has(normalizeZephyrUuid(candidate.uuid)))) {
    score += 40;
  }

  return score;
}

export function isLikelyZephyrBioHarnessPeripheral(peripheral: NoblePeripheralLike): boolean {
  return zephyrBioHarnessDiscoveryScore(peripheral) > 0;
}

export function previewBleHex(rawData: Buffer | Uint8Array | undefined, maxBytes = 24): string | undefined {
  if (!rawData) return undefined;
  const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
  if (data.length === 0) return undefined;
  const preview = data.subarray(0, Math.max(1, maxBytes)).toString('hex');
  return data.length > maxBytes ? `${preview}...` : preview;
}

export function describeBlePeripheral(peripheral: NoblePeripheralLike): Record<string, unknown> {
  const localName = sanitizeString(peripheral.advertisement?.localName);
  const address = sanitizeString(peripheral.address);
  const serviceUuids = (peripheral.advertisement?.serviceUuids ?? [])
    .map((candidate) => sanitizeString(candidate))
    .filter((candidate): candidate is string => candidate !== undefined);
  const serviceDataUuids = (peripheral.advertisement?.serviceData ?? [])
    .map((candidate) => sanitizeString(candidate.uuid))
    .filter((candidate): candidate is string => candidate !== undefined);
  const zephyrScore = zephyrBioHarnessDiscoveryScore(peripheral);
  return {
    id: peripheral.id,
    ...(address !== undefined ? { address } : {}),
    ...(typeof peripheral.state === 'string' && peripheral.state.length > 0 ? { state: peripheral.state } : {}),
    ...(localName !== undefined ? { localName } : {}),
    rssi: peripheral.rssi,
    serviceUuids,
    serviceDataUuids,
    manufacturerDataHex: previewBleHex(peripheral.advertisement?.manufacturerData, 32),
    zephyrScore,
    likelyZephyr: zephyrScore > 0,
  };
}

export function makeBleScanCandidate(scanId: string, peripheral: NoblePeripheralLike): AdapterScanCandidate {
  const localName = sanitizeString(peripheral.advertisement?.localName);
  const address = sanitizeString(peripheral.address);
  const serviceUuids = (peripheral.advertisement?.serviceUuids ?? [])
    .map((candidate) => sanitizeString(candidate))
    .filter((candidate): candidate is string => candidate !== undefined);
  const serviceDataUuids = (peripheral.advertisement?.serviceData ?? [])
    .map((candidate) => sanitizeString(candidate.uuid))
    .filter((candidate): candidate is string => candidate !== undefined);
  const manufacturerDataHex = peripheral.advertisement?.manufacturerData
    ? peripheral.advertisement.manufacturerData.toString('hex').slice(0, 32)
    : undefined;
  const zephyrScore = zephyrBioHarnessDiscoveryScore(peripheral);
  const details: Record<string, AdapterScanCandidateDetailValue> = {
    rssi: peripheral.rssi,
    peripheralId: peripheral.id,
    zephyrScore,
    likelyZephyr: zephyrScore > 0,
  };
  if (localName !== undefined) details.localName = localName;
  if (address !== undefined) details.address = address;
  if (typeof peripheral.advertisement?.txPowerLevel === 'number') {
    details.txPower = peripheral.advertisement.txPowerLevel;
  }
  if (serviceUuids.length > 0) {
    details.serviceUuids = serviceUuids.join(',');
  }
  if (serviceDataUuids.length > 0) {
    details.serviceDataUuids = serviceDataUuids.join(',');
  }
  if (manufacturerDataHex !== undefined && manufacturerDataHex.length > 0) {
    details.manufacturerDataHex = manufacturerDataHex;
  }

  return {
    candidateId: peripheral.id,
    title: localName ?? address ?? `BLE ${peripheral.id}`,
    ...(address !== undefined ? { subtitle: address } : {}),
    details,
    connectFormData: {
      scanId,
      peripheralId: peripheral.id,
      ...(localName !== undefined ? { localName } : {}),
    },
  };
}

function stringField(formData: Record<string, unknown> | undefined, fieldId: string): string | undefined {
  const rawValue = formData?.[fieldId];
  return sanitizeString(rawValue);
}

function sanitizeString(rawValue: unknown): string | undefined {
  if (typeof rawValue !== 'string') return undefined;
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
