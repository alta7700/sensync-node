import type { AdapterScanCandidateDetailValue } from '@sensync2/core';

export type AntPlusProfileId = 'muscle-oxygen' | 'train-red';

export interface AntPlusProfileMetadata {
  /**
   * Идентификатор профиля, который передаётся в `formData.profile`.
   */
  profileId: AntPlusProfileId;
  /**
   * ANT+ device type, с которым работает профиль.
   */
  deviceType: number;
  /**
   * Человекочитаемое имя профиля для UI.
   */
  uiLabel: string;
  /**
   * Короткая подпись для scan-кандидата.
   */
  uiSubtitle: string;
  /**
   * Stream mapping профиля. Сейчас `train.red` использует ту же базу, что и Moxy.
   */
  streamMap: {
    smo2: 'moxy.smo2';
    thb: 'moxy.thb';
  };
  /**
   * Имя телеметрического семейства. Пока совпадает с legacy `moxy`, чтобы не ломать дашборды.
   */
  telemetryFamily: 'moxy' | 'train-red';
}

export const AntPlusProfileRegistry: Record<AntPlusProfileId, AntPlusProfileMetadata> = {
  'muscle-oxygen': {
    profileId: 'muscle-oxygen',
    deviceType: 31,
    uiLabel: 'Moxy',
    uiSubtitle: 'Muscle Oxygen',
    streamMap: {
      smo2: 'moxy.smo2',
      thb: 'moxy.thb',
    },
    telemetryFamily: 'moxy',
  },
  'train-red': {
    profileId: 'train-red',
    deviceType: 31,
    uiLabel: 'train.red',
    uiSubtitle: 'Muscle Oxygen class',
    streamMap: {
      smo2: 'moxy.smo2',
      thb: 'moxy.thb',
    },
    telemetryFamily: 'train-red',
  },
} as const;

export interface AntPlusProfileSelectionInput {
  profile?: string;
  deviceType?: number;
  candidateId?: string;
}

export function isAntPlusProfileId(profile: string | undefined): profile is AntPlusProfileId {
  return profile === 'muscle-oxygen' || profile === 'train-red';
}

export function resolveAntPlusProfile(input: AntPlusProfileSelectionInput | undefined): AntPlusProfileMetadata {
  const profile = input?.profile;
  if (isAntPlusProfileId(profile)) {
    return AntPlusProfileRegistry[profile];
  }

  const candidateId = input?.candidateId;
  if (typeof candidateId === 'string') {
    if (candidateId.startsWith('train-red:')) {
      return AntPlusProfileRegistry['train-red'];
    }
    if (candidateId.startsWith('moxy:')) {
      return AntPlusProfileRegistry['muscle-oxygen'];
    }
  }

  if (input?.deviceType === AntPlusProfileRegistry['train-red'].deviceType) {
    return AntPlusProfileRegistry['muscle-oxygen'];
  }

  return AntPlusProfileRegistry['muscle-oxygen'];
}

export function resolveAntPlusProfileSelection(
  profile?: string,
  candidateId?: string,
  deviceType?: number,
): AntPlusProfileMetadata {
  const input: AntPlusProfileSelectionInput = {};
  if (profile !== undefined) input.profile = profile;
  if (candidateId !== undefined) input.candidateId = candidateId;
  if (deviceType !== undefined) input.deviceType = deviceType;
  return resolveAntPlusProfile(input);
}

export function makeAntPlusCandidateId(profile: AntPlusProfileMetadata, deviceId: number): string {
  return `${profile.profileId}:${deviceId}`;
}

export function makeAntPlusCandidateTitle(profile: AntPlusProfileMetadata, deviceId: number): string {
  return `${profile.uiLabel} ${deviceId}`;
}

export function makeAntPlusCandidateDetails(
  profile: AntPlusProfileMetadata,
  deviceId: number,
  transmissionType: number,
): Record<string, AdapterScanCandidateDetailValue> {
  return {
    deviceId,
    deviceType: profile.deviceType,
    transmissionType,
    profile: profile.profileId,
  };
}

export function makeAntPlusCandidateConnectFormData(
  profile: AntPlusProfileMetadata,
  scanId: string,
  candidateId: string,
  deviceId: number,
): Record<string, unknown> {
  return {
    profile: profile.profileId,
    scanId,
    candidateId,
    deviceId,
    deviceType: profile.deviceType,
  };
}
