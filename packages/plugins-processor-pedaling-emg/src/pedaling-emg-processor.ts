import {
  EventTypes,
  type SignalBatchPayload,
} from '@sensync2/core';
import {
  applyManifestFragment,
  buildManifestFragmentFromInputs,
  createInputMap,
  createIpcWorkerClient,
  createIrregularSignalEmitter,
  createLabelSignalEmitter,
  createLatestWinsRunner,
  createOutputRegistry,
  createTimelineResetParticipant,
  signalInput,
  type IpcWorkerClient,
  type IpcWorkerProcessSpec,
  type LatestWinsRunner,
} from '@sensync2/plugin-kit';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';
import {
  createEmgSegmentBuffer,
  createPedalingPhaseEngine,
  type CompletedCycle,
  type EmgSegmentBuffer,
  type PedalingLabelState,
  type PedalingPhaseEngine,
  type PedalingPhaseEngineConfig,
} from './pedaling-emg.ts';
import {
  decodePedalingEmgResponse,
  encodePedalingEmgRequest,
  type DecodedPedalingEmgResponse,
} from './pedaling-emg-codec.ts';

interface PedalingEmgProcessorConfig extends PedalingPhaseEngineConfig {
  gyroStreamIds: { x: string; y: string; z: string };
  emgStreamId: string;
  phaseLabelStreamId: string;
  activityLabelStreamId: string;
  phaseConfidenceStreamId: string;
  emgConfidenceStreamId: string;
  cyclePeriodStreamId: string;
  phaseConfidenceThreshold: number;
  required?: boolean;
  computeWorker?: IpcWorkerProcessSpec;
}

interface NormalizedConfig extends PedalingPhaseEngineConfig {
  gyroStreamIds: { x: string; y: string; z: string };
  emgStreamId: string;
  phaseLabelStreamId: string;
  activityLabelStreamId: string;
  phaseConfidenceStreamId: string;
  emgConfidenceStreamId: string;
  cyclePeriodStreamId: string;
  phaseConfidenceThreshold: number;
  required: boolean;
  computeWorker: IpcWorkerProcessSpec;
}

interface ThresholdState {
  baseline?: number;
  thresholdHigh?: number;
  thresholdLow?: number;
}

interface PhaseConfidenceEmissionState {
  value: number;
  timestampMs: number;
}

interface PendingComputePayload {
  cycle: CompletedCycle;
  generation: number;
  request: ReturnType<EmgSegmentBuffer['extract']>;
}

const PedalingEmgMethod = 'pedaling.emg.detect';

const defaultConfig = {
  gyroStreamIds: {
    x: 'gyro.x',
    y: 'gyro.y',
    z: 'gyro.z',
  },
  emgStreamId: 'emg.input',
  phaseLabelStreamId: 'pedaling.phase.coarse',
  activityLabelStreamId: 'pedaling.activity',
  phaseConfidenceStreamId: 'pedaling.phase.confidence',
  emgConfidenceStreamId: 'pedaling.emg.confidence',
  cyclePeriodStreamId: 'pedaling.cycle.period-ms',
  activeWindowPhaseStart: 0.15,
  activeWindowPhaseEnd: 0.75,
  windowPrePaddingMs: 120,
  windowPostPaddingMs: 120,
  gyroBandHz: {
    low: 0.3,
    high: 6,
  },
  minCyclePeriodMs: 400,
  maxCyclePeriodMs: 2_000,
  axisLockHoldMs: 1_500,
  phaseConfidenceThreshold: 0.4,
  required: false,
  computeWorker: null,
} as const;

const baseManifest = {
  id: 'pedaling-emg-processor',
  version: '0.1.0',
  required: false,
  subscriptions: [],
  mailbox: {
    controlCapacity: 64,
    // Живой Trigno даёт плотный EMG + 3 gyro-потока, поэтому короткий CPU-спайк не должен сразу ронять worker.
    dataCapacity: 2048,
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

let cfg: NormalizedConfig | null = null;
let pluginCtx: PluginContext | null = null;
let phaseEngine: PedalingPhaseEngine | null = null;
let emgBuffer: EmgSegmentBuffer | null = null;
let emitLabels: ReturnType<typeof createLabelSignalEmitter<'phase' | 'activity'>> | null = null;
let emitSignals: ReturnType<typeof createIrregularSignalEmitter<'phaseConfidence' | 'emgConfidence' | 'cyclePeriod'>> | null = null;
let workerClient: IpcWorkerClient | null = null;
let requestRunner: LatestWinsRunner<PendingComputePayload> | null = null;
let computeGeneration = 0;
let lastPhaseState: PedalingLabelState | null = null;
let lastActivityState: PedalingLabelState | null = null;
let thresholdState: ThresholdState = {};
let computeAvailable = false;
let lastPhaseConfidenceEmission: PhaseConfidenceEmissionState | null = null;
let lastCompletedCycleEndMs: number | null = null;

function resetManifest(): void {
  manifest.required = baseManifest.required;
  manifest.subscriptions = [...baseManifest.subscriptions];
  manifest.emits = [...baseManifest.emits];
}

function trimRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} должен быть строкой`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} не может быть пустым`);
  }
  return normalized;
}

function normalizeConfig(input: PedalingEmgProcessorConfig | undefined): NormalizedConfig {
  const resolved = {
    ...defaultConfig,
    ...input,
    gyroStreamIds: {
      ...defaultConfig.gyroStreamIds,
      ...(input?.gyroStreamIds ?? {}),
    },
    gyroBandHz: {
      ...defaultConfig.gyroBandHz,
      ...(input?.gyroBandHz ?? {}),
    },
  };

  if (!resolved.computeWorker || typeof resolved.computeWorker !== 'object') {
    throw new Error('computeWorker должен быть задан и валиден');
  }

  if (!(resolved.activeWindowPhaseStart >= 0 && resolved.activeWindowPhaseStart < 1)) {
    throw new Error('activeWindowPhaseStart должен быть в диапазоне [0, 1)');
  }
  if (!(resolved.activeWindowPhaseEnd >= 0 && resolved.activeWindowPhaseEnd < 1)) {
    throw new Error('activeWindowPhaseEnd должен быть в диапазоне [0, 1)');
  }
  if (!(resolved.minCyclePeriodMs > 0 && resolved.maxCyclePeriodMs > resolved.minCyclePeriodMs)) {
    throw new Error('min/maxCyclePeriodMs должны задавать валидный диапазон');
  }
  if (!(resolved.phaseConfidenceThreshold >= 0 && resolved.phaseConfidenceThreshold <= 1)) {
    throw new Error('phaseConfidenceThreshold должен быть в диапазоне [0, 1]');
  }

  return {
    gyroStreamIds: {
      x: trimRequiredString(resolved.gyroStreamIds.x, 'gyroStreamIds.x'),
      y: trimRequiredString(resolved.gyroStreamIds.y, 'gyroStreamIds.y'),
      z: trimRequiredString(resolved.gyroStreamIds.z, 'gyroStreamIds.z'),
    },
    emgStreamId: trimRequiredString(resolved.emgStreamId, 'emgStreamId'),
    phaseLabelStreamId: trimRequiredString(resolved.phaseLabelStreamId, 'phaseLabelStreamId'),
    activityLabelStreamId: trimRequiredString(resolved.activityLabelStreamId, 'activityLabelStreamId'),
    phaseConfidenceStreamId: trimRequiredString(resolved.phaseConfidenceStreamId, 'phaseConfidenceStreamId'),
    emgConfidenceStreamId: trimRequiredString(resolved.emgConfidenceStreamId, 'emgConfidenceStreamId'),
    cyclePeriodStreamId: trimRequiredString(resolved.cyclePeriodStreamId, 'cyclePeriodStreamId'),
    activeWindowPhaseStart: resolved.activeWindowPhaseStart,
    activeWindowPhaseEnd: resolved.activeWindowPhaseEnd,
    windowPrePaddingMs: resolved.windowPrePaddingMs,
    windowPostPaddingMs: resolved.windowPostPaddingMs,
    gyroBandHz: resolved.gyroBandHz,
    minCyclePeriodMs: resolved.minCyclePeriodMs,
    maxCyclePeriodMs: resolved.maxCyclePeriodMs,
    axisLockHoldMs: resolved.axisLockHoldMs,
    phaseConfidenceThreshold: resolved.phaseConfidenceThreshold,
    required: resolved.required,
    computeWorker: resolved.computeWorker,
  };
}

function isSignalPayload(payload: SignalBatchPayload): boolean {
  return payload.frameKind === 'uniform-signal-batch' || payload.frameKind === 'irregular-signal-batch';
}

function latestPayloadTimestampMs(payload: SignalBatchPayload): number | null {
  if (payload.sampleCount <= 0) {
    return null;
  }
  if (payload.frameKind === 'uniform-signal-batch') {
    if (payload.dtMs === undefined) {
      return null;
    }
    return payload.t0Ms + (payload.dtMs * (payload.sampleCount - 1));
  }
  return payload.timestampsMs?.[payload.sampleCount - 1] ?? null;
}

async function emitLabelTransition(
  output: 'phase' | 'activity',
  timestampMs: number,
  nextState: PedalingLabelState,
): Promise<void> {
  if (!pluginCtx || !emitLabels) {
    return;
  }
  const currentState = output === 'phase' ? lastPhaseState : lastActivityState;
  if (currentState === nextState) {
    return;
  }
  await emitLabels.emit(
    pluginCtx,
    output,
    new Int16Array([nextState]),
    { timestampsMs: new Float64Array([timestampMs]) },
  );
  if (output === 'phase') {
    lastPhaseState = nextState;
  } else {
    lastActivityState = nextState;
  }
}

async function emitDiagnosticSignal(
  output: 'phaseConfidence' | 'emgConfidence' | 'cyclePeriod',
  timestampMs: number,
  value: number,
): Promise<void> {
  if (!pluginCtx || !emitSignals) {
    return;
  }
  await emitSignals.emit(
    pluginCtx,
    output,
    new Float32Array([value]),
    {
      timestampsMs: new Float64Array([timestampMs]),
      t0Ms: timestampMs,
    },
  );
}

async function stopComputeResources(): Promise<void> {
  computeGeneration += 1;
  await requestRunner?.close();
  requestRunner = null;
  await workerClient?.close();
  workerClient = null;
  computeAvailable = false;
}

async function ensureComputeResources(ctx: PluginContext): Promise<void> {
  if (!cfg) {
    throw new Error('pedaling-emg-processor не инициализирован');
  }
  if (workerClient && requestRunner) {
    computeAvailable = true;
    return;
  }

  workerClient = createIpcWorkerClient({
    ...cfg.computeWorker,
    workerName: cfg.computeWorker.workerName ?? 'pedaling-emg-worker',
  });
  await workerClient.start();
  computeAvailable = true;

  requestRunner = createLatestWinsRunner({
    run: async (payload) => {
      if (!workerClient || !payload.request) {
        throw new Error('pedaling-emg compute worker недоступен');
      }
      const response = await workerClient.request(
        PedalingEmgMethod,
        encodePedalingEmgRequest({
          cycleId: payload.request.cycleId,
          windowStartSessionMs: payload.request.windowStartSessionMs,
          sampleRateHz: payload.request.sampleRateHz,
          values: payload.request.values,
          expectedActiveStartOffsetMs: payload.request.expectedActiveStartOffsetMs,
          expectedActiveEndOffsetMs: payload.request.expectedActiveEndOffsetMs,
          ...(thresholdState.baseline !== undefined ? { previousBaseline: thresholdState.baseline } : {}),
          ...(thresholdState.thresholdHigh !== undefined ? { previousThresholdHigh: thresholdState.thresholdHigh } : {}),
          ...(thresholdState.thresholdLow !== undefined ? { previousThresholdLow: thresholdState.thresholdLow } : {}),
        }),
      );
      return {
        generation: payload.generation,
        cycle: payload.cycle,
        request: payload.request,
        response: decodePedalingEmgResponse(response),
      };
    },
    onResult: async (result) => {
      if (result.generation !== computeGeneration) {
        return;
      }
      await handlePythonResult(result.cycle, result.request.windowStartSessionMs, result.response);
    },
    onError: async (error, payload) => {
      if (payload.generation !== computeGeneration) {
        return;
      }
      ctx.telemetry({
        name: 'pedaling_emg.compute_error',
        value: 1,
        unit: 'count',
        tags: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      await emitDiagnosticSignal('emgConfidence', payload.cycle.endMs, 0);
    },
  });
}

async function ensureComputeResourcesBestEffort(ctx: PluginContext, reason: 'init' | 'reset-abort' | 'reset-commit'): Promise<void> {
  try {
    await ensureComputeResources(ctx);
    computeAvailable = true;
  } catch (error) {
    computeAvailable = false;
    requestRunner = null;
    await workerClient?.close().catch(() => {});
    workerClient = null;
    ctx.telemetry({
      name: 'pedaling_emg.compute_unavailable',
      value: 1,
      unit: 'count',
      tags: {
        reason,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function maybeEmitPhaseConfidence(timestampMs: number, value: number): Promise<void> {
  const normalizedValue = Math.max(0, Math.min(1, value));
  if (!lastPhaseConfidenceEmission) {
    lastPhaseConfidenceEmission = { value: normalizedValue, timestampMs };
    await emitDiagnosticSignal('phaseConfidence', timestampMs, normalizedValue);
    return;
  }

  const delta = Math.abs(lastPhaseConfidenceEmission.value - normalizedValue);
  const elapsedMs = timestampMs - lastPhaseConfidenceEmission.timestampMs;
  const shouldEmit = delta >= 0.05
    || (normalizedValue === 0 && lastPhaseConfidenceEmission.value !== 0)
    || elapsedMs >= 500;

  if (!shouldEmit) {
    return;
  }

  lastPhaseConfidenceEmission = { value: normalizedValue, timestampMs };
  await emitDiagnosticSignal('phaseConfidence', timestampMs, normalizedValue);
}

async function handlePythonResult(
  cycle: CompletedCycle,
  windowStartSessionMs: number,
  response: DecodedPedalingEmgResponse,
): Promise<void> {
  thresholdState = {
    baseline: response.baseline,
    thresholdHigh: response.thresholdHigh,
    thresholdLow: response.thresholdLow,
  };

  if (response.status === 'ok') {
    if (response.detectedOnsetOffsetMs !== null) {
      await emitLabelTransition('activity', windowStartSessionMs + response.detectedOnsetOffsetMs, 1);
    }
    if (response.detectedOffsetOffsetMs !== null) {
      await emitLabelTransition('activity', windowStartSessionMs + response.detectedOffsetOffsetMs, 0);
    } else {
      await emitLabelTransition('activity', cycle.endMs, 0);
    }
  }

  await emitDiagnosticSignal('emgConfidence', cycle.endMs, response.confidence);

  if (response.status !== 'ok') {
    // При мягкой деградации принудительно возвращаем activity в 0, чтобы не оставлять "залипшее" состояние.
    await emitLabelTransition('activity', cycle.endMs, 0);
  }
}

async function handleCompletedCycle(cycle: CompletedCycle): Promise<void> {
  lastCompletedCycleEndMs = cycle.endMs;
  await emitLabelTransition('phase', cycle.startMs, 0);
  await emitLabelTransition('phase', cycle.midpointMs, 1);
  await emitLabelTransition('phase', cycle.endMs, 0);

  await maybeEmitPhaseConfidence(cycle.endMs, cycle.phaseConfidence);
  await emitDiagnosticSignal('cyclePeriod', cycle.endMs, cycle.periodMs);

  if (!cfg || cycle.phaseConfidence < cfg.phaseConfidenceThreshold) {
    await emitDiagnosticSignal('emgConfidence', cycle.endMs, 0);
    await emitLabelTransition('activity', cycle.endMs, 0);
    return;
  }

  const request = emgBuffer?.extract(cycle) ?? null;
  if (!request) {
    await emitDiagnosticSignal('emgConfidence', cycle.endMs, 0);
    await emitLabelTransition('activity', cycle.endMs, 0);
    return;
  }

  if (!computeAvailable || !requestRunner) {
    await emitDiagnosticSignal('emgConfidence', cycle.endMs, 0);
    await emitLabelTransition('activity', cycle.endMs, 0);
    return;
  }

  requestRunner.schedule({
    cycle,
    generation: computeGeneration,
    request,
  });
}

const timelineResetParticipant = createTimelineResetParticipant({
  onPrepare: async () => {
    await stopComputeResources();
  },
  onAbort: async (_input, ctx) => {
    phaseEngine?.reset();
    emgBuffer?.reset();
    lastPhaseState = null;
    lastActivityState = null;
    thresholdState = {};
    lastPhaseConfidenceEmission = null;
    lastCompletedCycleEndMs = null;
    await ensureComputeResourcesBestEffort(ctx, 'reset-abort');
  },
  onCommit: async (_input, ctx) => {
    phaseEngine?.reset();
    emgBuffer?.reset();
    lastPhaseState = null;
    lastActivityState = null;
    thresholdState = {};
    lastPhaseConfidenceEmission = null;
    lastCompletedCycleEndMs = null;
    await ensureComputeResourcesBestEffort(ctx, 'reset-commit');
  },
});

export default definePlugin({
  manifest,
  async onInit(ctx) {
    pluginCtx = ctx;
    cfg = normalizeConfig(ctx.getConfig<PedalingEmgProcessorConfig>() ?? undefined);
    resetManifest();
    manifest.required = cfg.required;

    const inputs = createInputMap({
      gyroX: signalInput({ streamId: cfg.gyroStreamIds.x, retain: { by: 'durationMs', value: 10_000 } }),
      gyroY: signalInput({ streamId: cfg.gyroStreamIds.y, retain: { by: 'durationMs', value: 10_000 } }),
      gyroZ: signalInput({ streamId: cfg.gyroStreamIds.z, retain: { by: 'durationMs', value: 10_000 } }),
      emg: signalInput({ streamId: cfg.emgStreamId, retain: { by: 'durationMs', value: 10_000 } }),
    });
    applyManifestFragment(manifest, buildManifestFragmentFromInputs(inputs));

    emitLabels = createLabelSignalEmitter(createOutputRegistry({
      phase: { streamId: cfg.phaseLabelStreamId, units: 'label' },
      activity: { streamId: cfg.activityLabelStreamId, units: 'label' },
    }));
    emitSignals = createIrregularSignalEmitter(createOutputRegistry({
      phaseConfidence: { streamId: cfg.phaseConfidenceStreamId, units: 'a.u.' },
      emgConfidence: { streamId: cfg.emgConfidenceStreamId, units: 'a.u.' },
      cyclePeriod: { streamId: cfg.cyclePeriodStreamId, units: 'ms' },
    }));
    phaseEngine = createPedalingPhaseEngine(cfg);
    emgBuffer = createEmgSegmentBuffer(cfg);
    await ensureComputeResourcesBestEffort(ctx, 'init');
  },
  async onEvent(event) {
    if (event.type !== EventTypes.signalBatch || !cfg || !phaseEngine || !emgBuffer) {
      return;
    }

    const payload = event.payload;
    if (!isSignalPayload(payload)) {
      return;
    }

    if (payload.streamId === cfg.emgStreamId) {
      emgBuffer.push(payload);
      return;
    }

    let completedCycles: CompletedCycle[] = [];
    if (payload.streamId === cfg.gyroStreamIds.x) {
      completedCycles = phaseEngine.pushGyro('x', payload);
    } else if (payload.streamId === cfg.gyroStreamIds.y) {
      completedCycles = phaseEngine.pushGyro('y', payload);
    } else if (payload.streamId === cfg.gyroStreamIds.z) {
      completedCycles = phaseEngine.pushGyro('z', payload);
    }

    for (const cycle of completedCycles) {
      await handleCompletedCycle(cycle);
    }

    if (completedCycles.length === 0) {
      const latestTimestampMs = latestPayloadTimestampMs(payload);
      if (latestTimestampMs !== null) {
        const shouldForceZero = cfg !== null
          && lastCompletedCycleEndMs !== null
          && (latestTimestampMs - lastCompletedCycleEndMs) > cfg.maxCyclePeriodMs;
        await maybeEmitPhaseConfidence(
          latestTimestampMs,
          shouldForceZero ? 0 : phaseEngine.currentAxisConfidence(),
        );
      }
    }
  },
  onTimelineResetPrepare: timelineResetParticipant.onPrepare,
  onTimelineResetAbort: timelineResetParticipant.onAbort,
  onTimelineResetCommit: timelineResetParticipant.onCommit,
  async onShutdown() {
    await stopComputeResources();
    cfg = null;
    pluginCtx = null;
    phaseEngine = null;
    emgBuffer = null;
    emitLabels = null;
    emitSignals = null;
    lastPhaseState = null;
    lastActivityState = null;
    thresholdState = {};
    computeAvailable = false;
    lastPhaseConfidenceEmission = null;
    lastCompletedCycleEndMs = null;
    resetManifest();
  },
});
