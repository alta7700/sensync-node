import * as path from 'node:path';
import { buildVeloergUiSchema } from '@sensync2/plugins-ui-gateway';
import { resolveDevPythonComputeWorkerSpec } from '../compute-worker-boundary.ts';
import { moduleFileUrl, runtimeRepoRoot } from '../launch-profile-boundary.ts';
import { makeUiGatewayDescriptor } from './shared.ts';
import type { LaunchProfileDefinition } from './types.ts';

export const veloergProfile: LaunchProfileDefinition = {
  id: 'veloerg',
  title: 'Veloerg live',
  resolve() {
    return {
      id: 'veloerg',
      title: 'Veloerg live',
      timelineReset: {
        enabled: true,
        requesters: ['hdf5-recorder'],
        participants: [
          'ui-gateway',
          'ant-plus-adapter',
          'zephyr-bioharness-3-adapter',
          'hr-from-rr-processor',
          'dfa-a1-from-rr-processor',
          'trigno-adapter',
          'hdf5-recorder',
        ],
        prepareTimeoutMs: 5_000,
        commitTimeoutMs: 5_000,
        recorderPolicy: 'reject-if-recording',
      },
      plugins: [
        {
          id: 'ant-plus-adapter',
          modulePath: moduleFileUrl('packages/plugins-ant-plus/src/ant-plus-adapter.ts'),
          config: {
            adapterId: 'ant-plus',
            mode: 'real',
          },
        },
        {
          id: 'zephyr-bioharness-3-adapter',
          modulePath: moduleFileUrl('packages/plugins-ble/src/zephyr-bioharness-3-adapter.ts'),
          config: {
            adapterId: 'zephyr-bioharness',
            mode: 'real',
            required: true,
          },
        },
        {
          id: 'hr-from-rr-processor',
          modulePath: moduleFileUrl('packages/plugins-processor-hr-from-rr/src/hr-from-rr-processor.ts'),
          config: {
            sourceStreamId: 'zephyr.rr',
            outputStreamId: 'zephyr.hr',
            required: true,
          },
        },
        {
          id: 'dfa-a1-from-rr-processor',
          modulePath: moduleFileUrl('packages/plugins-processor-dfa-a1/src/dfa-a1-from-rr-processor.ts'),
          config: {
            sourceStreamId: 'zephyr.rr',
            outputStreamId: 'zephyr.dfa_a1',
            rrUnit: 's',
            windowDurationMs: 120_000,
            recomputeEveryMs: 5_000,
            minRrCount: 50,
            lowerScale: 4,
            upperScale: 16,
            required: true,
            computeWorker: resolveDevPythonComputeWorkerSpec(
              'packages/plugins-processor-dfa-a1/python_worker/main.py',
              {
                workerName: 'dfa-a1-worker',
                requestTimeoutMs: 15_000,
              },
            ),
          },
        },
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
          id: 'label-generator-adapter',
          modulePath: moduleFileUrl('packages/plugins-labels/src/label-generator-adapter.ts'),
          config: {
            labels: {
              lactate: {
                streamId: 'lactate.label',
                sampleFormat: 'f32',
                units: 'mmol/L',
              },
              power: {
                streamId: 'power.label',
                sampleFormat: 'f32',
                units: 'W',
              },
            },
          },
        },
        {
          id: 'hdf5-recorder',
          modulePath: moduleFileUrl('packages/plugins-hdf5/src/hdf5-recorder-plugin.ts'),
          config: {
            writerKey: 'local',
            outputDir: path.join(runtimeRepoRoot, 'recordings/veloerg'),
            defaultFilenameTemplate: '{writer}-{startDateTime}',
            resetTimelineOnStart: true,
            resetTimelineOnStop: true,
            required: true,
            startConditions: {
              checks: [
                {
                  kind: 'fact-field',
                  event: { type: 'adapter.state.changed', v: 1 },
                  where: { adapterId: 'ant-plus' },
                  field: 'state',
                  eq: 'connected',
                  message: 'Moxy/ANT+ должен быть подключён',
                },
                {
                  kind: 'fact-field',
                  event: { type: 'adapter.state.changed', v: 1 },
                  where: { adapterId: 'zephyr-bioharness' },
                  field: 'state',
                  eq: 'connected',
                  message: 'Zephyr должен быть подключён',
                },
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
        makeUiGatewayDescriptor(buildVeloergUiSchema()),
      ],
    };
  },
};
