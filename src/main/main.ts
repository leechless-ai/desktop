import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessManager, type RuntimeMode, type StartOptions } from './process-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = Boolean(process.env['VITE_DEV_SERVER_URL']);
const rendererUrl = process.env['VITE_DEV_SERVER_URL'] ?? `file://${path.join(__dirname, '../renderer/index.html')}`;

type LogEvent = {
  mode: RuntimeMode;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  timestamp: number;
};

let mainWindow: BrowserWindow | null = null;
const logBuffer: LogEvent[] = [];

const processManager = new ProcessManager((mode, stream, line) => {
  const event: LogEvent = { mode, stream, line, timestamp: Date.now() };
  logBuffer.push(event);
  if (logBuffer.length > 1200) {
    logBuffer.splice(0, logBuffer.length - 1200);
  }
  mainWindow?.webContents.send('runtime:log', event);
  mainWindow?.webContents.send('runtime:state', processManager.getState());
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'Leechless Desktop',
    backgroundColor: '#0c1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(rendererUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('runtime:get-state', async () => {
  return {
    processes: processManager.getState(),
    daemonState: processManager.getDaemonStateSnapshot(),
    logs: [...logBuffer],
  };
});

ipcMain.handle('runtime:start', async (_event, options: StartOptions) => {
  const state = await processManager.start(options);
  return {
    state,
    processes: processManager.getState(),
    daemonState: processManager.getDaemonStateSnapshot(),
  };
});

ipcMain.handle('runtime:stop', async (_event, mode: RuntimeMode) => {
  const state = await processManager.stop(mode);
  return {
    state,
    processes: processManager.getState(),
    daemonState: processManager.getDaemonStateSnapshot(),
  };
});

ipcMain.handle('runtime:open-dashboard', async (_event, port?: number) => {
  const safePort = Number.isFinite(port) ? Number(port) : 3117;
  await shell.openExternal(`http://127.0.0.1:${safePort}`);
  return { ok: true };
});

ipcMain.handle('runtime:clear-logs', async () => {
  logBuffer.length = 0;
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void processManager.stopAll().finally(() => app.quit());
  }
});

app.on('before-quit', (event) => {
  if ((app as unknown as { __leechlessStopping?: boolean }).__leechlessStopping) {
    return;
  }

  event.preventDefault();
  (app as unknown as { __leechlessStopping?: boolean }).__leechlessStopping = true;

  void processManager.stopAll().finally(() => {
    app.quit();
  });
});
