import { defineEventContract } from '@sensync2/core';

export const Hdf5PluginEventContracts = {
  simulationTick: defineEventContract({
    type: 'hdf5.simulation.tick',
    v: 1,
    kind: 'fact',
    priority: 'system',
    visibility: 'plugin-private',
    description: 'Внутренний тик проигрывания HDF5-симуляции.',
  }),
} as const;

export const hdf5EventContracts = Object.values(Hdf5PluginEventContracts);
