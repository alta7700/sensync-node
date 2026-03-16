import {
  defineRuntimeEventInput,
  EventTypes,
  type RuntimeEventInputOf,
  type SampleFormat,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import type {
  IrregularSignalTiming,
  LabelSignalTiming,
  LabelSignalValues,
  OutputDescriptor,
  OutputRegistry,
  UniformSignalTiming,
  UniformSignalValues,
} from './types.ts';

export function inferSampleFormat(values: UniformSignalValues): SampleFormat {
  if (values.BYTES_PER_ELEMENT === 4) return 'f32';
  if (values.BYTES_PER_ELEMENT === 8) return 'f64';
  if (values.BYTES_PER_ELEMENT === 2) return 'i16';
  throw new Error('Неподдерживаемый тип values для signal.batch');
}

export function createUniformSignalEvent(
  descriptor: OutputDescriptor,
  values: UniformSignalValues,
  timing: UniformSignalTiming,
): RuntimeEventInputOf<typeof EventTypes.signalBatch, 1> {
  const payload: RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>['payload'] = {
    streamId: descriptor.streamId,
    sampleFormat: inferSampleFormat(values),
    frameKind: 'uniform-signal-batch',
    t0Ms: timing.t0Ms,
    dtMs: timing.dtMs,
    sampleCount: values.length,
    values,
  };

  if (descriptor.units !== undefined) payload.units = descriptor.units;
  if (timing.sampleRateHz !== undefined) payload.sampleRateHz = timing.sampleRateHz;
  else if (timing.dtMs > 0) payload.sampleRateHz = 1000 / timing.dtMs;

  return defineRuntimeEventInput({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    payload,
  });
}

export function createIrregularSignalEvent(
  descriptor: OutputDescriptor,
  values: UniformSignalValues,
  timing: IrregularSignalTiming,
): RuntimeEventInputOf<typeof EventTypes.signalBatch, 1> {
  if (timing.timestampsMs.length !== values.length) {
    throw new Error(`timestampsMs должен совпадать с длиной values для ${descriptor.streamId}`);
  }

  const payload: RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>['payload'] = {
    streamId: descriptor.streamId,
    sampleFormat: inferSampleFormat(values),
    frameKind: 'irregular-signal-batch',
    t0Ms: timing.t0Ms ?? timing.timestampsMs[0] ?? 0,
    sampleCount: values.length,
    values,
    timestampsMs: timing.timestampsMs,
  };

  if (descriptor.units !== undefined) payload.units = descriptor.units;
  if (timing.sampleRateHz !== undefined) payload.sampleRateHz = timing.sampleRateHz;

  return defineRuntimeEventInput({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    payload,
  });
}

export function createLabelSignalEvent(
  descriptor: OutputDescriptor,
  values: LabelSignalValues,
  timing: LabelSignalTiming,
): RuntimeEventInputOf<typeof EventTypes.signalBatch, 1> {
  if (timing.timestampsMs.length !== values.length) {
    throw new Error(`timestampsMs должен совпадать с длиной values для ${descriptor.streamId}`);
  }

  const payload: RuntimeEventInputOf<typeof EventTypes.signalBatch, 1>['payload'] = {
    streamId: descriptor.streamId,
    sampleFormat: inferSampleFormat(values),
    frameKind: 'label-batch',
    t0Ms: timing.timestampsMs[0] ?? 0,
    sampleCount: values.length,
    values,
    timestampsMs: timing.timestampsMs,
  };

  if (descriptor.units !== undefined) payload.units = descriptor.units;

  return defineRuntimeEventInput({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    payload,
  });
}

export function createUniformSignalEmitter<TOutputKey extends string>(
  registry: OutputRegistry<TOutputKey>,
) {
  return {
    createEvent(outputKey: TOutputKey, values: UniformSignalValues, timing: UniformSignalTiming) {
      return createUniformSignalEvent(registry.get(outputKey), values, timing);
    },
    async emit(ctx: PluginContext, outputKey: TOutputKey, values: UniformSignalValues, timing: UniformSignalTiming): Promise<void> {
      await ctx.emit(createUniformSignalEvent(registry.get(outputKey), values, timing));
    },
  };
}

export function createLabelSignalEmitter<TOutputKey extends string>(
  registry: OutputRegistry<TOutputKey>,
) {
  return {
    createEvent(outputKey: TOutputKey, values: LabelSignalValues, timing: LabelSignalTiming) {
      return createLabelSignalEvent(registry.get(outputKey), values, timing);
    },
    async emit(ctx: PluginContext, outputKey: TOutputKey, values: LabelSignalValues, timing: LabelSignalTiming): Promise<void> {
      await ctx.emit(createLabelSignalEvent(registry.get(outputKey), values, timing));
    },
  };
}

export function createIrregularSignalEmitter<TOutputKey extends string>(
  registry: OutputRegistry<TOutputKey>,
) {
  return {
    createEvent(outputKey: TOutputKey, values: UniformSignalValues, timing: IrregularSignalTiming) {
      return createIrregularSignalEvent(registry.get(outputKey), values, timing);
    },
    async emit(ctx: PluginContext, outputKey: TOutputKey, values: UniformSignalValues, timing: IrregularSignalTiming): Promise<void> {
      await ctx.emit(createIrregularSignalEvent(registry.get(outputKey), values, timing));
    },
  };
}
