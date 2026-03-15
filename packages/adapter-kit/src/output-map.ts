import type {
  OutputDescriptor,
  OutputDescriptorInput,
  OutputRegistry,
  OutputRegistryDefinition,
} from './types.ts';

function normalizeOutputDescriptor<TOutputKey extends string>(
  outputKey: TOutputKey,
  input: OutputDescriptorInput,
): OutputDescriptor {
  const descriptor = typeof input === 'string' ? { streamId: input } : { ...input };
  const streamId = descriptor.streamId.trim();
  if (streamId.length === 0) {
    throw new Error(`Output "${outputKey}" должен содержать непустой streamId`);
  }

  const normalized: OutputDescriptor = { streamId };
  if (descriptor.units !== undefined) {
    const units = descriptor.units.trim();
    if (units.length === 0) {
      throw new Error(`Output "${outputKey}" не может содержать пустой units`);
    }
    normalized.units = units;
  }
  return normalized;
}

export function createOutputRegistry<TOutputKey extends string>(
  definition: OutputRegistryDefinition<TOutputKey>,
): OutputRegistry<TOutputKey> {
  const entries = Object.entries(definition) as Array<[TOutputKey, OutputDescriptorInput]>;
  const normalized = new Map<TOutputKey, OutputDescriptor>();
  const usedStreamIds = new Set<string>();

  for (const [outputKey, input] of entries) {
    const descriptor = normalizeOutputDescriptor(outputKey, input);
    if (usedStreamIds.has(descriptor.streamId)) {
      throw new Error(`streamId "${descriptor.streamId}" повторяется в output-map`);
    }
    usedStreamIds.add(descriptor.streamId);
    normalized.set(outputKey, descriptor);
  }

  return {
    has(outputKey) {
      return normalized.has(outputKey);
    },
    get(outputKey) {
      const descriptor = normalized.get(outputKey);
      if (!descriptor) {
        throw new Error(`Output "${outputKey}" не зарегистрирован`);
      }
      return descriptor;
    },
    entries() {
      return [...normalized.entries()];
    },
  };
}
