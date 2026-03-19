import { buildPedalingEmgReplayUiSchema } from '@sensync2/plugins-ui-gateway';
import { resolveDevPythonComputeWorkerSpec } from '../compute-worker-boundary.ts';
import { moduleFileUrl } from '../launch-profile-boundary.ts';
import { makeUiGatewayDescriptor } from './shared.ts';
import type { LaunchProfileDefinition } from './types.ts';

const PedalingReplayStreamIds = [
  'trigno.avanti',
  'trigno.avanti.gyro.x',
  'trigno.avanti.gyro.y',
  'trigno.avanti.gyro.z',
] as const;

export const pedalingEmgReplayProfile: LaunchProfileDefinition = {
  id: 'pedaling-emg-replay',
  title: 'Pedaling EMG replay',
  resolve() {
    return {
      id: 'pedaling-emg-replay',
      title: 'Pedaling EMG replay',
      plugins: [
        {
          id: 'hdf5-simulation-adapter',
          modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-simulation-adapter.ts'),
          config: {
            adapterId: 'pedaling-emg-replay',
            allowConnectFilePathOverride: true,
            streamIds: [...PedalingReplayStreamIds],
            batchMs: 50,
            speed: 1,
            readChunkSamples: 4096,
          },
        },
        {
          id: 'pedaling-emg-processor',
          modulePath: moduleFileUrl('packages/plugins-processor-pedaling-emg/src/pedaling-emg-processor.ts'),
          config: {
            gyroStreamIds: {
              x: 'trigno.avanti.gyro.x',
              y: 'trigno.avanti.gyro.y',
              z: 'trigno.avanti.gyro.z',
            },
            emgStreamId: 'trigno.avanti',
            phaseLabelStreamId: 'pedaling.phase.coarse',
            activityLabelStreamId: 'pedaling.activity.vastus-lateralis',
            phaseConfidenceStreamId: 'pedaling.phase.confidence',
            emgConfidenceStreamId: 'pedaling.emg.confidence',
            cyclePeriodStreamId: 'pedaling.cycle.period-ms',
            activeWindowPhaseStart: 0.15,
            activeWindowPhaseEnd: 0.65,
            windowPrePaddingMs: 120,
            windowPostPaddingMs: 120,
            minCyclePeriodMs: 400,
            maxCyclePeriodMs: 2_000,
            axisLockHoldMs: 1_500,
            phaseConfidenceThreshold: 0.35,
            required: true,
            computeWorker: resolveDevPythonComputeWorkerSpec(
              'packages/plugins-processor-pedaling-emg/python_worker/main.py',
              {
                workerName: 'pedaling-emg-worker',
                requestTimeoutMs: 15_000,
              },
            ),
          },
        },
        makeUiGatewayDescriptor(buildPedalingEmgReplayUiSchema()),
      ],
    };
  },
};
