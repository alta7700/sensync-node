import { fakeProfile } from './fake.ts';
import { fakeHdf5SimulationProfile } from './fake-hdf5-simulation.ts';
import { veloergProfile } from './veloerg.ts';
import { LaunchProfiles, type LaunchProfile, type LaunchProfileDefinition, type ResolvedLaunchProfile } from './types.ts';

const DefaultLaunchProfile: LaunchProfile = 'fake';

const LaunchProfileRegistry: Record<LaunchProfile, LaunchProfileDefinition> = {
  fake: fakeProfile,
  'fake-hdf5-simulation': fakeHdf5SimulationProfile,
  veloerg: veloergProfile,
};

function isLaunchProfile(value: string): value is LaunchProfile {
  return (LaunchProfiles as readonly string[]).includes(value);
}

export { LaunchProfiles };
export type { LaunchProfile, LaunchProfileDefinition, ResolvedLaunchProfile };
export { DefaultLaunchProfile };

export function resolveLaunchProfile(rawValue: string | undefined | null): LaunchProfile {
  if (typeof rawValue === 'string' && isLaunchProfile(rawValue)) {
    return rawValue;
  }
  return DefaultLaunchProfile;
}

export function listLaunchProfiles(): LaunchProfile[] {
  return [...LaunchProfiles];
}

export function resolveLaunchProfileDefinition(profile: LaunchProfile = DefaultLaunchProfile): LaunchProfileDefinition {
  return LaunchProfileRegistry[profile];
}

export function buildLaunchProfile(
  profile: LaunchProfile = DefaultLaunchProfile,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLaunchProfile {
  return resolveLaunchProfileDefinition(profile).resolve({ env });
}

