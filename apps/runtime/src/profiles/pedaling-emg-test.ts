import * as path from 'node:path';
import { buildPedalingEmgTestUiSchema } from '@sensync2/plugins-ui-gateway';
import { resolveDevPythonComputeWorkerSpec } from '../compute-worker-boundary.ts';
import { moduleFileUrl, runtimeRepoRoot } from '../launch-profile-boundary.ts';
import { makeUiGatewayDescriptor } from './shared.ts';
import type { LaunchProfileDefinition } from './types.ts';

export const pedalingEmgTestProfile: LaunchProfileDefinition = {
  id: 'pedaling-emg-test',
  title: 'Pedaling EMG test live',
  resolve() {
    return {
      id: 'pedaling-emg-test',
      title: 'Pedaling EMG test live',
      timelineReset: {
        enabled: true,
        requesters: ['hdf5-recorder'],
        participants: [
          'ui-gateway',
          'trigno-adapter',
          'pedaling-emg-processor',
          'hdf5-recorder',
        ],
        prepareTimeoutMs: 5_000,
        commitTimeoutMs: 5_000,
        recorderPolicy: 'reject-if-recording',
      },
      plugins: [
        {
          id: 'trigno-adapter',
          modulePath: moduleFileUrl('packages/plugins-trigno/src/trigno-adapter.ts'),
          config: {
            adapterId: 'trigno',
            mode: 'real',
            backwardsCompatibility: false,
            upsampling: false,
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
        {
          id: 'hdf5-recorder',
          modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-recorder-plugin.ts'),
          config: {
            writerKey: 'local',
            outputDir: path.join(runtimeRepoRoot, 'recordings/pedaling-emg-test'),
            defaultFilenameTemplate: '{writer}-{startDateTime}',
            resetTimelineOnStart: true,
            resetTimelineOnStop: true,
            required: true,
            startConditions: {
              checks: [
                {
                  kind: 'fact-field',
                  event: { type: 'adapter.state.changed', v: 1 },
                  where: { adapterId: 'trigno' },
                  field: 'state',
                  eq: 'connected',
                  message: 'Trigno должен быть подключён и запущен',
                },
              ],
            },
          },
        },
        makeUiGatewayDescriptor(buildPedalingEmgTestUiSchema()),
      ],
    };
  },
};
