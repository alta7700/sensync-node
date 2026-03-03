import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { UiCommandMessage } from '@sensync2/core';
import { RuntimeHost, makeDefaultPluginDescriptors } from '@sensync2/runtime';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(__dirname, 'preload.cjs');

const clientWindows = new Map<string, Electron.WebContents>();
let runtime: RuntimeHost | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcastControl(message: unknown, clientId?: string): void {
  if (clientId) {
    const wc = clientWindows.get(clientId);
    if (wc && !wc.isDestroyed()) {
      wc.send('sensync:ui-control', message);
    }
    return;
  }
  for (const wc of clientWindows.values()) {
    if (!wc.isDestroyed()) {
      wc.send('sensync:ui-control', message);
    }
  }
}

function broadcastBinary(data: ArrayBuffer, clientId?: string): void {
  const payload = Buffer.from(data);
  if (clientId) {
    const wc = clientWindows.get(clientId);
    if (wc && !wc.isDestroyed()) {
      wc.send('sensync:ui-binary', payload);
    }
    return;
  }
  for (const wc of clientWindows.values()) {
    if (!wc.isDestroyed()) {
      wc.send('sensync:ui-binary', payload);
    }
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1440,
    height: 980,
    backgroundColor: '#0d1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  const rendererUrl = process.env.SENSYNC2_RENDERER_URL ?? 'http://localhost:5173';

  // В dev режиме Vite может быть уже "ready", но HTTP еще не принять первый запрос.
  // Несколько коротких ретраев убирают случайный ERR_CONNECTION_REFUSED на старте.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await win.loadURL(rendererUrl);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 20) {
        await sleep(200);
      }
    }
  }
  if (lastError) {
    throw lastError;
  }

  win.webContents.on('destroyed', () => {
    const clientId = String(win.webContents.id);
    clientWindows.delete(clientId);
    if (runtime) {
      void runtime.detachUiClient(clientId);
    }
  });

  return win;
}

async function setupIpc(): Promise<void> {
  ipcMain.handle('sensync:connect', async (event) => {
    const clientId = String(event.sender.id);
    clientWindows.set(clientId, event.sender);
    await runtime?.attachUiClient(clientId);
    return { clientId };
  });

  ipcMain.handle('sensync:disconnect', async (event) => {
    const clientId = String(event.sender.id);
    clientWindows.delete(clientId);
    await runtime?.detachUiClient(clientId);
  });

  ipcMain.handle('sensync:ui-command', async (event, message: UiCommandMessage) => {
    const clientId = String(event.sender.id);
    await runtime?.sendUiCommand(message, clientId);
  });

  ipcMain.handle('sensync:get-runtime-plugins', async () => {
    return runtime?.listPlugins() ?? [];
  });
}

async function boot(): Promise<void> {
  runtime = new RuntimeHost({
    plugins: makeDefaultPluginDescriptors(),
    uiSinks: {
      onControl(payload) {
        broadcastControl(payload.message, payload.clientId);
      },
      onBinary(payload) {
        broadcastBinary(payload.data, payload.clientId);
      },
    },
  });

  await runtime.start();
  await setupIpc();
  await createMainWindow();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (runtime) {
    await runtime.stop();
    runtime = null;
  }
});

app.whenReady().then(() => {
  void boot().catch((error) => {
    console.error('[desktop] Ошибка запуска:', error);
    app.exit(1);
  });
});
