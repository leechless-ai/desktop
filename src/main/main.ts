import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDashboardServer, type DashboardConfig, type DashboardServer } from '../../../dashboard/dist/index.js';
import {
  ProcessManager,
  type RuntimeMode,
  type RuntimeProcessState,
  type StartOptions,
} from './process-manager.js';

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

type DashboardNetworkPeer = {
  peerId: string;
  host: string;
  port: number;
  providers: string[];
  pricePerToken: number;
  capacityMsgPerHour: number;
  reputation: number;
  lastSeen: number;
  source: 'dht' | 'daemon';
};

type DashboardNetworkStats = {
  totalPeers: number;
  dhtNodeCount: number;
  dhtHealthy: boolean;
  lastScanAt: number | null;
  totalLookups?: number;
  successfulLookups?: number;
  lookupSuccessRate?: number;
  averageLookupLatencyMs?: number;
  healthReason?: string;
};

type DashboardNetworkSnapshot = {
  peers: DashboardNetworkPeer[];
  stats: DashboardNetworkStats;
};

type DashboardNetworkResult = {
  ok: boolean;
  peers: DashboardNetworkPeer[];
  stats: DashboardNetworkStats;
  error: string | null;
};

type DashboardEndpoint = 'status' | 'network' | 'peers' | 'sessions' | 'earnings' | 'config' | 'data-sources';

type DashboardQueryValue = string | number | boolean;

type DashboardApiResult = {
  ok: boolean;
  data: unknown | null;
  error: string | null;
  status: number | null;
};

type DashboardRuntimeState = {
  running: boolean;
  port: number;
  startedAt: number | null;
  lastError: string | null;
  lastExitCode: number | null;
};

const DEFAULT_DASHBOARD_PORT = 3117;
const DEFAULT_CONFIG_PATH = path.join(homedir(), '.leechless', 'config.json');

const DASHBOARD_ENDPOINTS: ReadonlySet<DashboardEndpoint> = new Set([
  'status',
  'network',
  'peers',
  'sessions',
  'earnings',
  'config',
  'data-sources',
]);

let mainWindow: BrowserWindow | null = null;
const logBuffer: LogEvent[] = [];

let dashboardServer: DashboardServer | null = null;
const dashboardRuntime: DashboardRuntimeState = {
  running: false,
  port: DEFAULT_DASHBOARD_PORT,
  startedAt: null,
  lastError: null,
  lastExitCode: null,
};

function toSafeDashboardPort(port?: number): number {
  const parsed = Number(port);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
    return Math.floor(parsed);
  }
  return DEFAULT_DASHBOARD_PORT;
}

function appendLog(mode: RuntimeMode, stream: 'stdout' | 'stderr' | 'system', line: string): void {
  const event: LogEvent = { mode, stream, line, timestamp: Date.now() };
  logBuffer.push(event);
  if (logBuffer.length > 1200) {
    logBuffer.splice(0, logBuffer.length - 1200);
  }

  mainWindow?.webContents.send('runtime:log', event);
  emitRuntimeState();
}

const processManager = new ProcessManager((mode, stream, line) => {
  appendLog(mode, stream, line);
});

function getDashboardProcessState(): RuntimeProcessState {
  return {
    mode: 'dashboard',
    running: dashboardRuntime.running,
    pid: dashboardRuntime.running ? process.pid : null,
    startedAt: dashboardRuntime.startedAt,
    lastExitCode: dashboardRuntime.lastExitCode,
    lastError: dashboardRuntime.lastError,
  };
}

function getCombinedProcessState(): RuntimeProcessState[] {
  const processStates = processManager.getState().filter((state) => state.mode !== 'dashboard');
  processStates.push(getDashboardProcessState());
  return processStates;
}

function emitRuntimeState(): void {
  mainWindow?.webContents.send('runtime:state', getCombinedProcessState());
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function defaultDashboardConfig(): DashboardConfig {
  return {
    identity: {
      displayName: 'Leechless Node',
    },
    seller: {
      reserveFloor: 10,
      maxConcurrentBuyers: 5,
      enabledProviders: [],
      pricePerToken: 0.00001,
    },
    buyer: {
      preferredProviders: ['anthropic', 'openai'],
      maxPricePerToken: 0.0001,
      minPeerReputation: 50,
      proxyPort: 8377,
    },
    network: {
      bootstrapNodes: [],
    },
    payments: {
      preferredMethod: 'crypto',
      platformFeeRate: 0.05,
    },
    providers: [],
    plugins: [],
  };
}

async function loadDashboardConfig(configPath = DEFAULT_CONFIG_PATH): Promise<DashboardConfig> {
  const defaults = defaultDashboardConfig();

  let parsed: unknown;
  try {
    const raw = await readFile(configPath, 'utf-8');
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }

  const root = asRecord(parsed);
  const identity = asRecord(root.identity);
  const seller = asRecord(root.seller);
  const buyer = asRecord(root.buyer);
  const network = asRecord(root.network);
  const payments = asRecord(root.payments);

  const plugins = Array.isArray(root.plugins)
    ? root.plugins
      .map((item) => asRecord(item))
      .map((item) => ({
        name: asString(item.name, 'unknown'),
        package: asString(item.package, 'unknown'),
        installedAt: asString(item.installedAt, new Date(0).toISOString()),
      }))
    : [];

  return {
    identity: {
      displayName: asString(identity.displayName, defaults.identity.displayName),
      walletAddress: typeof identity.walletAddress === 'string' ? identity.walletAddress : undefined,
    },
    seller: {
      reserveFloor: asNumber(seller.reserveFloor, defaults.seller.reserveFloor),
      maxConcurrentBuyers: asNumber(seller.maxConcurrentBuyers, defaults.seller.maxConcurrentBuyers),
      enabledProviders: asStringArray(seller.enabledProviders, defaults.seller.enabledProviders),
      pricePerToken: asNumber(seller.pricePerToken, defaults.seller.pricePerToken),
    },
    buyer: {
      preferredProviders: asStringArray(buyer.preferredProviders, defaults.buyer.preferredProviders),
      maxPricePerToken: asNumber(buyer.maxPricePerToken, defaults.buyer.maxPricePerToken),
      minPeerReputation: asNumber(buyer.minPeerReputation, defaults.buyer.minPeerReputation),
      proxyPort: asNumber(buyer.proxyPort, defaults.buyer.proxyPort),
    },
    network: {
      bootstrapNodes: asStringArray(network.bootstrapNodes, defaults.network.bootstrapNodes),
    },
    payments: {
      preferredMethod: asString(payments.preferredMethod, defaults.payments.preferredMethod),
      platformFeeRate: asNumber(payments.platformFeeRate, defaults.payments.platformFeeRate),
    },
    providers: Array.isArray(root.providers) ? root.providers : defaults.providers,
    plugins,
  };
}

async function startDashboardRuntime(port?: number): Promise<void> {
  const targetPort = toSafeDashboardPort(port ?? dashboardRuntime.port);

  if (dashboardRuntime.running && dashboardRuntime.port === targetPort) {
    return;
  }

  if (dashboardRuntime.running) {
    await stopDashboardRuntime('restart');
  }

  dashboardRuntime.port = targetPort;
  dashboardRuntime.lastError = null;

  try {
    const config = await loadDashboardConfig();
    dashboardServer = await createDashboardServer(config, targetPort);
    await dashboardServer.start();

    dashboardRuntime.running = true;
    dashboardRuntime.startedAt = Date.now();
    dashboardRuntime.lastExitCode = null;
    dashboardRuntime.lastError = null;

    appendLog('dashboard', 'system', `Embedded dashboard engine running on http://127.0.0.1:${targetPort}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dashboardRuntime.running = false;
    dashboardRuntime.startedAt = null;
    dashboardRuntime.lastExitCode = 1;
    dashboardRuntime.lastError = message;
    dashboardServer = null;

    appendLog('dashboard', 'system', `Embedded dashboard engine failed to start: ${message}`);
    throw err;
  }
}

async function stopDashboardRuntime(reason: string): Promise<void> {
  if (!dashboardServer) {
    dashboardRuntime.running = false;
    dashboardRuntime.startedAt = null;
    emitRuntimeState();
    return;
  }

  try {
    await dashboardServer.stop();
    dashboardRuntime.lastExitCode = 0;
    appendLog('dashboard', 'system', `Embedded dashboard engine stopped (${reason}).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dashboardRuntime.lastExitCode = 1;
    dashboardRuntime.lastError = message;
    appendLog('dashboard', 'system', `Embedded dashboard engine stop failed: ${message}`);
  } finally {
    dashboardServer = null;
    dashboardRuntime.running = false;
    dashboardRuntime.startedAt = null;
    emitRuntimeState();
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'Leechless Desktop',
    backgroundColor: '#0b0e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(rendererUrl);

  mainWindow.webContents.on('did-finish-load', () => {
    if (!isDev || !mainWindow) return;
    void mainWindow.webContents
      .executeJavaScript('Boolean(window.leechlessDesktop)', true)
      .then((ok) => {
        console.log(`[desktop] preload bridge ${ok ? 'ready' : 'missing'}`);
      })
      .catch((err) => {
        console.error(`[desktop] preload bridge check failed: ${String(err)}`);
      });
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function defaultNetworkStats(): DashboardNetworkStats {
  return {
    totalPeers: 0,
    dhtNodeCount: 0,
    dhtHealthy: false,
    lastScanAt: null,
    totalLookups: 0,
    successfulLookups: 0,
    lookupSuccessRate: 0,
    averageLookupLatencyMs: 0,
    healthReason: 'dashboard offline',
  };
}

function toSafeDashboardEndpoint(endpoint: string): DashboardEndpoint | null {
  if (DASHBOARD_ENDPOINTS.has(endpoint as DashboardEndpoint)) {
    return endpoint as DashboardEndpoint;
  }
  return null;
}

function sanitizeDashboardQuery(query: unknown): Record<string, DashboardQueryValue> {
  if (!query || typeof query !== 'object') {
    return {};
  }

  const safe: Record<string, DashboardQueryValue> = {};
  for (const [rawKey, rawValue] of Object.entries(query)) {
    const key = rawKey.trim();
    if (key.length === 0) {
      continue;
    }
    if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      safe[key] = rawValue;
    }
  }
  return safe;
}

function buildDashboardUrl(endpoint: DashboardEndpoint, port: number, query: Record<string, DashboardQueryValue>): string {
  const url = new URL(`http://127.0.0.1:${port}/api/${endpoint}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function errorMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const candidate = (payload as { error?: unknown }).error;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate;
  }
  return null;
}

async function fetchDashboardData(
  endpoint: DashboardEndpoint,
  port?: number,
  query: Record<string, DashboardQueryValue> = {},
): Promise<DashboardApiResult> {
  const safePort = toSafeDashboardPort(port);
  const url = buildDashboardUrl(endpoint, safePort, query);

  try {
    const response = await fetch(url);

    let payload: unknown = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }

    if (!response.ok) {
      return {
        ok: false,
        data: payload,
        error: errorMessageFromPayload(payload) ?? `dashboard api returned ${response.status}`,
        status: response.status,
      };
    }

    return {
      ok: true,
      data: payload,
      error: null,
      status: response.status,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      status: null,
    };
  }
}

async function scanDashboardNetwork(port?: number): Promise<DashboardApiResult> {
  const safePort = toSafeDashboardPort(port);
  const url = `http://127.0.0.1:${safePort}/api/network/scan`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    });

    let payload: unknown = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }

    if (!response.ok) {
      return {
        ok: false,
        data: payload,
        error: errorMessageFromPayload(payload) ?? `dashboard api returned ${response.status}`,
        status: response.status,
      };
    }

    return {
      ok: true,
      data: payload,
      error: null,
      status: response.status,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      status: null,
    };
  }
}

async function fetchNetworkSnapshot(port?: number): Promise<DashboardNetworkResult> {
  const response = await fetchDashboardData('network', port);
  if (!response.ok || !response.data || typeof response.data !== 'object') {
    return {
      ok: false,
      peers: [],
      stats: defaultNetworkStats(),
      error: response.error ?? 'dashboard network api error',
    };
  }

  const payload = response.data as Partial<DashboardNetworkSnapshot>;
  const peers = Array.isArray(payload.peers) ? payload.peers : [];
  const stats = payload.stats ?? defaultNetworkStats();

  return {
    ok: true,
    peers,
    stats,
    error: null,
  };
}

async function ensureDashboardRuntime(targetPort?: number): Promise<void> {
  if (dashboardRuntime.running) {
    return;
  }

  const desiredPort = toSafeDashboardPort(targetPort ?? dashboardRuntime.port);
  await startDashboardRuntime(desiredPort);
}

ipcMain.handle('runtime:get-state', async () => {
  return {
    processes: getCombinedProcessState(),
    daemonState: processManager.getDaemonStateSnapshot(),
    logs: [...logBuffer],
  };
});

ipcMain.handle('runtime:start', async (_event, options: StartOptions) => {
  if (options.mode === 'dashboard') {
    await startDashboardRuntime(options.dashboardPort);
    return {
      state: getDashboardProcessState(),
      processes: getCombinedProcessState(),
      daemonState: processManager.getDaemonStateSnapshot(),
    };
  }

  const state = await processManager.start(options);
  return {
    state,
    processes: getCombinedProcessState(),
    daemonState: processManager.getDaemonStateSnapshot(),
  };
});

ipcMain.handle('runtime:stop', async (_event, mode: RuntimeMode) => {
  if (mode === 'dashboard') {
    await stopDashboardRuntime('manual stop');
    return {
      state: getDashboardProcessState(),
      processes: getCombinedProcessState(),
      daemonState: processManager.getDaemonStateSnapshot(),
    };
  }

  const state = await processManager.stop(mode);
  return {
    state,
    processes: getCombinedProcessState(),
    daemonState: processManager.getDaemonStateSnapshot(),
  };
});

ipcMain.handle('runtime:open-dashboard', async (_event, port?: number) => {
  const openPort = dashboardRuntime.running ? dashboardRuntime.port : toSafeDashboardPort(port);
  await shell.openExternal(`http://127.0.0.1:${openPort}`);
  return { ok: true };
});

ipcMain.handle('runtime:clear-logs', async () => {
  logBuffer.length = 0;
  return { ok: true };
});

ipcMain.handle('runtime:get-network', async (_event, port?: number) => {
  const requestedPort = toSafeDashboardPort(port);
  await ensureDashboardRuntime(requestedPort);
  const activePort = dashboardRuntime.running ? dashboardRuntime.port : requestedPort;
  return fetchNetworkSnapshot(activePort);
});

ipcMain.handle(
  'runtime:get-dashboard-data',
  async (
    _event,
    endpoint: string,
    options?: { port?: number; query?: Record<string, unknown> },
  ) => {
    const safeEndpoint = toSafeDashboardEndpoint(endpoint);
    if (!safeEndpoint) {
      return {
        ok: false,
        data: null,
        error: `Unsupported dashboard endpoint: ${endpoint}`,
        status: null,
      } satisfies DashboardApiResult;
    }

    const requestedPort = toSafeDashboardPort(options?.port);
    await ensureDashboardRuntime(requestedPort);

    const safeQuery = sanitizeDashboardQuery(options?.query);
    const activePort = dashboardRuntime.running ? dashboardRuntime.port : requestedPort;
    return fetchDashboardData(safeEndpoint, activePort, safeQuery);
  },
);

ipcMain.handle('runtime:scan-network', async (_event, port?: number) => {
  const requestedPort = toSafeDashboardPort(port);
  await ensureDashboardRuntime(requestedPort);
  const activePort = dashboardRuntime.running ? dashboardRuntime.port : requestedPort;
  return scanDashboardNetwork(activePort);
});

app.whenReady().then(() => {
  createWindow();

  void startDashboardRuntime().catch(() => {
    // Failure is already logged to renderer/system log.
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void Promise.allSettled([
      stopDashboardRuntime('window close'),
      processManager.stopAll(),
    ]).finally(() => app.quit());
  }
});

app.on('before-quit', (event) => {
  if ((app as unknown as { __leechlessStopping?: boolean }).__leechlessStopping) {
    return;
  }

  event.preventDefault();
  (app as unknown as { __leechlessStopping?: boolean }).__leechlessStopping = true;

  void Promise.allSettled([
    stopDashboardRuntime('app shutdown'),
    processManager.stopAll(),
  ]).finally(() => {
    app.quit();
  });
});
