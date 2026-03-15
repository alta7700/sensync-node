import type {
  FactInputDescriptor,
  InputDescriptor,
  InputDescriptorInput,
  InputMap,
  InputMapDefinition,
  SignalInputDescriptor,
} from './types.ts';

function normalizeSignalInput<TInputKey extends string>(
  inputKey: TInputKey,
  descriptor: SignalInputDescriptor,
): SignalInputDescriptor {
  const streamId = descriptor.streamId.trim();
  if (streamId.length === 0) {
    throw new Error(`Input "${inputKey}" должен содержать непустой streamId`);
  }
  if (!(descriptor.retain.value > 0)) {
    throw new Error(`Input "${inputKey}" должен содержать retain.value > 0`);
  }
  return {
    kind: 'signal',
    streamId,
    retain: {
      by: descriptor.retain.by,
      value: descriptor.retain.value,
    },
  };
}

function normalizeFactInput<TInputKey extends string>(
  inputKey: TInputKey,
  descriptor: FactInputDescriptor,
): FactInputDescriptor {
  const type = descriptor.event.type.trim();
  if (type.length === 0) {
    throw new Error(`Input "${inputKey}" должен содержать непустой event.type`);
  }
  if (!(descriptor.event.v > 0)) {
    throw new Error(`Input "${inputKey}" должен содержать event.v > 0`);
  }
  return {
    kind: 'fact',
    event: {
      type,
      v: descriptor.event.v,
    },
    retain: 'latest',
  };
}

function normalizeInputDescriptor<TInputKey extends string>(
  inputKey: TInputKey,
  descriptor: InputDescriptorInput,
): InputDescriptor {
  if (descriptor.kind === 'signal') {
    return normalizeSignalInput(inputKey, descriptor);
  }
  return normalizeFactInput(inputKey, descriptor);
}

export function signalInput(options: {
  streamId: string;
  retain: { by: 'samples' | 'durationMs'; value: number };
}): SignalInputDescriptor {
  return {
    kind: 'signal',
    streamId: options.streamId,
    retain: options.retain,
  };
}

export function factInput(options: {
  event: { type: string; v: number };
  retain?: 'latest';
}): FactInputDescriptor {
  return {
    kind: 'fact',
    event: options.event,
    retain: options.retain ?? 'latest',
  };
}

export function createInputMap<TInputKey extends string>(
  definition: InputMapDefinition<TInputKey>,
): InputMap<TInputKey> {
  const entries = Object.entries(definition) as Array<[TInputKey, InputDescriptorInput]>;
  const normalized = new Map<TInputKey, InputDescriptor>();
  const usedSignalStreamIds = new Set<string>();
  const usedFactEventRefs = new Set<string>();

  for (const [inputKey, descriptor] of entries) {
    const normalizedDescriptor = normalizeInputDescriptor(inputKey, descriptor);
    if (normalizedDescriptor.kind === 'signal') {
      if (usedSignalStreamIds.has(normalizedDescriptor.streamId)) {
        throw new Error(`streamId "${normalizedDescriptor.streamId}" повторяется в input-map`);
      }
      usedSignalStreamIds.add(normalizedDescriptor.streamId);
    } else {
      const factKey = `${normalizedDescriptor.event.type}@${normalizedDescriptor.event.v}`;
      if (usedFactEventRefs.has(factKey)) {
        throw new Error(`fact input "${factKey}" повторяется в input-map`);
      }
      usedFactEventRefs.add(factKey);
    }
    normalized.set(inputKey, normalizedDescriptor);
  }

  return {
    has(inputKey) {
      return normalized.has(inputKey);
    },
    get(inputKey) {
      const descriptor = normalized.get(inputKey);
      if (!descriptor) {
        throw new Error(`Input "${inputKey}" не зарегистрирован`);
      }
      return descriptor;
    },
    entries() {
      return [...normalized.entries()];
    },
    signalEntries() {
      return [...normalized.entries()].filter((entry): entry is [TInputKey, SignalInputDescriptor] => entry[1].kind === 'signal');
    },
    factEntries() {
      return [...normalized.entries()].filter((entry): entry is [TInputKey, FactInputDescriptor] => entry[1].kind === 'fact');
    },
  };
}
