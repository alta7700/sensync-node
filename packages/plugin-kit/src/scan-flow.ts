import {
  defineRuntimeEventInput,
  EventTypes,
  type AdapterScanRequestPayload,
  type RuntimeEventInputOf,
} from '@sensync2/core';
import type { PluginContext } from '@sensync2/plugin-sdk';
import type {
  ScanFlowCandidateInput,
  ScanFlowResolvedCandidate,
} from './types.ts';

interface CreateScanFlowOptions {
  adapterId: string;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

export function createScanFlow<TCandidateData>(options: CreateScanFlowOptions) {
  let scanSequence = 0;
  const candidateDataById = new Map<string, TCandidateData>();

  function clearCandidates(): void {
    candidateDataById.clear();
  }

  function nextScanId(): string {
    scanSequence += 1;
    return `${options.adapterId}-scan-${scanSequence}`;
  }

  function createScanStateEvent(
    scanning: boolean,
    requestId?: string,
    scanId?: string,
    message?: string,
  ): RuntimeEventInputOf<typeof EventTypes.adapterScanStateChanged, 1> {
    const payload: RuntimeEventInputOf<typeof EventTypes.adapterScanStateChanged, 1>['payload'] = {
      adapterId: options.adapterId,
      scanning,
    };
    if (requestId !== undefined) payload.requestId = requestId;
    if (scanId !== undefined) payload.scanId = scanId;
    if (message !== undefined) payload.message = message;
    return defineRuntimeEventInput({
      type: EventTypes.adapterScanStateChanged,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload,
    });
  }

  function createCandidatesEvent(
    scanId: string,
    candidates: ScanFlowResolvedCandidate[],
    requestId?: string,
  ): RuntimeEventInputOf<typeof EventTypes.adapterScanCandidates, 1> {
    const payload: RuntimeEventInputOf<typeof EventTypes.adapterScanCandidates, 1>['payload'] = {
      adapterId: options.adapterId,
      scanId,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        title: candidate.title,
        ...(candidate.subtitle !== undefined ? { subtitle: candidate.subtitle } : {}),
        ...(candidate.details !== undefined ? { details: candidate.details } : {}),
        connectFormData: { candidateId: candidate.candidateId },
      })),
    };
    if (requestId !== undefined) payload.requestId = requestId;
    return defineRuntimeEventInput({
      type: EventTypes.adapterScanCandidates,
      v: 1,
      kind: 'fact',
      priority: 'system',
      payload,
    });
  }

  return {
    clearCandidates,
    getCandidateData(candidateId: string): TCandidateData | null {
      return candidateDataById.get(candidateId) ?? null;
    },
    createScanStateEvent,
    createCandidatesEvent,
    async handleScanRequest(
      ctx: PluginContext,
      payload: AdapterScanRequestPayload,
      scanHandler: (payload: AdapterScanRequestPayload) => Promise<readonly ScanFlowCandidateInput<TCandidateData>[]>,
    ): Promise<{ scanId: string; candidates: ScanFlowResolvedCandidate[] }> {
      clearCandidates();
      await ctx.emit(createScanStateEvent(true, payload.requestId));
      try {
        const scanId = nextScanId();
        const rawCandidates = await scanHandler(payload);
        const candidates = rawCandidates.map((candidate, index) => {
          const candidateId = `${scanId}-candidate-${index + 1}`;
          candidateDataById.set(candidateId, candidate.data);
          return {
            candidateId,
            title: candidate.title,
            ...(candidate.subtitle !== undefined ? { subtitle: candidate.subtitle } : {}),
            ...(candidate.details !== undefined ? { details: candidate.details } : {}),
          };
        });
        await ctx.emit(createCandidatesEvent(scanId, candidates, payload.requestId));
        await ctx.emit(createScanStateEvent(false, payload.requestId, scanId));
        return { scanId, candidates };
      } catch (error) {
        await ctx.emit(createScanStateEvent(false, payload.requestId, undefined, normalizeError(error)));
        throw error;
      }
    },
  };
}
