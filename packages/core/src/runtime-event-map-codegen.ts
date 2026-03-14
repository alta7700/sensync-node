import type { EventKind, EventPriority } from './events.ts';

export type RuntimeEventPayloadTypeRef =
  | {
    kind: 'named';
    importPath: string;
    typeName: string;
  }
  | {
    kind: 'inline';
    typeText: string;
  };

export type RuntimeEventMapCodegenEntry =
  | {
    alias: string;
    mode: 'compose';
    envelope: 'command' | 'fact';
    type: string;
    v: number;
    kind: EventKind;
    priority: EventPriority;
    payload: RuntimeEventPayloadTypeRef;
  }
  | {
    alias: string;
    mode: 'reference';
    type: string;
    v: number;
    importPath: string;
    typeName: string;
  };

export interface RuntimeEventMapCodegenSpec {
  moduleToAugment: string;
  coreImportPath: string;
  outputFilePath: string;
  entries: RuntimeEventMapCodegenEntry[];
}
