import {
  defineRuntimeEventInput,
  EventTypes,
  type AdapterStateChangedPayload,
  type CommandEvent,
  type SignalBatchEvent,
} from '@sensync2/core';

export function adapterStateEvent(
  adapterId: string,
  state: AdapterStateChangedPayload['state'],
  message?: string,
  requestId?: string,
){
  const payload: AdapterStateChangedPayload = { adapterId, state };
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return defineRuntimeEventInput({
    type: EventTypes.adapterStateChanged,
    v: 1,
    kind: 'fact',
    priority: 'system',
    payload,
  });
}

export function commandPayload<T>(event: CommandEvent<T>): T {
  return event.payload;
}

export function signalBatchEvent(
  streamId: string,
  values: Float32Array | Int16Array,
  t0Ms: number,
  dtMs: number,
  sampleFormat: 'f32' | 'i16' = 'f32',
  units?: string,
): Omit<SignalBatchEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: SignalBatchEvent['payload'] = {
    streamId,
    sampleFormat,
    frameKind: 'uniform-signal-batch',
    t0Ms,
    dtMs,
    sampleCount: values.length,
    values,
  };
  if (units !== undefined) payload.units = units;
  if (dtMs > 0) payload.sampleRateHz = 1000 / dtMs;
  return defineRuntimeEventInput({
    type: EventTypes.signalBatch,
    v: 1,
    kind: 'data',
    priority: 'data',
    payload,
  });
}
