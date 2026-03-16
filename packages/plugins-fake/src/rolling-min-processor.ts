import { defineRuntimeEventInput, EventTypes } from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';
import {
  applyManifestFragment,
  buildManifestFragmentFromInputs,
  createHandlerGroup,
  createInputMap,
  createInputRuntime,
  createIntervalHandler,
  createOutputRegistry,
  createTimelineResetParticipant,
  createUniformSignalEmitter,
  signalInput,
  type HandlerGroup,
  type InputRuntime,
} from '@sensync2/plugin-kit';

interface RollingMinConfig {
  sourceStreamId: string;
  outputStreamId: string;
}

const FlushTickType = 'processor.rolling-min.flush';
let cfg: RollingMinConfig = { sourceStreamId: 'fake.a2', outputStreamId: 'metrics.fake.a2.rolling_min_1s' };
let inputs: InputRuntime<'source'> | null = null;
let handlers: HandlerGroup<'source', never> | null = null;
let emitRollingMin: ReturnType<typeof createUniformSignalEmitter<'output'>> | null = null;
const timelineResetParticipant = createTimelineResetParticipant({
  onPrepare: async (_input, ctx) => {
    await handlers?.stop(ctx);
  },
  onAbort: async (_input, ctx) => {
    await handlers?.start(ctx);
  },
  onCommit: async (_input, ctx) => {
    inputs?.clear();
    await handlers?.start(ctx);
  },
});

const baseManifest = {
  id: 'rolling-min-processor',
  version: '0.1.0',
  required: false,
  subscriptions: [],
  mailbox: {
    controlCapacity: 64,
    dataCapacity: 256,
    dataPolicy: 'fail-fast' as const,
  },
  emits: [
    { type: FlushTickType, v: 1 },
    { type: EventTypes.signalBatch, v: 1 },
    { type: 'metric.value.changed', v: 1 },
  ],
};

const manifest = {
  ...baseManifest,
  subscriptions: [...baseManifest.subscriptions],
  emits: [...baseManifest.emits],
};

function resetManifest(): void {
  manifest.subscriptions = [...baseManifest.subscriptions];
  manifest.emits = [...baseManifest.emits];
}

export default definePlugin({
  manifest,
  async onInit(ctx) {
    cfg = { ...cfg, ...(ctx.getConfig<RollingMinConfig>() ?? {}) };
    resetManifest();

    const inputMap = createInputMap({
      source: signalInput({
        streamId: cfg.sourceStreamId,
        retain: { by: 'samples', value: 2000 },
      }),
    });
    inputs = createInputRuntime(inputMap);
    emitRollingMin = createUniformSignalEmitter(createOutputRegistry({
      output: { streamId: cfg.outputStreamId, units: 'a.u.' },
    }));

    handlers = createHandlerGroup({
      inputs,
      states: {} as Record<never, never>,
      handlers: [
        createIntervalHandler({
          timerId: 'rolling-min.flush',
          tickEvent: { type: FlushTickType, v: 1 },
          everyMs: 1000,
          run: async ({ api, ctx: handlerCtx }) => {
            const window = api.inputs.signal('source').latestSamples(2000);
            if (!window || window.sampleCount === 0 || !emitRollingMin) return;

            let min = Number.POSITIVE_INFINITY;
            for (const value of window.values) {
              if (Number(value) < min) {
                min = Number(value);
              }
            }

            await emitRollingMin.emit(
              handlerCtx,
              'output',
              new Float32Array([min]),
              { t0Ms: handlerCtx.clock.nowSessionMs(), dtMs: 1000 },
            );

            await handlerCtx.emit(defineRuntimeEventInput({
              type: 'metric.value.changed',
              v: 1,
              kind: 'fact',
              priority: 'system',
              payload: { key: 'rollingMin.fakeA', value: min },
            }));
          },
        }),
      ],
    });

    applyManifestFragment(manifest, buildManifestFragmentFromInputs(inputMap));
    applyManifestFragment(manifest, handlers.manifest());
    timelineResetParticipant.initialize(ctx.currentTimelineId());
    await handlers.start(ctx);
  },
  async onEvent(event, ctx) {
    await handlers?.dispatch(event, ctx);
  },
  async onShutdown(ctx) {
    await handlers?.stop(ctx);
    inputs?.clear();
    inputs = null;
    handlers = null;
    emitRollingMin = null;
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
});
