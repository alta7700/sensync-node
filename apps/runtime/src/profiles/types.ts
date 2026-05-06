import type { PluginDescriptor, TimelineResetRuntimeOptions } from '../types.ts';

export const LaunchProfiles = [
  'fake',
  'fake-hdf5-simulation',
  'veloerg',
  'veloerg-replay',
  'veloerg-viewer',
  'veloerg-final-viewer',
  'pedaling-emg-test',
  'pedaling-emg-replay',
  'pedaling-emg-viewer',
] as const;
export type LaunchProfile = (typeof LaunchProfiles)[number];

export interface LaunchProfileContext {
  env: NodeJS.ProcessEnv;
}

export interface ResolvedLaunchProfile {
  id: LaunchProfile;
  title: string;
  plugins: PluginDescriptor[];
  timelineReset?: TimelineResetRuntimeOptions;
}

export interface LaunchProfileDefinition {
  id: LaunchProfile;
  title: string;
  resolve(context: LaunchProfileContext): ResolvedLaunchProfile;
}
