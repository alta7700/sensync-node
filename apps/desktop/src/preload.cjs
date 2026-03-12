const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload bridge минимален: renderer получает только методы транспорта.
 * Это сохраняет разделение UI и runtime даже внутри Electron.
 */
contextBridge.exposeInMainWorld('sensyncBridge', {
  async connect() {
    return ipcRenderer.invoke('sensync:connect');
  },
  async disconnect() {
    return ipcRenderer.invoke('sensync:disconnect');
  },
  async sendCommand(command) {
    return ipcRenderer.invoke('sensync:ui-command', command);
  },
  onControl(handler) {
    const wrapped = (_event, message) => handler(message);
    ipcRenderer.on('sensync:ui-control', wrapped);
    return () => ipcRenderer.removeListener('sensync:ui-control', wrapped);
  },
  onBinary(handler) {
    const wrapped = (_event, payload) => {
      if (payload instanceof ArrayBuffer) {
        handler(payload);
        return;
      }
      if (ArrayBuffer.isView(payload)) {
        const view = payload;
        handler(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
        return;
      }
      if (Buffer.isBuffer(payload)) {
        const ab = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        handler(ab);
      }
    };
    ipcRenderer.on('sensync:ui-binary', wrapped);
    return () => ipcRenderer.removeListener('sensync:ui-binary', wrapped);
  },
  async getRuntimePlugins() {
    return ipcRenderer.invoke('sensync:get-runtime-plugins');
  },
  async pickPath(options) {
    return ipcRenderer.invoke('sensync:pick-path', options);
  },
});
