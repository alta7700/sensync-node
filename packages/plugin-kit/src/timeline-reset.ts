import type { SignalBatchPayload } from '@sensync2/core';
import type {
  TimelineClipResult,
  TimelineResetParticipantController,
  TimelineResetParticipantOptions,
} from './types.ts';

function sliceTypedArray<TArray extends Float32Array | Float64Array | Int16Array | Uint8Array>(
  values: TArray,
  start: number,
): TArray {
  return values.slice(start) as TArray;
}

export function createTimelineResetParticipant(
  options: TimelineResetParticipantOptions = {},
): TimelineResetParticipantController {
  let timelineId = 'timeline-initializing';
  let phase: 'running' | 'preparing' | 'committing' = 'running';

  return {
    initialize(nextTimelineId) {
      timelineId = nextTimelineId;
      phase = 'running';
    },
    currentTimelineId() {
      return timelineId;
    },
    phase() {
      return phase;
    },
    bindEmit(ctx) {
      return async (event) => {
        if (phase === 'preparing') {
          throw new Error('Timeline reset participant не может emit во время prepare');
        }
        await ctx.emit(event);
      };
    },
    async onPrepare(input, ctx) {
      phase = 'preparing';
      for (const resource of options.resources ?? []) {
        await resource.prepare?.();
      }
      await options.onPrepare?.(input, ctx);
    },
    async onAbort(input, ctx) {
      try {
        for (const resource of options.resources ?? []) {
          await resource.abort?.();
        }
        await options.onAbort?.(input, ctx);
      } finally {
        phase = 'running';
      }
    },
    async onCommit(input, ctx) {
      phase = 'committing';
      timelineId = input.nextTimelineId;
      try {
        for (const resource of options.resources ?? []) {
          await resource.commit?.();
        }
        await options.onCommit?.(input, ctx);
      } finally {
        phase = 'running';
      }
    },
  };
}

export function clipSignalBatchToTimelineStart(
  payload: SignalBatchPayload,
  cutoffSessionMs: number,
): TimelineClipResult {
  if (payload.sampleCount <= 0) {
    return { kind: 'drop' };
  }

  if (payload.frameKind === 'uniform-signal-batch') {
    const dtMs = payload.dtMs ?? 0;
    if (!(dtMs > 0)) {
      return payload.t0Ms >= cutoffSessionMs ? { kind: 'keep', payload } : { kind: 'drop' };
    }

    let startIndex = 0;
    while (startIndex < payload.sampleCount && (payload.t0Ms + dtMs * startIndex) < cutoffSessionMs) {
      startIndex += 1;
    }
    if (startIndex >= payload.sampleCount) {
      return { kind: 'drop' };
    }
    if (startIndex === 0) {
      return { kind: 'keep', payload };
    }

    const nextPayload: SignalBatchPayload = {
      ...payload,
      t0Ms: payload.t0Ms + dtMs * startIndex,
      sampleCount: payload.sampleCount - startIndex,
      values: sliceTypedArray(payload.values, startIndex),
    };
    if (payload.flags) {
      nextPayload.flags = sliceTypedArray(payload.flags, startIndex);
    }
    return { kind: 'keep', payload: nextPayload };
  }

  const timestampsMs = payload.timestampsMs;
  if (!timestampsMs) {
    return payload.t0Ms >= cutoffSessionMs ? { kind: 'keep', payload } : { kind: 'drop' };
  }

  let startIndex = 0;
  while (startIndex < payload.sampleCount && timestampsMs[startIndex]! < cutoffSessionMs) {
    startIndex += 1;
  }
  if (startIndex >= payload.sampleCount) {
    return { kind: 'drop' };
  }
  if (startIndex === 0) {
    const keptPayload: SignalBatchPayload = { ...payload };
    delete keptPayload.sampleRateHz;
    delete keptPayload.dtMs;
    keptPayload.t0Ms = timestampsMs[0] ?? payload.t0Ms;
    return { kind: 'keep', payload: keptPayload };
  }

  const nextPayload: SignalBatchPayload = {
    ...payload,
    t0Ms: timestampsMs[startIndex] ?? payload.t0Ms,
    sampleCount: payload.sampleCount - startIndex,
    values: sliceTypedArray(payload.values, startIndex),
    timestampsMs: sliceTypedArray(timestampsMs, startIndex),
  };
  if (payload.flags) {
    nextPayload.flags = sliceTypedArray(payload.flags, startIndex);
  }
  delete nextPayload.dtMs;
  delete nextPayload.sampleRateHz;
  return { kind: 'keep', payload: nextPayload };
}
