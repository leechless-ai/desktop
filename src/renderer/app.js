import { initWalletModule } from './modules/wallet.js';
import { initChatModule } from './modules/chat.js';
import { initSettingsModule } from './modules/settings.js';
import { initRuntimeModule } from './modules/runtime.js';
import { initDashboardRenderModule } from './modules/dashboard-render.js';
import { initNavigationModule } from './modules/navigation.js';
import { initDashboardApiModule } from './modules/dashboard-api.js';

const bridge = window.leechlessDesktop;
const DEFAULT_DASHBOARD_PORT = 3117;
const POLL_INTERVAL_MS = 5000;

const uiState = {
  processes: [],
  refreshing: false,
  dashboardRunning: false,
  lastActiveSessions: 0,
  daemonState: null,
  lastSessionDebugKey: '',
  peerSort: { key: 'reputation', dir: 'desc' },
  sessionSort: { key: 'startedAt', dir: 'desc' },
  peerFilter: '',
  lastPeers: [],
  lastSessionsPayload: null,
  earningsPeriod: 'month',
  walletInfo: null,
  walletMode: 'node',
  wcState: { connected: false, address: null, chainId: null, pairingUri: null },
  chatActiveConversation: null,
  chatConversations: [],
  chatMessages: [],
  chatSending: false,
  appMode: 'seeder',
};

function byId(id) {
  return document.getElementById(id);
}

function setText(el, value) {
  if (el) {
    el.textContent = value;
  }
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function safeObject(value) {
  if (value && typeof value === 'object') {
    return value;
  }
  return null;
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

function formatTimestamp(timestamp) {
  const ts = safeNumber(timestamp, 0);
  if (ts <= 0) {
    return 'n/a';
  }
  return new Date(ts).toLocaleString();
}

function formatRelativeTime(timestamp) {
  const ts = safeNumber(timestamp, 0);
  if (ts <= 0) {
    return 'n/a';
  }

  const diffMs = Date.now() - ts;
  if (diffMs < 0) {
    return 'now';
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(durationMs) {
  const ms = safeNumber(durationMs, 0);
  if (ms <= 0) {
    return '0s';
  }

  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

function formatInt(value) {
  return Math.round(safeNumber(value, 0)).toLocaleString();
}

function formatPercent(value) {
  const pct = safeNumber(value, 0);
  return `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
}

function getCapacityColor(percent) {
  if (percent > 80) {
    return 'var(--accent)';
  }
  if (percent > 50) {
    return 'var(--accent-yellow)';
  }
  return 'var(--accent-green)';
}

function getWalletActionResult(result, successMessage, errorMessage) {
  if (result.ok) {
    return {
      message: result.message || successMessage,
      type: 'success',
    };
  }

  return {
    message: result.error || errorMessage,
    type: 'error',
  };
}

function formatMoney(value) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return '$0.00';
    }
    const numeric = Number(normalized);
    if (!Number.isNaN(numeric)) {
      return `$${numeric.toFixed(2)}`;
    }
    return `$${normalized}`;
  }

  const numeric = safeNumber(value, 0);
  return `$${numeric.toFixed(2)}`;
}

function formatPrice(value) {
  const numeric = safeNumber(value, 0);
  if (numeric <= 0) {
    return 'n/a';
  }
  if (numeric < 0.01) {
    return `$${numeric.toFixed(4)}`;
  }
  return `$${numeric.toFixed(2)}`;
}

function formatLatency(value) {
  const numeric = safeNumber(value, 0);
  if (numeric <= 0) {
    return 'n/a';
  }
  return `${Math.round(numeric)}ms`;
}

function formatShortId(id, head = 8, tail = 6) {
  if (typeof id !== 'string' || id.length === 0) {
    return 'unknown';
  }
  if (id.length <= head + tail + 3) {
    return id;
  }
  return `${id.slice(0, head)}...${id.slice(-tail)}`;
}

function formatEndpoint(peer) {
  const host = safeString(peer.host, '').trim();
  const port = safeNumber(peer.port, 0);
  if (host.length > 0 && port > 0) {
    return `${host}:${port}`;
  }
  return '-';
}

const elements = {
  seedState: byId('seedState'),
  connectState: byId('connectState'),
  seedBadge: byId('seedBadge'),
  connectBadge: byId('connectBadge'),
  runtimeSummary: byId('runtimeSummary'),
  daemonState: byId('daemonState'),
  logs: byId('logs'),

  seedProvider: byId('seedProvider'),
  connectRouter: byId('connectRouter'),

  overviewBadge: byId('overviewBadge'),
  ovNodeState: byId('ovNodeState'),
  ovPeers: byId('ovPeers'),
  ovSessionsCard: byId('ovSessionsCard'),
  ovSessions: byId('ovSessions'),
  ovEarnings: byId('ovEarnings'),
  ovDhtHealth: byId('ovDhtHealth'),
  ovUptime: byId('ovUptime'),
  ovPeersCount: byId('ovPeersCount'),
  overviewPeersBody: byId('overviewPeersBody'),
  capacityArc: byId('capacityArc'),
  capacityPercent: byId('capacityPercent'),
  ovProxyPort: byId('ovProxyPort'),
  ovCapSessions: byId('ovCapSessions'),
  ovCapPeers: byId('ovCapPeers'),
  ovCapDht: byId('ovCapDht'),
  miniChartContainer: byId('miniChartContainer'),

  peersMeta: byId('peersMeta'),
  peersMessage: byId('peersMessage'),
  peersBody: byId('peersBody'),
  peersHead: byId('peersHead'),
  peerFilter: byId('peerFilter'),

  sessionsMeta: byId('sessionsMeta'),
  sessionsMessage: byId('sessionsMessage'),
  sessionsBody: byId('sessionsBody'),
  sessionsHead: byId('sessionsHead'),

  earningsMeta: byId('earningsMeta'),
  earningsMessage: byId('earningsMessage'),
  earnToday: byId('earnToday'),
  earnWeek: byId('earnWeek'),
  earnMonth: byId('earnMonth'),
  earningsLineChart: byId('earningsLineChart'),
  earningsPieChart: byId('earningsPieChart'),

  // Wallet
  walletMeta: byId('walletMeta'),
  walletMessage: byId('walletMessage'),
  walletAddress: byId('walletAddress'),
  walletCopyBtn: byId('walletCopyBtn'),
  walletChain: byId('walletChain'),
  walletETH: byId('walletETH'),
  walletUSDC: byId('walletUSDC'),
  walletNetwork: byId('walletNetwork'),
  escrowDeposited: byId('escrowDeposited'),
  escrowCommitted: byId('escrowCommitted'),
  escrowAvailable: byId('escrowAvailable'),
  walletAmount: byId('walletAmount'),
  walletDepositBtn: byId('walletDepositBtn'),
  walletWithdrawBtn: byId('walletWithdrawBtn'),
  walletActionMessage: byId('walletActionMessage'),
  walletModeNode: byId('walletModeNode'),
  walletModeExternal: byId('walletModeExternal'),
  walletNodeSection: byId('walletNodeSection'),
  walletExternalSection: byId('walletExternalSection'),
  wcStatus: byId('wcStatus'),
  wcStatusText: byId('wcStatusText'),
  wcAddressRow: byId('wcAddressRow'),
  wcAddress: byId('wcAddress'),
  wcCopyBtn: byId('wcCopyBtn'),
  wcConnectBtn: byId('wcConnectBtn'),
  wcDisconnectBtn: byId('wcDisconnectBtn'),
  wcQrContainer: byId('wcQrContainer'),
  wcQrCanvas: byId('wcQrCanvas'),

  // AI Chat
  chatModelSelect: byId('chatModelSelect'),
  chatProxyStatus: byId('chatProxyStatus'),
  chatNewBtn: byId('chatNewBtn'),
  chatConversations: byId('chatConversations'),
  chatHeader: byId('chatHeader'),
  chatDeleteBtn: byId('chatDeleteBtn'),
  chatMessages: byId('chatMessages'),
  chatInput: byId('chatInput'),
  chatSendBtn: byId('chatSendBtn'),
  chatAbortBtn: byId('chatAbortBtn'),
  chatError: byId('chatError'),
  chatStreamingIndicator: byId('chatStreamingIndicator'),

  connectionMeta: byId('connectionMeta'),
  connectionStatus: byId('connectionStatus'),
  connectionNetwork: byId('connectionNetwork'),
  connectionSources: byId('connectionSources'),
  connectionNotes: byId('connectionNotes'),

  configMeta: byId('configMeta'),
  configMessage: byId('configMessage'),
  configSaveBtn: byId('configSaveBtn'),
  cfgReserveFloor: byId('cfgReserveFloor'),
  cfgSellerInputUsdPerMillion: byId('cfgSellerInputUsdPerMillion'),
  cfgSellerOutputUsdPerMillion: byId('cfgSellerOutputUsdPerMillion'),
  cfgMaxBuyers: byId('cfgMaxBuyers'),
  cfgProxyPort: byId('cfgProxyPort'),
  cfgPreferredProviders: byId('cfgPreferredProviders'),
  cfgBuyerMaxInputUsdPerMillion: byId('cfgBuyerMaxInputUsdPerMillion'),
  cfgBuyerMaxOutputUsdPerMillion: byId('cfgBuyerMaxOutputUsdPerMillion'),
  cfgMinRep: byId('cfgMinRep'),
  cfgPaymentMethod: byId('cfgPaymentMethod'),
};

const navButtons = Array.from(document.querySelectorAll('.sidebar-btn[data-view]'));
const views = Array.from(document.querySelectorAll('.view'));

const TOOLBAR_VIEWS = new Set(['overview', 'desktop']);

const {
  setActiveView,
  getActiveView,
  setAppMode,
  initNavigation,
  getSavedAppMode,
} = initNavigationModule({
  uiState,
  navButtons,
  views,
  toolbarViews: TOOLBAR_VIEWS,
  storageKey: 'leechless-app-mode',
});

function setBadgeTone(el, tone, label) {
  if (!el) return;
  el.classList.remove('badge-active', 'badge-idle', 'badge-warn', 'badge-bad');
  el.classList.add(`badge-${tone}`);
  el.textContent = label;
}

const {
  appendLog,
  renderLogs,
  isModeRunning,
  renderProcesses,
  renderDaemonState,
  appendSystemLog,
} = initRuntimeModule({
  elements,
  uiState,
  formatClock,
  formatDuration,
  setText,
});

const {
  getDashboardPort,
  getDashboardData,
  scanDhtNow,
  setRefreshHooks,
  refreshDashboardData,
} = initDashboardApiModule({
  bridge,
  elements,
  uiState,
  defaultDashboardPort: DEFAULT_DASHBOARD_PORT,
  safeNumber,
  safeArray,
});

async function refreshAll() {
  if (!bridge || uiState.refreshing) {
    return;
  }

  uiState.refreshing = true;
  try {
    const snapshot = await bridge.getState();
    renderLogs(snapshot.logs);
    renderProcesses(snapshot.processes);
    renderDaemonState(snapshot.daemonState);
    await refreshDashboardData(snapshot.processes);
  } finally {
    uiState.refreshing = false;
  }
}

function bindAction(buttonId, action, options = { refreshAfter: true }) {
  const button = byId(buttonId);
  if (!button) return;

  if (!bridge) {
    button.disabled = true;
    return;
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await action();
      if (options.refreshAfter) {
        await refreshAll();
      }
    } catch (err) {
      appendSystemLog(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      button.disabled = false;
    }
  });
}

async function waitForSeederReady(timeoutMs = 12000) {
  if (!bridge?.getState) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const snapshot = await bridge.getState();
      const daemon = safeObject(snapshot?.daemonState);
      const daemonState = safeObject(daemon?.state);
      const mode = safeString(daemonState?.state, '');
      if (mode === 'seeding') {
        return true;
      }
    } catch {
      // Ignore transient bridge polling errors while waiting.
    }

    await new Promise((resolve) => setTimeout(resolve, 450));
  }

  return false;
}

function bindControls() {
  bindAction('seedStartBtn', async () => {
    await bridge.start({
      mode: 'seed',
      provider: safeString(elements.seedProvider?.value, 'anthropic').trim() || 'anthropic',
    });
  });

  bindAction('seedStopBtn', async () => {
    await bridge.stop('seed');
  });

  bindAction('connectStartBtn', async () => {
    if (isModeRunning('seed')) {
      const ready = await waitForSeederReady(10000);
      if (!ready) {
        appendSystemLog('Seeder is still warming up; buyer may not discover the local seller immediately.');
      }
    }
    await bridge.start({
      mode: 'connect',
      router: safeString(elements.connectRouter?.value, 'claude-code').trim() || 'claude-code',
    });
  });

  bindAction('connectStopBtn', async () => {
    await bridge.stop('connect');
  });

  bindAction('refreshBtn', refreshAll);

  bindAction('clearLogsBtn', async () => {
    await bridge.clearLogs();
  });

  bindAction('startAllBtn', async () => {
    let startedSeed = false;
    if (!isModeRunning('seed')) {
      await bridge.start({
        mode: 'seed',
        provider: safeString(elements.seedProvider?.value, 'anthropic').trim() || 'anthropic',
      });
      startedSeed = true;
    }

    if (startedSeed) {
      const ready = await waitForSeederReady(12000);
      if (!ready) {
        appendSystemLog('Seeder startup is taking longer than expected; buyer may not discover it immediately.');
      }
    }

    if (!isModeRunning('connect')) {
      await bridge.start({
        mode: 'connect',
        router: safeString(elements.connectRouter?.value, 'claude-code').trim() || 'claude-code',
      });
    }
  });

  bindAction('stopAllBtn', async () => {
    if (isModeRunning('connect')) {
      await bridge.stop('connect');
    }
    if (isModeRunning('seed')) {
      await bridge.stop('seed');
    }
  });

  const scanAction = async () => {
    const result = await scanDhtNow();
    if (!result.ok) {
      throw new Error(result.error ?? 'DHT scan failed');
    }
    appendSystemLog('Triggered immediate DHT scan.');
  };

  bindAction('scanNetworkBtn', scanAction);
  bindAction('scanNetworkBtnPeers', scanAction);
}

function initializeBridge() {
  if (!bridge) {
    appendSystemLog('Desktop bridge unavailable: preload failed to inject API. Restart app after main/preload compile.');
    renderOfflineState('Desktop bridge unavailable.');
    return;
  }

  bridge.onLog((event) => {
    appendLog(event);
  });

  bridge.onState((processes) => {
    const wasDashboardRunning = uiState.dashboardRunning;
    renderProcesses(processes);

    const nowDashboardRunning = isModeRunning('dashboard', processes);
    if (nowDashboardRunning !== wasDashboardRunning) {
      void refreshDashboardData(processes);
    }
  });

  if (bridge.start) {
    void bridge.start({
      mode: 'dashboard',
      dashboardPort: getDashboardPort(),
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      const normalized = message.toLowerCase();
      if (normalized.includes('eaddrinuse') || normalized.includes('address already in use')) {
        appendSystemLog('Local data service port already in use; reusing the existing service.');
        return;
      }
      appendSystemLog(`Background data service start failed: ${message}`);
    });
  }

  void refreshAll();
  setInterval(() => {
    void refreshAll();
  }, POLL_INTERVAL_MS);
}

if (elements.ovSessionsCard) {
  elements.ovSessionsCard.title = 'Open Sessions view';
  elements.ovSessionsCard.addEventListener('click', () => {
    setActiveView('sessions');
  });
}

const { populateSettingsForm } = initSettingsModule({
  elements,
  safeObject,
  safeNumber,
  safeString,
  getDashboardData,
  getDashboardPort,
});

const {
  renderDashboardData,
  renderOfflineState,
  initSortableHeaders,
  bindPeerFilter,
} = initDashboardRenderModule({
  elements,
  uiState,
  safeNumber,
  safeArray,
  safeString,
  safeObject,
  formatTimestamp,
  formatRelativeTime,
  formatDuration,
  formatInt,
  formatPercent,
  formatMoney,
  formatPrice,
  formatLatency,
  formatShortId,
  formatEndpoint,
  getCapacityColor,
  setText,
  setBadgeTone,
  isModeRunning,
  getActiveView,
  setActiveView,
  appendSystemLog,
  populateSettingsForm,
});

const { refreshWalletInfo } = initWalletModule({
  bridge,
  elements,
  uiState,
  getDashboardPort,
  setText,
  setBadgeTone,
  safeString,
  formatMoney,
  getWalletActionResult,
});

const { refreshChatConversations, refreshChatProxyStatus } = initChatModule({
  bridge,
  elements,
  uiState,
  setBadgeTone,
  appendSystemLog,
});

setRefreshHooks({
  isModeRunning,
  renderOfflineState,
  renderDashboardData,
  refreshWalletInfo,
  refreshChatConversations,
  refreshChatProxyStatus,
  appendSystemLog,
});

function initPeriodToggle() {
  const buttons = document.querySelectorAll('.toggle-btn[data-period]');
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      uiState.earningsPeriod = btn.dataset.period;
      for (const b of buttons) {
        b.classList.toggle('active', b.dataset.period === uiState.earningsPeriod);
      }
      void refreshAll();
    });
  }
}

initNavigation();
setActiveView('overview');

// Restore persisted app mode
const savedMode = getSavedAppMode();
setAppMode(savedMode === 'connect' ? 'connect' : 'seeder');

bindControls();
initSortableHeaders();
bindPeerFilter();
initPeriodToggle();
initializeBridge();
