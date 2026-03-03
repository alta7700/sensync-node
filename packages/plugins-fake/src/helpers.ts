import { EventTypes, type AdapterStateChangedPayload, type CommandEvent, type FactEvent, type SignalBatchEvent } from '@sensync2/core';

export function adapterStateEvent(
  adapterId: string,
  state: AdapterStateChangedPayload['state'],
  message?: string,
  requestId?: string,
): Omit<FactEvent<AdapterStateChangedPayload>, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: AdapterStateChangedPayload = { adapterId, state };
  if (message !== undefined) payload.message = message;
  if (requestId !== undefined) payload.requestId = requestId;
  return {
    type: EventTypes.adapterStateChanged,
    kind: 'fact',
    priority: 'system',
    payload,
  };
}

export function commandPayload<T>(event: CommandEvent<T>): T {
  return event.payload;
}

export function signalBatchEvent(
  streamId: string,
  channelId: string,
  values: Float32Array | Int16Array,
  t0Ms: number,
  dtMs: number,
  sampleFormat: 'f32' | 'i16' = 'f32',
  units?: string,
): Omit<SignalBatchEvent, 'seq' | 'tsMonoMs' | 'sourcePluginId'> {
  const payload: SignalBatchEvent['payload'] = {
    streamId,
    channelId,
    sampleFormat,
    frameKind: 'uniform-signal-batch',
    t0Ms,
    dtMs,
    sampleCount: values.length,
    values,
  };
  if (units !== undefined) payload.units = units;
  if (dtMs > 0) payload.sampleRateHz = 1000 / dtMs;
  return {
    type: 'signal.batch',
    kind: 'data',
    priority: 'data',
    payload,
  };
}
