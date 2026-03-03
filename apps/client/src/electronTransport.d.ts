import type { UiCommandMessage, UiControlMessage } from '@sensync2/core';
import type { ClientTransport } from '@sensync2/client-runtime';
export declare class ElectronBridgeTransport implements ClientTransport {
    private bridge;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendCommand(command: UiCommandMessage): Promise<void>;
    onControl(handler: (message: UiControlMessage) => void): () => void;
    onBinary(handler: (buffer: ArrayBuffer) => void): () => void;
}
