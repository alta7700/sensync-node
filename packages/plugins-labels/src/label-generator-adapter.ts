import {
  EventTypes,
  defineRuntimeEventInput,
  type CommandRejectedPayload,
  type LabelMarkRequestPayload,
} from '@sensync2/core';
import {
  createLabelSignalEmitter,
  createOutputRegistry,
} from '@sensync2/plugin-kit';
import { definePlugin, type PluginContext } from '@sensync2/plugin-sdk';

export interface LabelOutputConfig {
  streamId: string;
  sampleFormat: 'i16' | 'f32';
  units?: string;
}

export interface LabelGeneratorAdapterConfig {
  labels: Record<string, LabelOutputConfig>;
}

export const DefaultLabelGeneratorAdapterConfig: LabelGeneratorAdapterConfig = {
  labels: {},
};

type NormalizedLabelOutputConfig = LabelOutputConfig;

let config: LabelGeneratorAdapterConfig = DefaultLabelGeneratorAdapterConfig;
let labelEmitter: ReturnType<typeof createLabelSignalEmitter<string>> | null = null;
let labelSampleFormats = new Map<string, LabelOutputConfig['sampleFormat']>();
const lastTimestampByLabelId = new Map<string, number>();

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
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

function normalizeLabelOutputConfig(labelId: string, input: unknown): NormalizedLabelOutputConfig {
  if (!isRecord(input)) {
    throw new Error(`Конфиг label "${labelId}" должен быть объектом`);
  }

  const streamId = trimRequiredString(input.streamId, `labels.${labelId}.streamId`);
  const sampleFormat = input.sampleFormat;
  if (sampleFormat !== 'i16' && sampleFormat !== 'f32') {
    throw new Error(`labels.${labelId}.sampleFormat должен быть "i16" или "f32"`);
  }

  const normalized: NormalizedLabelOutputConfig = {
    streamId,
    sampleFormat,
  };

  if (input.units !== undefined) {
    normalized.units = trimRequiredString(input.units, `labels.${labelId}.units`);
  }

  return normalized;
}

export function resolveLabelGeneratorAdapterConfig(input: unknown): LabelGeneratorAdapterConfig {
  const rawConfig = isRecord(input) ? input : {};
  const rawLabels = rawConfig.labels;
  if (!isRecord(rawLabels)) {
    throw new Error('Конфиг label-generator-adapter должен содержать объект labels');
  }

  const normalizedLabels: Record<string, NormalizedLabelOutputConfig> = {};
  for (const [rawLabelId, rawLabelConfig] of Object.entries(rawLabels)) {
    const labelId = rawLabelId.trim();
    if (labelId.length === 0) {
      throw new Error('labelId в labels не может быть пустым');
    }
    if (normalizedLabels[labelId]) {
      throw new Error(`labelId "${labelId}" повторяется в labels`);
    }
    normalizedLabels[labelId] = normalizeLabelOutputConfig(labelId, rawLabelConfig);
  }

  if (Object.keys(normalizedLabels).length === 0) {
    throw new Error('label-generator-adapter должен содержать хотя бы один label output');
  }

  return { labels: normalizedLabels };
}

function emitRejectedMarkMetric(ctx: PluginContext, reason: string, labelId: string): void {
  ctx.telemetry({
    name: 'label_mark_rejected_total',
    value: 1,
    tags: { reason, labelId },
  });
}

async function emitRejectedMark(
  ctx: PluginContext,
  payload: LabelMarkRequestPayload,
  code: string,
  message: string,
): Promise<void> {
  emitRejectedMarkMetric(ctx, code, payload.labelId);

  const rejectedPayload: CommandRejectedPayload = {
    commandType: EventTypes.labelMarkRequest,
    commandVersion: 1,
    code,
    message,
    ...(payload.requestId !== undefined ? { requestId: payload.requestId } : {}),
    details: {
      labelId: payload.labelId,
    },
  };

  await ctx.emit(defineRuntimeEventInput({
    type: EventTypes.commandRejected,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload: rejectedPayload,
  }));
}

function toLabelValues(
  sampleFormat: LabelOutputConfig['sampleFormat'],
  value: number,
): Int16Array | Float32Array | null {
  if (sampleFormat === 'f32') {
    return new Float32Array([value]);
  }

  if (!Number.isInteger(value) || value < -32768 || value > 32767) {
    return null;
  }
  return new Int16Array([value]);
}

function resolveMarkTimeMs(payload: LabelMarkRequestPayload, ctx: PluginContext): number {
  return payload.atTimeMs ?? ctx.clock.nowSessionMs();
}

export default definePlugin({
  manifest: {
    id: 'label-generator-adapter',
    version: '0.1.0',
    required: true,
    subscriptions: [
      { type: EventTypes.labelMarkRequest, v: 1, kind: 'command', priority: 'control' },
    ],
    mailbox: {
      controlCapacity: 128,
      dataCapacity: 32,
      dataPolicy: 'fail-fast',
    },
    emits: [
      { type: EventTypes.signalBatch, v: 1 },
      { type: EventTypes.commandRejected, v: 1 },
    ],
  },
  async onInit(ctx) {
    config = resolveLabelGeneratorAdapterConfig(ctx.getConfig<LabelGeneratorAdapterConfig>());

    labelEmitter = createLabelSignalEmitter(createOutputRegistry(
      Object.fromEntries(
        Object.entries(config.labels).map(([labelId, labelConfig]) => [
          labelId,
          {
            streamId: labelConfig.streamId,
            ...(labelConfig.units !== undefined ? { units: labelConfig.units } : {}),
          },
        ]),
      ),
    ));

    labelSampleFormats = new Map(
      Object.entries(config.labels).map(([labelId, labelConfig]) => [labelId, labelConfig.sampleFormat]),
    );
    lastTimestampByLabelId.clear();
  },
  async onEvent(event, ctx) {
    if (event.type !== EventTypes.labelMarkRequest || !labelEmitter) {
      return;
    }

    const payload = event.payload;
    const sampleFormat = labelSampleFormats.get(payload.labelId);
    if (!sampleFormat) {
      await emitRejectedMark(ctx, payload, 'unknown_label', `Label "${payload.labelId}" не найден в конфиге`);
      return;
    }

    const markTimeMs = resolveMarkTimeMs(payload, ctx);
    if (!Number.isFinite(markTimeMs) || markTimeMs < 0) {
      await emitRejectedMark(ctx, payload, 'invalid_timestamp', 'Метка имеет некорректное session time');
      return;
    }

    const previousTimestamp = lastTimestampByLabelId.get(payload.labelId);
    if (previousTimestamp !== undefined && markTimeMs < previousTimestamp) {
      await emitRejectedMark(
        ctx,
        payload,
        'non_monotonic_timestamp',
        `Метка "${payload.labelId}" пришла раньше предыдущей по session time`,
      );
      return;
    }

    const values = toLabelValues(sampleFormat, payload.value);
    if (!values) {
      await emitRejectedMark(
        ctx,
        payload,
        'invalid_value_for_sample_format',
        `Значение ${String(payload.value)} не помещается в sampleFormat "${sampleFormat}"`,
      );
      return;
    }

    // Храним отдельную временную шкалу по каждому labelId, чтобы один поток не ломал другой.
    lastTimestampByLabelId.set(payload.labelId, markTimeMs);
    await labelEmitter.emit(
      ctx,
      payload.labelId,
      values,
      { timestampsMs: new Float64Array([markTimeMs]) },
    );
  },
  async onShutdown() {
    config = DefaultLabelGeneratorAdapterConfig;
    labelEmitter = null;
    labelSampleFormats.clear();
    lastTimestampByLabelId.clear();
  },
});
