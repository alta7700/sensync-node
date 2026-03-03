import type { UiCommandMessage, UiControlMessage } from '@sensync2/core';

declare global {
  interface Window {
    sensyncBridge?: {
      connect(): Promise<{ clientId: string }>;
      disconnect(): Promise<void>;
      sendCommand(command: UiCommandMessage): Promise<void>;
      onControl(handler: (message: UiControlMessage) => void): () => void;
      onBinary(handler: (buffer: ArrayBuffer) => void): () => void;
      getRuntimePlugins(): Promise<unknown>;
    };
  }
}

export {};
