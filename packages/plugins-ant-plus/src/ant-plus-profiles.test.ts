import { describe, expect, it } from 'vitest';
import {
  AntPlusProfileRegistry,
  makeAntPlusCandidateId,
  resolveAntPlusProfile,
} from './ant-plus-profiles.ts';

describe('ant-plus-profiles', () => {
  it('выбирает профиль по явному profile и по candidateId', () => {
    expect(resolveAntPlusProfile({ profile: 'muscle-oxygen' })).toBe(AntPlusProfileRegistry['muscle-oxygen']);
    expect(resolveAntPlusProfile({ profile: 'train-red' })).toBe(AntPlusProfileRegistry['train-red']);
    expect(resolveAntPlusProfile({ candidateId: 'train-red:42' })).toBe(AntPlusProfileRegistry['train-red']);
    expect(resolveAntPlusProfile({ candidateId: makeAntPlusCandidateId(AntPlusProfileRegistry['muscle-oxygen'], 7) }))
      .toBe(AntPlusProfileRegistry['muscle-oxygen']);
  });

  it('падает обратно на muscle-oxygen для неизвестного профиля', () => {
    expect(resolveAntPlusProfile({ profile: 'unknown' })).toBe(AntPlusProfileRegistry['muscle-oxygen']);
    expect(resolveAntPlusProfile({ deviceType: 31 })).toBe(AntPlusProfileRegistry['muscle-oxygen']);
  });
});
