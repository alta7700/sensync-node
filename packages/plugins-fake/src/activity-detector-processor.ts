import { defineRuntimeEventInput, EventTypes } from '@sensync2/core';
import { definePlugin } from '@sensync2/plugin-sdk';
import {
  applyManifestFragment,
  buildManifestFragmentFromInputs,
  createEveryEventHandler,
  createHandlerGroup,
  createInputMap,
  createInputRuntime,
  createOutputRegistry,
  createStateCell,
  createUniformSignalEmitter,
  signalInput,
  type HandlerGroup,
  type InputRuntime,
  type StateCell,
} from '@sensync2/plugin-kit';

interface ActivityDetectorConfig {
  sourceStreamId: string;
  threshold: number;
}

let cfg: ActivityDetectorConfig = { sourceStreamId: 'shapes.signal', threshold: 0.6 };
let inputs: InputRuntime<'source'> | null = null;
let handlers: HandlerGroup<'source', 'active'> | null = null;
let states: { active: StateCell<boolean> } | null = null;
let emitActivityLabel: ReturnType<typeof createUniformSignalEmitter<'label'>> | null = null;

const baseManifest = {
  id: 'activity-detector-processor',
  version: '0.1.0',
  required: false,
  subscriptions: [],
  mailbox: {
    controlCapacity: 64,
    dataCapacity: 256,
    dataPolicy: 'fail-fast' as const,
  },
  emits: [
    { type: EventTypes.activityStateChanged, v: 1 },
    { type: EventTypes.signalBatch, v: 1 },
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
    cfg = { ...cfg, ...(ctx.getConfig<ActivityDetectorConfig>() ?? {}) };
    resetManifest();

    const inputMap = createInputMap({
      source: signalInput({
        streamId: cfg.sourceStreamId,
        retain: { by: 'samples', value: 1_000 },
      }),
    });
    inputs = createInputRuntime(inputMap);
    states = {
      active: createStateCell<boolean>(false),
    };
    emitActivityLabel = createUniformSignalEmitter(createOutputRegistry({
      label: 'activity.label',
    }));

    handlers = createHandlerGroup({
      inputs,
      states,
      handlers: [
        createEveryEventHandler({
          selector: { input: 'source' },
          run: async ({ event, api, ctx: handlerCtx }) => {
            if (event.type !== EventTypes.signalBatch) return;

            let hasActivity = false;
            for (let index = 0; index < event.payload.values.length; index += 1) {
              if (Math.abs(Number(event.payload.values[index])) >= cfg.threshold) {
                hasActivity = true;
                break;
              }
            }

            const currentActive = Boolean(api.states.active.current());
            if (hasActivity === currentActive) return;

            api.states.active.set(hasActivity);
            await handlerCtx.emit(defineRuntimeEventInput({
              type: EventTypes.activityStateChanged,
              v: 1,
              kind: 'fact',
              priority: 'system',
              payload: { active: hasActivity },
            }));

            if (!emitActivityLabel) return;
            await emitActivityLabel.emit(
              handlerCtx,
              'label',
              new Int16Array([hasActivity ? 1 : 0]),
              { t0Ms: handlerCtx.clock.nowSessionMs(), dtMs: 0 },
            );
          },
        }),
      ],
    });

    applyManifestFragment(manifest, buildManifestFragmentFromInputs(inputMap));
    applyManifestFragment(manifest, handlers.manifest());
    await handlers.start(ctx);

    await ctx.emit(defineRuntimeEventInput({
      type: EventTypes.activityStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload: { active: false },
    }));
  },
  async onEvent(event, ctx) {
    await handlers?.dispatch(event, ctx);
  },
  async onShutdown(ctx) {
    await handlers?.stop(ctx);
    inputs?.clear();
    inputs = null;
    handlers = null;
    emitActivityLabel = null;
    states?.active.clear();
    states = null;
  },
});
