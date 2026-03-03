export class ElectronBridgeTransport {
    bridge = window.sensyncBridge;
    async connect() {
        if (!this.bridge) {
            throw new Error('Electron bridge недоступен. Откройте UI внутри Electron.');
        }
        await this.bridge.connect();
    }
    async disconnect() {
        if (!this.bridge)
            return;
        await this.bridge.disconnect();
    }
    async sendCommand(command) {
        if (!this.bridge) {
            throw new Error('Electron bridge недоступен');
        }
        await this.bridge.sendCommand(command);
    }
    onControl(handler) {
        if (!this.bridge)
            return () => { };
        return this.bridge.onControl(handler);
    }
    onBinary(handler) {
        if (!this.bridge)
            return () => { };
        return this.bridge.onBinary(handler);
    }
}
