import type { UiCommandMessage, UiControlMessage } from '@sensync2/core';
import type { ClientTransport } from '@sensync2/client-runtime';

export class ElectronBridgeTransport implements ClientTransport {
  private bridge = window.sensyncBridge;

  async connect(): Promise<void> {
    if (!this.bridge) {
      throw new Error('Electron bridge недоступен. Откройте UI внутри Electron.');
    }
    await this.bridge.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.bridge) return;
    await this.bridge.disconnect();
  }

  async sendCommand(command: UiCommandMessage): Promise<void> {
    if (!this.bridge) {
      throw new Error('Electron bridge недоступен');
    }
    await this.bridge.sendCommand(command);
  }

  onControl(handler: (message: UiControlMessage) => void): () => void {
    if (!this.bridge) return () => {};
    return this.bridge.onControl(handler);
  }

  onBinary(handler: (buffer: ArrayBuffer) => void): () => void {
    if (!this.bridge) return () => {};
    return this.bridge.onBinary(handler);
  }
}
