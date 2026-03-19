import {
  EventTypes,
  type RuntimeEventOf,
  type SignalBatchPayload,
} from '@sensync2/core';
import {
  applyManifestFragment,
  buildManifestFragmentFromInputs,
  createEveryEventHandler,
  createHandlerGroup,
  createInputMap,
  createInputRuntime,
  createIrregularSignalEmitter,
  createOutputRegistry,
  createTimelineResetParticipant,
  createUniformSignalEmitter,
  signalInput,
  type HandlerGroup,
  type InputRuntime,
} from '@sensync2/plugin-kit';
import { definePlugin } from '@sensync2/plugin-sdk';
import {
  createHrFromRrEstimator,
  type HrFromRrEstimator,
  type HrFromRrEstimatorConfig,
} from './hr-from-rr.ts';

interface HrFromRrProcessorConfig extends HrFromRrEstimatorConfig {
  sourceStreamId?: string;
  outputStreamId?: string;
  required?: boolean;
}

interface NormalizedHrFromRrProcessorConfig extends HrFromRrEstimatorConfig {
  sourceStreamId: string;
  outputStreamId: string;
  required: boolean;
}

type HrInputPayload = RuntimeEventOf<typeof EventTypes.signalBatch, 1>['payload'];

type EstimatedHrBatch =
  | {
    kind: 'uniform';
    values: Float32Array;
    timing: {
      t0Ms: number;
      dtMs: number;
      sampleRateHz?: number;
    };
  }
  | {
    kind: 'irregular';
    values: Float32Array;
    timing: {
      timestampsMs: Float64Array;
      t0Ms?: number;
    };
  };

const defaultConfig: NormalizedHrFromRrProcessorConfig = {
  sourceStreamId: 'rr.input',
  outputStreamId: 'derived.hr',
  minRrSeconds: 0.3,
  maxRrSeconds: 2.0,
  medianWindowSize: 5,
  emaAlpha: 0.25,
  required: false,
};

let cfg = { ...defaultConfig };
let inputs: InputRuntime<'source'> | null = null;
let handlers: HandlerGroup<'source', never> | null = null;
let estimator: HrFromRrEstimator | null = null;
let emitUniformHr: ReturnType<typeof createUniformSignalEmitter<'output'>> | null = null;
let emitIrregularHr: ReturnType<typeof createIrregularSignalEmitter<'output'>> | null = null;
const timelineResetParticipant = createTimelineResetParticipant({
  onPrepare: async (_input, ctx) => {
    await handlers?.stop(ctx);
  },
  onAbort: async (_input, ctx) => {
    await handlers?.start(ctx);
  },
  onCommit: async (_input, ctx) => {
    inputs?.clear();
    estimator?.reset();
    await handlers?.start(ctx);
  },
});

const baseManifest = {
  id: 'hr-from-rr-processor',
  version: '0.1.0',
  required: false,
  subscriptions: [],
  mailbox: {
    controlCapacity: 64,
    dataCapacity: 256,
    dataPolicy: 'fail-fast' as const,
  },
  emits: [
    { type: EventTypes.signalBatch, v: 1 },
  ],
};

const manifest = {
  ...baseManifest,
  subscriptions: [...baseManifest.subscriptions],
  emits: [...baseManifest.emits],
};

function resetManifest(): void {
  manifest.required = baseManifest.required;
  manifest.subscriptions = [...baseManifest.subscriptions];
  manifest.emits = [...baseManifest.emits];
}

function resolveProcessorConfig(
  config: HrFromRrProcessorConfig | undefined,
): NormalizedHrFromRrProcessorConfig {
  const resolved: NormalizedHrFromRrProcessorConfig = {
    ...defaultConfig,
    ...config,
  };

  resolved.sourceStreamId = resolved.sourceStreamId.trim();
  resolved.outputStreamId = resolved.outputStreamId.trim();

  if (resolved.sourceStreamId.length === 0) {
    throw new Error('sourceStreamId должен быть непустым');
  }
  if (resolved.outputStreamId.length === 0) {
    throw new Error('outputStreamId должен быть непустым');
  }

  return resolved;
}

function sampleTimestampMs(payload: HrInputPayload, index: number): number {
  if (payload.frameKind === 'uniform-signal-batch') {
    if (payload.dtMs === undefined) {
      throw new Error(`RR stream "${payload.streamId}" должен содержать dtMs для uniform batch`);
    }
    return payload.t0Ms + (payload.dtMs * index);
  }

  const timestampMs = payload.timestampsMs?.[index];
  if (timestampMs === undefined) {
    throw new Error(`RR stream "${payload.streamId}" должен содержать timestampsMs для irregular batch`);
  }
  return timestampMs;
}

function estimateHrBatch(
  payload: SignalBatchPayload,
  hrEstimator: HrFromRrEstimator,
): EstimatedHrBatch | null {
  if (payload.frameKind === 'label-batch') {
    return null;
  }

  const hrValues: number[] = [];
  const timestampsMs: number[] = [];

  for (let index = 0; index < payload.sampleCount; index += 1) {
    const hrBpm = hrEstimator.push(Number(payload.values[index]));
    if (hrBpm === null) {
      continue;
    }
    hrValues.push(hrBpm);
    timestampsMs.push(sampleTimestampMs(payload, index));
  }

  if (hrValues.length === 0) {
    return null;
  }

  const values = Float32Array.from(hrValues);

  // Если из uniform-пакета ничего не выкинули, сохраняем uniform timeline без деградации.
  if (
    payload.frameKind === 'uniform-signal-batch'
    && payload.dtMs !== undefined
    && hrValues.length === payload.sampleCount
  ) {
    return {
      kind: 'uniform',
      values,
      timing: {
        t0Ms: payload.t0Ms,
        dtMs: payload.dtMs,
        ...(payload.sampleRateHz !== undefined ? { sampleRateHz: payload.sampleRateHz } : {}),
      },
    };
  }

  return {
    kind: 'irregular',
    values,
    timing: {
      timestampsMs: Float64Array.from(timestampsMs),
      ...(timestampsMs[0] !== undefined ? { t0Ms: timestampsMs[0] } : {}),
    },
  };
}

export default definePlugin({
  manifest,
  async onInit(ctx) {
    cfg = resolveProcessorConfig(ctx.getConfig<HrFromRrProcessorConfig>() ?? undefined);
    resetManifest();
    manifest.required = cfg.required;

    const inputMap = createInputMap({
      source: signalInput({
        streamId: cfg.sourceStreamId,
        retain: { by: 'samples', value: 1 },
      }),
    });

    inputs = createInputRuntime(inputMap);
    estimator = createHrFromRrEstimator(cfg);

    const outputRegistry = createOutputRegistry({
      output: { streamId: cfg.outputStreamId, units: 'bpm' },
    });
    emitUniformHr = createUniformSignalEmitter(outputRegistry);
    emitIrregularHr = createIrregularSignalEmitter(outputRegistry);

    handlers = createHandlerGroup({
      inputs,
      states: {} as Record<never, never>,
      handlers: [
        createEveryEventHandler({
          selector: { input: 'source' },
          run: async ({ event, ctx: handlerCtx }) => {
            if (event.type !== EventTypes.signalBatch) {
              return;
            }
            if (!estimator || !emitUniformHr || !emitIrregularHr) {
              return;
            }

            const hrBatch = estimateHrBatch(event.payload, estimator);
            if (!hrBatch) {
              return;
            }

            if (hrBatch.kind === 'uniform') {
              await emitUniformHr.emit(handlerCtx, 'output', hrBatch.values, hrBatch.timing);
              return;
            }
            await emitIrregularHr.emit(handlerCtx, 'output', hrBatch.values, hrBatch.timing);
          },
        }),
      ],
    });

    applyManifestFragment(manifest, buildManifestFragmentFromInputs(inputMap));
    await handlers.start(ctx);
  },
  async onEvent(event, ctx) {
    if (!handlers) {
      return;
    }
    await handlers.dispatch(event, ctx);
  },
  async onTimelineResetPrepare(input, ctx) {
    await timelineResetParticipant.onPrepare(input, ctx);
  },
  async onTimelineResetAbort(input, ctx) {
    await timelineResetParticipant.onAbort(input, ctx);
  },
  async onTimelineResetCommit(input, ctx) {
    await timelineResetParticipant.onCommit(input, ctx);
  },
  async onShutdown(ctx) {
    await handlers?.stop(ctx);
    inputs = null;
    handlers = null;
    estimator = null;
    emitUniformHr = null;
    emitIrregularHr = null;
    cfg = { ...defaultConfig };
    resetManifest();
  },
});
