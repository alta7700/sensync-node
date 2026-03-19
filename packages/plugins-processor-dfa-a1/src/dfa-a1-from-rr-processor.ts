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
  createLatestWinsRunner,
  createIpcWorkerClient,
  createOutputRegistry,
  createTimelineResetParticipant,
  signalInput,
  type HandlerGroup,
  type InputRuntime,
  type IpcWorkerClient,
  type IpcWorkerProcessSpec,
  type LatestWinsRunner,
} from '@sensync2/plugin-kit';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import {
  createDfaA1Scheduler,
  type DfaA1ComputationSnapshot,
  type DfaA1Scheduler,
  type DfaA1SchedulerConfig,
} from './dfa-a1-from-rr.ts';
import { decodeDfaA1Response, encodeDfaA1Request } from './dfa-a1-codec.ts';

interface DfaA1ProcessorConfig extends DfaA1SchedulerConfig {
  sourceStreamId?: string;
  outputStreamId?: string;
  required?: boolean;
  computeWorker?: IpcWorkerProcessSpec;
}

interface NormalizedDfaA1ProcessorConfig extends DfaA1SchedulerConfig {
  sourceStreamId: string;
  outputStreamId: string;
  required: boolean;
  computeWorker: IpcWorkerProcessSpec;
}

type DfaInputPayload = RuntimeEventOf<typeof EventTypes.signalBatch, 1>['payload'];

const DfaMethod = 'dfa.a1.from_rr';

const defaultConfig = {
  sourceStreamId: 'rr.input',
  outputStreamId: 'derived.dfa_a1',
  rrUnit: 's',
  windowDurationMs: 120_000,
  minRrCount: 50,
  recomputeEveryMs: 5_000,
  lowerScale: 4,
  upperScale: 16,
  required: false,
  computeWorker: null,
} as const;

const baseManifest = {
  id: 'dfa-a1-from-rr-processor',
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

let cfg: NormalizedDfaA1ProcessorConfig | null = null;
let pluginCtx: PluginContext | null = null;
let inputs: InputRuntime<'source'> | null = null;
let handlers: HandlerGroup<'source', never> | null = null;
let scheduler: DfaA1Scheduler | null = null;
let emitDfa: ReturnType<typeof createIrregularSignalEmitter<'output'>> | null = null;
let workerClient: IpcWorkerClient | null = null;
let requestRunner: LatestWinsRunner<{ generation: number; snapshot: DfaA1ComputationSnapshot }> | null = null;
let computeGeneration = 0;

function resetManifest(): void {
  manifest.required = baseManifest.required;
  manifest.subscriptions = [...baseManifest.subscriptions];
  manifest.emits = [...baseManifest.emits];
}

function resolveConfig(config: DfaA1ProcessorConfig | undefined): NormalizedDfaA1ProcessorConfig {
  const resolved = {
    ...defaultConfig,
    ...config,
  };

  if (!resolved.computeWorker || typeof resolved.computeWorker !== 'object') {
    throw new Error('computeWorker должен быть задан и валиден');
  }

  const sourceStreamId = resolved.sourceStreamId.trim();
  const outputStreamId = resolved.outputStreamId.trim();
  if (sourceStreamId.length === 0) {
    throw new Error('sourceStreamId должен быть непустым');
  }
  if (outputStreamId.length === 0) {
    throw new Error('outputStreamId должен быть непустым');
  }

  return {
    sourceStreamId,
    outputStreamId,
    rrUnit: resolved.rrUnit ?? defaultConfig.rrUnit,
    windowCount: resolved.windowCount ?? null,
    windowDurationMs: resolved.windowDurationMs ?? null,
    minRrCount: resolved.minRrCount ?? defaultConfig.minRrCount,
    recomputeEvery: resolved.recomputeEvery ?? null,
    recomputeEveryMs: resolved.recomputeEveryMs ?? null,
    lowerScale: resolved.lowerScale ?? defaultConfig.lowerScale,
    upperScale: resolved.upperScale ?? defaultConfig.upperScale,
    required: resolved.required,
    computeWorker: resolved.computeWorker,
  };
}

function sampleTimestampMs(payload: DfaInputPayload, index: number): number {
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

async function stopComputeResources(): Promise<void> {
  computeGeneration += 1;
  await requestRunner?.close();
  requestRunner = null;
  await workerClient?.close();
  workerClient = null;
}

async function ensureComputeResources(ctx: PluginContext): Promise<void> {
  if (!cfg) {
    throw new Error('dfa-a1-from-rr-processor не инициализирован');
  }
  if (workerClient && requestRunner) {
    return;
  }

  workerClient = createIpcWorkerClient({
    ...cfg.computeWorker,
    workerName: cfg.computeWorker.workerName ?? 'dfa-a1-worker',
  });
  await workerClient.start();

  requestRunner = createLatestWinsRunner({
    run: async (payload) => {
      if (!workerClient) {
        throw new Error('compute worker недоступен');
      }
      const response = await workerClient.request(
        DfaMethod,
        encodeDfaA1Request(
          payload.snapshot.rrIntervalsMs,
          payload.snapshot.lowerScale,
          payload.snapshot.upperScale,
        ),
      );
      return {
        generation: payload.generation,
        timestampMs: payload.snapshot.timestampMs,
        alpha1: decodeDfaA1Response(response),
      };
    },
    onResult: async (result) => {
      if (!pluginCtx || !emitDfa) {
        return;
      }
      if (result.generation !== computeGeneration) {
        return;
      }
      await emitDfa.emit(
        pluginCtx,
        'output',
        new Float32Array([result.alpha1]),
        {
          timestampsMs: new Float64Array([result.timestampMs]),
          t0Ms: result.timestampMs,
        },
      );
    },
    onError: async (error) => {
      ctx.telemetry({
        name: 'dfa_a1.compute_error',
        value: 1,
        unit: 'count',
        tags: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    },
  });
}

const timelineResetParticipant = createTimelineResetParticipant({
  onPrepare: async (_input, ctx) => {
    await handlers?.stop(ctx);
    await stopComputeResources();
  },
  onAbort: async (_input, ctx) => {
    await ensureComputeResources(ctx);
    await handlers?.start(ctx);
  },
  onCommit: async (_input, ctx) => {
    inputs?.clear();
    scheduler?.reset();
    await ensureComputeResources(ctx);
    await handlers?.start(ctx);
  },
});

export default definePlugin({
  manifest,
  async onInit(ctx) {
    pluginCtx = ctx;
    cfg = resolveConfig(ctx.getConfig<DfaA1ProcessorConfig>() ?? undefined);
    resetManifest();
    manifest.required = cfg.required;

    const inputMap = createInputMap({
      source: signalInput({
        streamId: cfg.sourceStreamId,
        retain: { by: 'samples', value: 1 },
      }),
    });

    inputs = createInputRuntime(inputMap);
    scheduler = createDfaA1Scheduler(cfg);
    const outputRegistry = createOutputRegistry({
      output: { streamId: cfg.outputStreamId },
    });
    emitDfa = createIrregularSignalEmitter(outputRegistry);

    await ensureComputeResources(ctx);

    handlers = createHandlerGroup({
      inputs,
      states: {} as Record<never, never>,
      handlers: [
        createEveryEventHandler({
          selector: { input: 'source' },
          run: async ({ event }) => {
            if (event.type !== EventTypes.signalBatch) {
              return;
            }
            if (!scheduler || !requestRunner) {
              return;
            }
            const payload = event.payload as SignalBatchPayload;
            if (payload.frameKind === 'label-batch') {
              return;
            }

            for (let index = 0; index < payload.sampleCount; index += 1) {
              const snapshot = scheduler.push(
                Number(payload.values[index]),
                sampleTimestampMs(payload, index),
              );
              if (!snapshot) {
                continue;
              }
              requestRunner.schedule({
                generation: computeGeneration,
                snapshot,
              });
            }
          },
        }),
      ],
    });

    applyManifestFragment(manifest, buildManifestFragmentFromInputs(inputMap));
    await handlers.start(ctx);
  },
  async onEvent(event, ctx) {
    await handlers?.dispatch(event, ctx);
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
    await stopComputeResources();
    inputs = null;
    handlers = null;
    scheduler = null;
    emitDfa = null;
    cfg = null;
    pluginCtx = null;
    resetManifest();
  },
});
