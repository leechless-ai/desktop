import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDashboardServer, type DashboardConfig, type DashboardServer } from '../../../dashboard/dist/index.js';
import {
  ProcessManager,
  type RuntimeMode,
  type RuntimeProcessState,
  type StartOptions,
} from './process-manager.js';
import { WalletConnectManager } from './walletconnect.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFileAsync = promisify(execFileCallback);

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

// ── Wallet IPC Handlers ──

type WalletInfo = {
  address: string | null;
  chainId: string;
  balanceETH: string;
  balanceUSDC: string;
  escrow: {
    deposited: string;
    committed: string;
    available: string;
  };
};

ipcMain.handle('wallet:get-info', async (_event, port?: number): Promise<{ ok: boolean; data: WalletInfo | null; error: string | null }> => {
  try {
    const requestedPort = toSafeDashboardPort(port);
    await ensureDashboardRuntime(requestedPort);
    const activePort = dashboardRuntime.running ? dashboardRuntime.port : requestedPort;

    const [statusResult, configResult] = await Promise.all([
      fetchDashboardData('status', activePort),
      fetchDashboardData('config', activePort),
    ]);

    const statusData = statusResult.ok ? asRecord(statusResult.data) : {};
    const configData = configResult.ok ? asRecord(asRecord(configResult.data).config ?? configResult.data) : {};
    const identity = asRecord(configData.identity);
    const payments = asRecord(configData.payments);

    const walletAddress = asString(statusData.walletAddress as string, '') || asString(identity.walletAddress as string, '');

    return {
      ok: true,
      data: {
        address: walletAddress || null,
        chainId: asString(payments.chainId as string, 'base-sepolia'),
        balanceETH: '0.00',
        balanceUSDC: '0.00',
        escrow: {
          deposited: '0.00',
          committed: '0.00',
          available: '0.00',
        },
      },
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

ipcMain.handle('wallet:deposit', async (_event, amount: string) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return { ok: false, error: 'Invalid deposit amount' };
  }
  appendLog('dashboard', 'system', `Deposit requested: ${amount} USDC. Run 'leechless deposit ${amount}' in terminal.`);
  return { ok: true, message: `Deposit of ${amount} USDC logged. Use CLI to execute: leechless deposit ${amount}` };
});

ipcMain.handle('wallet:withdraw', async (_event, amount: string) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return { ok: false, error: 'Invalid withdrawal amount' };
  }
  appendLog('dashboard', 'system', `Withdrawal requested: ${amount} USDC. Run 'leechless withdraw ${amount}' in terminal.`);
  return { ok: true, message: `Withdrawal of ${amount} USDC logged. Use CLI to execute: leechless withdraw ${amount}` };
});

// ── WalletConnect IPC Handlers ──

const walletConnectManager = new WalletConnectManager();

walletConnectManager.on('state', (state: unknown) => {
  mainWindow?.webContents.send('wallet:wc-state-changed', state);
});

ipcMain.handle('wallet:wc-state', async () => {
  return { ok: true, data: walletConnectManager.state };
});

ipcMain.handle('wallet:wc-connect', async () => {
  try {
    const uri = await walletConnectManager.connect();
    if (!uri) {
      return { ok: false, error: 'WalletConnect not initialized. Set WALLETCONNECT_PROJECT_ID environment variable.' };
    }
    return { ok: true, data: { uri } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('wallet:wc-disconnect', async () => {
  try {
    await walletConnectManager.disconnect();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ── AI Chat IPC Handlers ──

type TextBlock = { type: 'text'; text: string };
type ThinkingBlock = { type: 'thinking'; thinking: string };
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

type AiChatMessage = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
};

type AiConversation = {
  id: string;
  title: string;
  model: string;
  messages: AiChatMessage[];
  createdAt: number;
  updatedAt: number;
};

type AiConversationSummary = {
  id: string;
  title: string;
  model: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

const CHAT_HISTORY_DIR = path.join(homedir(), '.leechless', 'chat-history');

class ChatStorage {
  private _dir: string;
  private _ready: Promise<void>;

  constructor(dir: string) {
    this._dir = dir;
    this._ready = mkdir(dir, { recursive: true }).then(() => {});
  }

  private _path(id: string): string {
    return path.join(this._dir, `${id}.json`);
  }

  async list(): Promise<AiConversationSummary[]> {
    await this._ready;
    let files: string[];
    try {
      files = await readdir(this._dir);
    } catch {
      return [];
    }
    const summaries: AiConversationSummary[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(path.join(this._dir, file), 'utf-8');
        const conv = JSON.parse(raw) as AiConversation;
        summaries.push({
          id: conv.id,
          title: conv.title,
          model: conv.model,
          messageCount: conv.messages.length,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });
      } catch {
        // Skip corrupt files
      }
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<AiConversation | null> {
    await this._ready;
    try {
      const raw = await readFile(this._path(id), 'utf-8');
      return JSON.parse(raw) as AiConversation;
    } catch {
      return null;
    }
  }

  async save(conv: AiConversation): Promise<void> {
    await this._ready;
    await writeFile(this._path(conv.id), JSON.stringify(conv, null, 2), 'utf-8');
  }

  async delete(id: string): Promise<void> {
    await this._ready;
    try {
      await unlink(this._path(id));
    } catch {
      // Already gone
    }
  }
}

const chatStorage = new ChatStorage(CHAT_HISTORY_DIR);
let chatAbortController: AbortController | null = null;

const toolDefinitions = [
  {
    name: 'bash',
    description: 'Execute a shell command. Use for running scripts, installing packages, git operations, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        limit: { type: 'number', description: 'Max lines to read (default: all)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates parent directories if needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at the given path.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for files matching a name pattern.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'File name pattern (e.g. "*.ts")' },
        path: { type: 'string', description: 'Base directory to search in' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Search file contents using a regex pattern.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'File or directory to search in' },
        include: { type: 'string', description: 'File glob to include (e.g. "*.ts")' },
      },
      required: ['pattern'],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<{ output: string; isError: boolean }> {
  try {
    switch (name) {
      case 'bash': {
        const command = String(input.command ?? '');
        if (!command) return { output: 'No command provided', isError: true };
        const timeout = Math.min(Math.max(Number(input.timeout) || 120000, 1000), 120000);
        const { stdout, stderr } = await execFileAsync('/bin/bash', ['-c', command], {
          timeout,
          maxBuffer: 1024 * 1024 * 10,
          cwd: homedir(),
        });
        let result = stdout || '';
        if (stderr) result += (result ? '\n' : '') + stderr;
        if (result.length > 30000) result = result.slice(0, 30000) + '\n... (truncated)';
        return { output: result || '(no output)', isError: false };
      }
      case 'read_file': {
        const filePath = String(input.path ?? '');
        if (!filePath) return { output: 'No path provided', isError: true };
        let content = await readFile(filePath, 'utf-8');
        const limit = Number(input.limit);
        if (limit > 0) {
          const lines = content.split('\n');
          content = lines.slice(0, limit).join('\n');
        }
        if (content.length > 30000) content = content.slice(0, 30000) + '\n... (truncated)';
        return { output: content, isError: false };
      }
      case 'write_file': {
        const filePath = String(input.path ?? '');
        const content = String(input.content ?? '');
        if (!filePath) return { output: 'No path provided', isError: true };
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, content, 'utf-8');
        return { output: `Wrote ${content.length} characters to ${filePath}`, isError: false };
      }
      case 'list_directory': {
        const dirPath = String(input.path ?? '.');
        const entries = await readdir(dirPath, { withFileTypes: true });
        const lines = entries.map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`);
        return { output: lines.join('\n') || '(empty directory)', isError: false };
      }
      case 'search_files': {
        const pattern = String(input.pattern ?? '');
        const basePath = String(input.path ?? '.');
        if (!pattern) return { output: 'No pattern provided', isError: true };
        const { stdout } = await execFileAsync('/usr/bin/find', [basePath, '-name', pattern, '-type', 'f'], {
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        });
        const result = stdout.trim();
        if (result.length > 30000) return { output: result.slice(0, 30000) + '\n... (truncated)', isError: false };
        return { output: result || 'No files found', isError: false };
      }
      case 'grep': {
        const pattern = String(input.pattern ?? '');
        const searchPath = String(input.path ?? '.');
        if (!pattern) return { output: 'No pattern provided', isError: true };
        const args = ['-rn', pattern, searchPath];
        if (input.include) args.push('--include', String(input.include));
        try {
          const { stdout } = await execFileAsync('/usr/bin/grep', args, {
            timeout: 10000,
            maxBuffer: 1024 * 1024,
          });
          let result = stdout.trim();
          if (result.length > 30000) result = result.slice(0, 30000) + '\n... (truncated)';
          return { output: result || 'No matches found', isError: false };
        } catch (grepErr) {
          if ((grepErr as { code?: number }).code === 1) {
            return { output: 'No matches found', isError: false };
          }
          throw grepErr;
        }
      }
      default:
        return { output: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { output: err instanceof Error ? err.message : String(err), isError: true };
  }
}

function getProxyPort(): number {
  // Read from loaded config; fallback to 8377
  return 8377;
}

function isProxyRunning(): boolean {
  return isModeRunning('connect', getCombinedProcessState());
}

function isModeRunning(mode: string, processes: RuntimeProcessState[]): boolean {
  const proc = processes.find((p) => p.mode === mode);
  return Boolean(proc && proc.running);
}

ipcMain.handle('chat:ai-get-proxy-status', async () => {
  return {
    ok: true,
    data: {
      running: isProxyRunning(),
      port: getProxyPort(),
    },
  };
});

ipcMain.handle('chat:ai-list-conversations', async () => {
  const conversations = await chatStorage.list();
  return { ok: true, data: conversations };
});

ipcMain.handle('chat:ai-get-conversation', async (_event, id: string) => {
  const conv = await chatStorage.get(id);
  if (!conv) {
    return { ok: false, error: 'Conversation not found' };
  }
  return { ok: true, data: conv };
});

ipcMain.handle('chat:ai-create-conversation', async (_event, model: string) => {
  const conv: AiConversation = {
    id: randomUUID(),
    title: 'New conversation',
    model: model || 'claude-sonnet-4-20250514',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await chatStorage.save(conv);
  return { ok: true, data: conv };
});

ipcMain.handle('chat:ai-delete-conversation', async (_event, id: string) => {
  await chatStorage.delete(id);
  return { ok: true };
});

ipcMain.handle('chat:ai-send', async (_event, conversationId: string, userMessage: string, model?: string) => {
  if (!userMessage || userMessage.trim().length === 0) {
    return { ok: false, error: 'Empty message' };
  }

  if (!isProxyRunning()) {
    return { ok: false, error: 'Buyer runtime is not running. Start it from Desktop Controls.' };
  }

  const conv = await chatStorage.get(conversationId);
  if (!conv) {
    return { ok: false, error: 'Conversation not found' };
  }

  // Add user message
  conv.messages.push({ role: 'user', content: userMessage.trim() });
  conv.updatedAt = Date.now();

  // Auto-title from first user message
  if (conv.title === 'New conversation' && conv.messages.filter(m => m.role === 'user').length === 1) {
    conv.title = userMessage.trim().slice(0, 60) + (userMessage.trim().length > 60 ? '...' : '');
  }

  if (model) {
    conv.model = model;
  }

  await chatStorage.save(conv);

  // Notify renderer that user message is persisted
  mainWindow?.webContents.send('chat:ai-user-persisted', { conversationId, message: conv.messages[conv.messages.length - 1] });

  const proxyPort = getProxyPort();
  const url = `http://127.0.0.1:${proxyPort}/v1/messages`;

  const requestBody = {
    model: conv.model,
    max_tokens: 4096,
    messages: conv.messages.map(m => ({ role: m.role, content: m.content })),
  };

  chatAbortController = new AbortController();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
      signal: chatAbortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const error = `Proxy returned ${response.status}: ${errorText.slice(0, 200)}`;
      mainWindow?.webContents.send('chat:ai-error', { conversationId, error });
      return { ok: false, error };
    }

    const result = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const assistantText = result.content
      ?.filter((block: { type: string }) => block.type === 'text')
      .map((block: { text?: string }) => block.text ?? '')
      .join('') ?? '';

    if (assistantText.length > 0) {
      conv.messages.push({ role: 'assistant', content: assistantText });
      conv.updatedAt = Date.now();
      await chatStorage.save(conv);

      mainWindow?.webContents.send('chat:ai-done', {
        conversationId,
        message: { role: 'assistant', content: assistantText },
      });
    }

    return { ok: true };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      mainWindow?.webContents.send('chat:ai-error', { conversationId, error: 'Request aborted' });
      return { ok: false, error: 'Aborted' };
    }
    const error = err instanceof Error ? err.message : String(err);
    mainWindow?.webContents.send('chat:ai-error', { conversationId, error });
    return { ok: false, error };
  } finally {
    chatAbortController = null;
  }
});

ipcMain.handle('chat:ai-abort', async () => {
  if (chatAbortController) {
    chatAbortController.abort();
    chatAbortController = null;
  }
  return { ok: true };
});

// ── Streaming AI Chat ──

async function streamSingleTurn(conv: AiConversation, conversationId: string, signal: AbortSignal): Promise<ContentBlock[]> {
  const proxyPort = getProxyPort();
  const url = `http://127.0.0.1:${proxyPort}/v1/messages`;

  const requestBody = {
    model: conv.model,
    max_tokens: 4096,
    stream: true,
    tools: toolDefinitions,
    messages: conv.messages.map(m => ({ role: m.role, content: m.content })),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Proxy returned ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

  // Fallback: non-streaming response
  if (!contentType.includes('text/event-stream')) {
    const result = await response.json() as { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> };
    const blocks: ContentBlock[] = [];
    for (const block of result.content ?? []) {
      if (block.type === 'text') {
        blocks.push({ type: 'text', text: block.text ?? '' });
        mainWindow?.webContents.send('chat:ai-stream-delta', { conversationId, index: 0, blockType: 'text', text: block.text ?? '' });
      } else if (block.type === 'tool_use') {
        blocks.push({ type: 'tool_use', id: block.id ?? '', name: block.name ?? '', input: block.input ?? {} });
      }
    }
    return blocks;
  }

  // Parse SSE stream
  const blocks: ContentBlock[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let sseBuffer = '';
  let currentBlockIndex = -1;
  let currentBlockType = '';
  let textAccum = '';
  let toolJsonAccum = '';
  let currentToolId = '';
  let currentToolName = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]' || data.length === 0) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      const eventType = String(event.type ?? '');

      switch (eventType) {
        case 'content_block_start': {
          const contentBlock = event.content_block as Record<string, unknown> | undefined;
          const index = Number(event.index ?? 0);
          currentBlockIndex = index;
          const blockType = String(contentBlock?.type ?? 'text');
          currentBlockType = blockType;

          if (blockType === 'text') {
            textAccum = String(contentBlock?.text ?? '');
            mainWindow?.webContents.send('chat:ai-stream-block-start', { conversationId, index, blockType: 'text' });
          } else if (blockType === 'tool_use') {
            currentToolId = String(contentBlock?.id ?? '');
            currentToolName = String(contentBlock?.name ?? '');
            toolJsonAccum = '';
            mainWindow?.webContents.send('chat:ai-stream-block-start', { conversationId, index, blockType: 'tool_use', toolId: currentToolId, toolName: currentToolName });
          } else if (blockType === 'thinking') {
            textAccum = '';
            mainWindow?.webContents.send('chat:ai-stream-block-start', { conversationId, index, blockType: 'thinking' });
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event.delta as Record<string, unknown> | undefined;
          const deltaType = String(delta?.type ?? '');

          if (deltaType === 'text_delta') {
            const text = String(delta?.text ?? '');
            textAccum += text;
            mainWindow?.webContents.send('chat:ai-stream-delta', { conversationId, index: currentBlockIndex, blockType: 'text', text });
          } else if (deltaType === 'input_json_delta') {
            const partial = String(delta?.partial_json ?? '');
            toolJsonAccum += partial;
          } else if (deltaType === 'thinking_delta') {
            const thinking = String(delta?.thinking ?? '');
            textAccum += thinking;
            mainWindow?.webContents.send('chat:ai-stream-delta', { conversationId, index: currentBlockIndex, blockType: 'thinking', text: thinking });
          }
          break;
        }

        case 'content_block_stop': {
          if (currentBlockType === 'text') {
            blocks.push({ type: 'text', text: textAccum });
            mainWindow?.webContents.send('chat:ai-stream-block-stop', { conversationId, index: currentBlockIndex, blockType: 'text' });
          } else if (currentBlockType === 'tool_use') {
            let parsedInput: Record<string, unknown> = {};
            try { parsedInput = JSON.parse(toolJsonAccum || '{}'); } catch { /* empty */ }
            blocks.push({ type: 'tool_use', id: currentToolId, name: currentToolName, input: parsedInput });
            mainWindow?.webContents.send('chat:ai-stream-block-stop', { conversationId, index: currentBlockIndex, blockType: 'tool_use', toolId: currentToolId, toolName: currentToolName, input: parsedInput });
          } else if (currentBlockType === 'thinking') {
            blocks.push({ type: 'thinking', thinking: textAccum });
            mainWindow?.webContents.send('chat:ai-stream-block-stop', { conversationId, index: currentBlockIndex, blockType: 'thinking' });
          }
          textAccum = '';
          toolJsonAccum = '';
          break;
        }

        case 'message_stop':
        case 'message_delta':
          break;
      }
    }
  }

  return blocks;
}

async function streamingChatLoop(conv: AiConversation, conversationId: string, signal: AbortSignal): Promise<void> {
  const MAX_TURNS = 20;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    mainWindow?.webContents.send('chat:ai-stream-start', { conversationId, turn });

    const blocks = await streamSingleTurn(conv, conversationId, signal);

    const toolUseBlocks = blocks.filter(b => b.type === 'tool_use') as ToolUseBlock[];

    if (toolUseBlocks.length === 0) {
      // Text-only response — save and finish
      conv.messages.push({ role: 'assistant', content: blocks });
      conv.updatedAt = Date.now();
      await chatStorage.save(conv);
      mainWindow?.webContents.send('chat:ai-stream-done', { conversationId });
      return;
    }

    // Save assistant message with tool use blocks
    conv.messages.push({ role: 'assistant', content: blocks });
    conv.updatedAt = Date.now();
    await chatStorage.save(conv);

    // Execute tools and build tool_result blocks
    const toolResults: ToolResultBlock[] = [];
    for (const toolBlock of toolUseBlocks) {
      mainWindow?.webContents.send('chat:ai-tool-executing', {
        conversationId,
        toolUseId: toolBlock.id,
        name: toolBlock.name,
        input: toolBlock.input,
      });

      const result = await executeTool(toolBlock.name, toolBlock.input);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result.output,
        is_error: result.isError,
      });

      mainWindow?.webContents.send('chat:ai-tool-result', {
        conversationId,
        toolUseId: toolBlock.id,
        output: result.output,
        isError: result.isError,
      });
    }

    // Add tool results as user message
    conv.messages.push({ role: 'user', content: toolResults });
    conv.updatedAt = Date.now();
    await chatStorage.save(conv);
  }

  // Max turns reached
  mainWindow?.webContents.send('chat:ai-stream-done', { conversationId });
}

ipcMain.handle('chat:ai-send-stream', async (_event, conversationId: string, userMessage: string, model?: string) => {
  if (!userMessage || userMessage.trim().length === 0) {
    return { ok: false, error: 'Empty message' };
  }

  if (!isProxyRunning()) {
    return { ok: false, error: 'Buyer runtime is not running. Start it from Desktop Controls.' };
  }

  const conv = await chatStorage.get(conversationId);
  if (!conv) {
    return { ok: false, error: 'Conversation not found' };
  }

  // Add user message
  conv.messages.push({ role: 'user', content: userMessage.trim() });
  conv.updatedAt = Date.now();

  // Auto-title from first user message
  if (conv.title === 'New conversation' && conv.messages.filter(m => m.role === 'user').length === 1) {
    conv.title = userMessage.trim().slice(0, 60) + (userMessage.trim().length > 60 ? '...' : '');
  }

  if (model) {
    conv.model = model;
  }

  await chatStorage.save(conv);

  mainWindow?.webContents.send('chat:ai-user-persisted', { conversationId, message: conv.messages[conv.messages.length - 1] });

  chatAbortController = new AbortController();

  try {
    await streamingChatLoop(conv, conversationId, chatAbortController.signal);
    return { ok: true };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      mainWindow?.webContents.send('chat:ai-stream-error', { conversationId, error: 'Request aborted' });
      return { ok: false, error: 'Aborted' };
    }
    const error = err instanceof Error ? err.message : String(err);
    mainWindow?.webContents.send('chat:ai-stream-error', { conversationId, error });
    return { ok: false, error };
  } finally {
    chatAbortController = null;
  }
});

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

  // Initialize WalletConnect if project ID is configured
  const wcProjectId = process.env['WALLETCONNECT_PROJECT_ID'] ?? '';
  if (wcProjectId.length > 0) {
    void walletConnectManager.init(wcProjectId).catch((err) => {
      console.error('[WalletConnect] init failed:', err instanceof Error ? err.message : String(err));
    });
  }

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
