import type { PluginDescriptor } from '../types.ts';

export const LaunchProfiles = ['fake', 'fake-hdf5-simulation', 'veloerg'] as const;
export type LaunchProfile = (typeof LaunchProfiles)[number];

export interface LaunchProfileContext {
  env: NodeJS.ProcessEnv;
}

export interface ResolvedLaunchProfile {
  id: LaunchProfile;
  title: string;
  plugins: PluginDescriptor[];
}

export interface LaunchProfileDefinition {
  id: LaunchProfile;
  title: string;
  resolve(context: LaunchProfileContext): ResolvedLaunchProfile;
}
