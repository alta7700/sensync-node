import type {
  DecodedUiSignalFrame,
  UiCommandMessage,
  UiControlMessage,
  UiFlagSnapshot,
  UiFormOption,
  UiSchema,
  UiSessionClockInfo,
  UiStreamDeclaration,
} from '@sensync2/core';

export interface ClientTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendCommand(command: UiCommandMessage): Promise<void>;
  onControl(handler: (message: UiControlMessage) => void): () => void;
  onBinary(handler: (buffer: ArrayBuffer) => void): () => void;
}

export interface StreamWindowData {
  x: Float64Array;
  y: Float32Array;
  length: number;
}

export interface ClientRuntimeNotification {
  id: string;
  level: 'error';
  code: string;
  message: string;
  pluginId?: string;
  createdAtMs: number;
}

export interface ClientRuntimeStateSnapshot {
  connected: boolean;
  sessionId?: string;
  clock?: UiSessionClockInfo;
  schema?: UiSchema;
  flags: UiFlagSnapshot;
  streams: UiStreamDeclaration[];
  formOptions: Record<string, UiFormOption[]>;
  notifications: ClientRuntimeNotification[];
  telemetry?: Extract<UiControlMessage, { type: 'ui.telemetry' }>;
}

export interface StreamBufferStore {
  ensureStream(stream: UiStreamDeclaration): void;
  appendFrame(stream: UiStreamDeclaration, frame: DecodedUiSignalFrame): void;
  getVisibleWindow(streamId: string, rangeMs: number, endMs?: number): StreamWindowData;
  getLatestTime(streamId: string): number | null;
  clear(): void;
}
