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

  if (numeric < 0.000001) {
    return `$${numeric.toExponential(1)}`;
  }

  return `$${numeric.toFixed(6)}`;
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

function defaultNetworkStats() {
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

const elements = {
  seedState: byId('seedState'),
  connectState: byId('connectState'),
  dashboardState: byId('dashboardState'),
  seedBadge: byId('seedBadge'),
  connectBadge: byId('connectBadge'),
  dashboardBadge: byId('dashboardBadge'),
  runtimeSummary: byId('runtimeSummary'),
  daemonState: byId('daemonState'),
  logs: byId('logs'),

  seedProvider: byId('seedProvider'),
  connectRouter: byId('connectRouter'),
  dashboardPort: byId('dashboardPort'),

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
  cfgPricePerToken: byId('cfgPricePerToken'),
  cfgMaxBuyers: byId('cfgMaxBuyers'),
  cfgProxyPort: byId('cfgProxyPort'),
  cfgMaxPrice: byId('cfgMaxPrice'),
  cfgMinRep: byId('cfgMinRep'),
  cfgPaymentMethod: byId('cfgPaymentMethod'),
};

const navButtons = Array.from(document.querySelectorAll('.sidebar-btn[data-view]'));
const views = Array.from(document.querySelectorAll('.view'));

const TOOLBAR_VIEWS = new Set(['overview', 'desktop']);

function setActiveView(viewName) {
  for (const button of navButtons) {
    const active = button.dataset.view === viewName;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  }

  for (const view of views) {
    view.classList.toggle('active', view.id === `view-${viewName}`);
  }

  // Show toolbar only on overview/desktop views
  const toolbar = document.querySelector('.runtime-toolbar');
  const mainContent = document.querySelector('.main-content');
  const showToolbar = TOOLBAR_VIEWS.has(viewName);
  if (toolbar) toolbar.classList.toggle('hidden', !showToolbar);
  if (mainContent) mainContent.classList.toggle('show-toolbar', showToolbar);
}

function getActiveView() {
  for (const view of views) {
    if (view.classList.contains('active')) {
      return view.id.replace('view-', '');
    }
  }
  return 'overview';
}

function initNavigation() {
  for (const button of navButtons) {
    button.addEventListener('click', () => {
      const targetView = button.dataset.view || 'overview';
      setActiveView(targetView);
    });
  }
}

function setBadgeTone(el, tone, label) {
  if (!el) return;
  el.classList.remove('badge-active', 'badge-idle', 'badge-warn', 'badge-bad');
  el.classList.add(`badge-${tone}`);
  el.textContent = label;
}

function setRuntimeBadge(el, state) {
  if (!el) return;
  el.classList.remove('running', 'stopped', 'error');
  el.classList.add(state);

  if (state === 'running') {
    el.textContent = 'Running';
  } else if (state === 'error') {
    el.textContent = 'Error';
  } else {
    el.textContent = 'Stopped';
  }
}

function appendLog(entry) {
  if (!elements.logs) return;

  const line = document.createElement('div');
  line.className = `log-entry ${entry.stream}`;

  const ts = document.createElement('span');
  ts.className = 'ts';
  ts.textContent = formatClock(entry.timestamp);

  line.appendChild(ts);
  line.appendChild(document.createTextNode(`[${entry.mode}] ${entry.line}`));

  elements.logs.appendChild(line);
  elements.logs.scrollTop = elements.logs.scrollHeight;
}

function renderLogs(entries) {
  if (!elements.logs) return;
  elements.logs.innerHTML = '';
  for (const entry of entries) {
    appendLog(entry);
  }
}

function processByMode(mode, processes = uiState.processes) {
  return processes.find((proc) => proc.mode === mode) ?? null;
}

function isModeRunning(mode, processes = uiState.processes) {
  const proc = processByMode(mode, processes);
  return Boolean(proc && proc.running);
}

function renderProcessState(mode, stateEl, badgeEl, processInfo) {
  if (!stateEl || !badgeEl) return;

  stateEl.classList.remove('status-running', 'status-stopped');

  if (!processInfo) {
    stateEl.textContent = 'Unknown';
    stateEl.classList.add('status-stopped');
    setRuntimeBadge(badgeEl, 'stopped');
    return;
  }

  if (processInfo.running) {
    const uptimeMs = processInfo.startedAt ? Date.now() - processInfo.startedAt : 0;
    stateEl.textContent = `Running (pid=${processInfo.pid ?? 'unknown'}, uptime=${formatDuration(uptimeMs)})`;
    stateEl.classList.add('status-running');
    setRuntimeBadge(badgeEl, 'running');
    return;
  }

  const segments = ['Stopped'];
  if (processInfo.lastExitCode !== null) {
    segments.push(`exit=${processInfo.lastExitCode}`);
  }
  if (processInfo.lastError) {
    segments.push(`error=${processInfo.lastError}`);
  }
  stateEl.textContent = segments.join(' | ');
  stateEl.classList.add('status-stopped');
  setRuntimeBadge(badgeEl, processInfo.lastError ? 'error' : 'stopped');

  if (mode === 'dashboard') {
    uiState.dashboardRunning = false;
  }
}

function renderRuntimeSummary(processes) {
  const running = processes.filter((proc) => proc.running).map((proc) => proc.mode);
  if (running.length === 0) {
    setText(elements.runtimeSummary, 'No active services');
    return;
  }
  setText(elements.runtimeSummary, `Active: ${running.join(', ')}`);
}

function renderProcesses(processes) {
  uiState.processes = Array.isArray(processes) ? processes : [];
  uiState.dashboardRunning = isModeRunning('dashboard', uiState.processes);

  renderProcessState('seed', elements.seedState, elements.seedBadge, processByMode('seed'));
  renderProcessState('connect', elements.connectState, elements.connectBadge, processByMode('connect'));
  renderProcessState('dashboard', elements.dashboardState, elements.dashboardBadge, processByMode('dashboard'));

  renderRuntimeSummary(uiState.processes);
}

function renderDaemonState(snapshot) {
  if (!elements.daemonState) return;
  uiState.daemonState = snapshot ?? null;

  if (!snapshot || !snapshot.exists) {
    elements.daemonState.textContent = 'No daemon state file found yet.';
    return;
  }

  if (!snapshot.state) {
    elements.daemonState.textContent = 'Daemon state file exists but could not be parsed.';
    return;
  }

  elements.daemonState.textContent = JSON.stringify(snapshot.state, null, 2);
}

function getDashboardPort() {
  const port = safeNumber(elements.dashboardPort?.value, DEFAULT_DASHBOARD_PORT);
  if (port <= 0 || port > 65535) {
    return DEFAULT_DASHBOARD_PORT;
  }
  return Math.floor(port);
}

function dashboardBridgeError(message) {
  return {
    ok: false,
    data: null,
    error: message,
    status: null,
  };
}

async function getDashboardData(endpoint, query = undefined) {
  if (!bridge) {
    return dashboardBridgeError('Desktop bridge unavailable');
  }

  if (!bridge.getDashboardData) {
    if (endpoint === 'network' && bridge.getNetwork) {
      const legacyNetwork = await bridge.getNetwork(getDashboardPort());
      if (!legacyNetwork.ok) {
        return dashboardBridgeError(legacyNetwork.error ?? 'Failed to query network endpoint');
      }
      return {
        ok: true,
        data: legacyNetwork,
        error: null,
        status: 200,
      };
    }

    if (endpoint === 'peers' && bridge.getNetwork) {
      const legacyNetwork = await bridge.getNetwork(getDashboardPort());
      if (!legacyNetwork.ok) {
        return dashboardBridgeError(legacyNetwork.error ?? 'Failed to query peers endpoint');
      }
      return {
        ok: true,
        data: {
          peers: safeArray(legacyNetwork.peers),
          total: safeArray(legacyNetwork.peers).length,
          degraded: false,
        },
        error: null,
        status: 200,
      };
    }

    return dashboardBridgeError('Dashboard data bridge unavailable');
  }

  try {
    return await bridge.getDashboardData(endpoint, {
      port: getDashboardPort(),
      query,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("No handler registered for 'runtime:get-dashboard-data'")) {
      if (endpoint === 'network' && bridge.getNetwork) {
        const legacyNetwork = await bridge.getNetwork(getDashboardPort());
        if (!legacyNetwork.ok) {
          return dashboardBridgeError(legacyNetwork.error ?? 'Failed to query network endpoint');
        }
        return {
          ok: true,
          data: legacyNetwork,
          error: null,
          status: 200,
        };
      }

      return dashboardBridgeError('Desktop main process is outdated. Fully quit and relaunch Leechless Desktop.');
    }

    return dashboardBridgeError(message);
  }
}

async function scanDhtNow() {
  if (!bridge) {
    return dashboardBridgeError('Desktop bridge unavailable');
  }
  if (!bridge.scanNetwork) {
    return dashboardBridgeError('Desktop main process does not support DHT scan yet. Rebuild and relaunch app.');
  }

  try {
    return await bridge.scanNetwork(getDashboardPort());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return dashboardBridgeError(message);
  }
}

function networkHealth(stats, peerCount) {
  const healthy = Boolean(stats?.dhtHealthy);
  if (healthy) {
    return { label: 'Healthy', tone: 'active' };
  }
  if (peerCount > 0) {
    return { label: 'Limited', tone: 'warn' };
  }
  return { label: 'Down', tone: 'bad' };
}

function normalizeNetworkData(networkData, peersData) {
  const networkPeers = safeArray(networkData?.peers);
  const daemonPeers = safeArray(peersData?.peers);
  const stats = networkData?.stats && typeof networkData.stats === 'object'
    ? { ...defaultNetworkStats(), ...networkData.stats }
    : defaultNetworkStats();

  const merged = new Map();

  for (const peer of networkPeers) {
    const peerId = safeString(peer.peerId, '').trim();
    if (peerId.length === 0) continue;

    merged.set(peerId, {
      peerId,
      host: safeString(peer.host, ''),
      port: safeNumber(peer.port, 0),
      providers: safeArray(peer.providers),
      pricePerToken: safeNumber(peer.pricePerToken, 0),
      capacityMsgPerHour: safeNumber(peer.capacityMsgPerHour, 0),
      reputation: safeNumber(peer.reputation, 0),
      lastSeen: safeNumber(peer.lastSeen, 0),
      source: safeString(peer.source, 'dht'),
      location: null,
    });
  }

  for (const peer of daemonPeers) {
    const peerId = safeString(peer.peerId, '').trim();
    if (peerId.length === 0) continue;

    const existing = merged.get(peerId) ?? {
      peerId,
      host: '',
      port: 0,
      providers: [],
      pricePerToken: 0,
      capacityMsgPerHour: 0,
      reputation: 0,
      lastSeen: 0,
      source: 'daemon',
      location: null,
    };

    const providers = safeArray(peer.providers);
    if (providers.length > 0) {
      existing.providers = providers;
    }

    if (safeNumber(peer.pricePerToken, 0) > 0) {
      existing.pricePerToken = safeNumber(peer.pricePerToken, 0);
    }

    if (safeNumber(peer.capacityMsgPerHour, 0) > 0) {
      existing.capacityMsgPerHour = safeNumber(peer.capacityMsgPerHour, 0);
    }

    if (safeNumber(peer.reputation, 0) > 0) {
      existing.reputation = safeNumber(peer.reputation, 0);
    }

    existing.location = typeof peer.location === 'string' ? peer.location : existing.location;
    if (!existing.source || existing.source === 'dht') {
      existing.source = safeString(peer.source, 'daemon');
    }

    merged.set(peerId, existing);
  }

  const peers = Array.from(merged.values()).sort((a, b) => {
    if (b.reputation !== a.reputation) {
      return b.reputation - a.reputation;
    }
    return b.lastSeen - a.lastSeen;
  });

  stats.totalPeers = peers.length;

  return {
    peers,
    stats,
  };
}

function buildEmptyRow(columnCount, message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = columnCount;
  cell.className = 'empty';
  cell.textContent = message;
  row.appendChild(cell);
  return row;
}

function renderOverviewPeers(peers) {
  if (!elements.overviewPeersBody) return;

  elements.overviewPeersBody.innerHTML = '';
  const topPeers = peers.slice(0, 6);

  if (topPeers.length === 0) {
    elements.overviewPeersBody.appendChild(buildEmptyRow(3, 'No peers yet.'));
    return;
  }

  for (const peer of topPeers) {
    const row = document.createElement('tr');

    const peerCell = document.createElement('td');
    peerCell.textContent = formatShortId(peer.peerId);
    peerCell.title = peer.peerId;

    const providersCell = document.createElement('td');
    providersCell.textContent = peer.providers.length > 0 ? peer.providers.join(', ') : 'n/a';

    const reputationCell = document.createElement('td');
    reputationCell.textContent = formatInt(peer.reputation);

    row.append(peerCell, providersCell, reputationCell);
    elements.overviewPeersBody.appendChild(row);
  }
}

function renderCapacityRing(percent, proxyPort, sessions, peerCount, dhtNodes) {
  const arc = elements.capacityArc;
  if (arc) {
    const circumference = 2 * Math.PI * 40;
    const offset = circumference - (percent / 100) * circumference;
    const color = getCapacityColor(percent);
    arc.setAttribute('stroke-dasharray', String(circumference));
    arc.setAttribute('stroke-dashoffset', String(offset));
    arc.setAttribute('stroke', color);
    if (elements.capacityPercent) {
      elements.capacityPercent.textContent = `${Math.round(percent)}%`;
      elements.capacityPercent.style.color = color;
    }
  }
  setText(elements.ovProxyPort, proxyPort > 0 ? String(proxyPort) : '-');
  setText(elements.ovCapSessions, formatInt(sessions));
  setText(elements.ovCapPeers, formatInt(peerCount));
  setText(elements.ovCapDht, formatInt(dhtNodes));
}

function renderMiniChart(dailyData) {
  const container = elements.miniChartContainer;
  if (!container) return;

  const data = safeArray(dailyData).slice(-14).map((d) => ({
    date: safeString(d.date, ''),
    amount: safeNumber(typeof d.amount === 'string' ? parseFloat(d.amount) : d.amount, 0),
  }));

  if (data.length === 0) {
    container.innerHTML = '<div class="mini-chart-empty">No earnings data yet</div>';
    return;
  }

  const max = Math.max(...data.map((d) => d.amount), 0.01);

  let html = '<div class="mini-chart-bars">';
  for (const d of data) {
    const height = Math.max(2, (d.amount / max) * 60);
    html += `<div class="mini-chart-bar-group" title="${d.date}: $${d.amount.toFixed(2)}">`;
    html += `<div class="mini-chart-bar" style="height:${height}px"></div>`;
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="mini-chart-labels">';
  html += `<span>${data[0].date.slice(5)}</span>`;
  html += `<span>${data[data.length - 1].date.slice(5)}</span>`;
  html += '</div>';

  container.innerHTML = html;
}

const PROVIDER_COLORS = {
  anthropic: '#e94560',
  openai: '#00c853',
  google: '#4285f4',
  moonshot: '#ffd600',
};

function drawLineChart(canvas, dailyData) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);

  const data = safeArray(dailyData).map((d) => ({
    date: safeString(d.date, ''),
    amount: safeNumber(typeof d.amount === 'string' ? parseFloat(d.amount) : d.amount, 0),
  }));

  if (data.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No earnings data yet', w / 2, h / 2);
    return;
  }

  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.amount), 0.01) * 1.1;

  // Grid lines
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + (plotH / gridLines) * i;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    // Y axis labels
    const val = max - (max / gridLines) * i;
    ctx.setLineDash([]);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`$${val.toFixed(2)}`, pad.left - 6, y + 4);
  }

  // Line
  ctx.setLineDash([]);
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + (i / Math.max(data.length - 1, 1)) * plotW;
    const y = pad.top + plotH - (data[i].amount / max) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // X axis labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  const labelStep = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += labelStep) {
    const x = pad.left + (i / Math.max(data.length - 1, 1)) * plotW;
    ctx.fillText(data[i].date.slice(5), x, h - 8);
  }
  if (data.length > 1) {
    const lastX = pad.left + plotW;
    ctx.fillText(data[data.length - 1].date.slice(5), lastX, h - 8);
  }
}

function drawPieChart(canvas, providerData) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);

  const data = safeArray(providerData).map((d) => ({
    provider: safeString(d.provider, 'unknown'),
    amount: safeNumber(typeof d.amount === 'string' ? parseFloat(d.amount) : d.amount, 0),
  })).filter((d) => d.amount > 0);

  if (data.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No provider data yet', w / 2, h / 2);
    return;
  }

  const total = data.reduce((sum, d) => sum + d.amount, 0);
  const cx = w * 0.4;
  const cy = h / 2;
  const r = Math.min(cx - 20, cy - 20, 80);

  let startAngle = -Math.PI / 2;
  for (const d of data) {
    const sliceAngle = (d.amount / total) * 2 * Math.PI;
    const color = PROVIDER_COLORS[d.provider] || '#888';

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    startAngle += sliceAngle;
  }

  // Legend
  const legendX = cx + r + 30;
  let legendY = cy - (data.length * 20) / 2;
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'left';
  for (const d of data) {
    const color = PROVIDER_COLORS[d.provider] || '#888';
    const pct = ((d.amount / total) * 100).toFixed(0);
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY, 10, 10);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(`${d.provider} ${pct}% ($${d.amount.toFixed(2)})`, legendX + 16, legendY + 9);
    legendY += 20;
  }
}

function sortItems(items, sortState) {
  const { key, dir } = sortState;
  return [...items].sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    if (Array.isArray(va)) va = va.join(', ');
    if (Array.isArray(vb)) vb = vb.join(', ');
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function updateSortHeaders(thead, sortState) {
  if (!thead) return;
  const ths = thead.querySelectorAll('.sortable');
  for (const th of ths) {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortState.key) {
      th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  }
}

function filterPeers(peers, filterText) {
  if (!filterText) return peers;
  const lower = filterText.toLowerCase();
  return peers.filter((peer) => {
    const searchable = [
      peer.peerId,
      safeString(peer.source, ''),
      peer.providers.join(' '),
      formatPrice(peer.pricePerToken),
      String(peer.capacityMsgPerHour),
      String(peer.reputation),
      safeString(peer.location, ''),
      formatEndpoint(peer),
    ].join(' ').toLowerCase();
    return searchable.includes(lower);
  });
}

function renderPeersTable(peers) {
  if (!elements.peersBody) return;
  uiState.lastPeers = peers;

  const filtered = filterPeers(peers, uiState.peerFilter);
  const sorted = sortItems(filtered, uiState.peerSort);
  updateSortHeaders(elements.peersHead, uiState.peerSort);

  elements.peersBody.innerHTML = '';
  if (sorted.length === 0) {
    elements.peersBody.appendChild(buildEmptyRow(8, peers.length > 0 ? 'No peers match filter.' : 'No peers discovered yet.'));
    return;
  }

  for (const peer of sorted) {
    const row = document.createElement('tr');

    const peerId = document.createElement('td');
    peerId.textContent = formatShortId(peer.peerId);
    peerId.title = peer.peerId;

    const source = document.createElement('td');
    source.textContent = safeString(peer.source, 'n/a').toUpperCase();

    const providers = document.createElement('td');
    providers.textContent = peer.providers.length > 0 ? peer.providers.join(', ') : 'n/a';

    const price = document.createElement('td');
    price.textContent = formatPrice(peer.pricePerToken);

    const capacity = document.createElement('td');
    capacity.textContent = peer.capacityMsgPerHour > 0 ? `${formatInt(peer.capacityMsgPerHour)}/h` : 'n/a';

    const reputation = document.createElement('td');
    reputation.textContent = formatInt(peer.reputation);

    const location = document.createElement('td');
    location.textContent = peer.location && peer.location.trim().length > 0 ? peer.location : '-';

    const endpoint = document.createElement('td');
    endpoint.textContent = formatEndpoint(peer);

    row.append(peerId, source, providers, price, capacity, reputation, location, endpoint);
    elements.peersBody.appendChild(row);
  }
}

function renderSessionsTable(payload) {
  if (!elements.sessionsBody) return;
  uiState.lastSessionsPayload = payload;

  const sessions = sortItems(safeArray(payload?.sessions), uiState.sessionSort);
  updateSortHeaders(elements.sessionsHead, uiState.sessionSort);

  elements.sessionsBody.innerHTML = '';

  if (sessions.length === 0) {
    elements.sessionsBody.appendChild(buildEmptyRow(8, 'No sessions yet.'));
    return;
  }

  for (const session of sessions) {
    const row = document.createElement('tr');

    const sessionId = document.createElement('td');
    sessionId.textContent = formatShortId(session.sessionId, 10, 6);
    sessionId.title = safeString(session.sessionId, '');

    const provider = document.createElement('td');
    provider.textContent = safeString(session.provider, 'n/a');

    const started = document.createElement('td');
    started.textContent = formatTimestamp(session.startedAt);

    const tokens = document.createElement('td');
    tokens.textContent = formatInt(session.totalTokens);

    const requests = document.createElement('td');
    requests.textContent = formatInt(session.totalRequests);

    const duration = document.createElement('td');
    duration.textContent = formatDuration(session.durationMs);

    const latency = document.createElement('td');
    latency.textContent = formatLatency(session.avgLatencyMs);

    const switches = document.createElement('td');
    switches.textContent = formatInt(session.peerSwitches);

    row.append(sessionId, provider, started, tokens, requests, duration, latency, switches);
    elements.sessionsBody.appendChild(row);
  }
}

function renderSimple2ColTable(target, rows, emptyLabel) {
  if (!target) return;

  target.innerHTML = '';
  if (rows.length === 0) {
    target.appendChild(buildEmptyRow(2, emptyLabel));
    return;
  }

  for (const values of rows) {
    const row = document.createElement('tr');

    const left = document.createElement('td');
    left.textContent = values[0];

    const right = document.createElement('td');
    right.textContent = values[1];

    row.append(left, right);
    target.appendChild(row);
  }
}

function renderOfflineState(message) {
  setText(elements.peersMessage, message);
  setText(elements.sessionsMessage, message);
  setText(elements.earningsMessage, message);
  setText(elements.configMessage, message);

  setText(elements.ovNodeState, 'idle');
  setText(elements.ovPeers, '0');
  setText(elements.ovSessions, '0');
  setText(elements.ovEarnings, '$0.00');
  setText(elements.ovDhtHealth, 'Down');
  setText(elements.ovUptime, '0s');
  setText(elements.ovPeersCount, '0');

  renderOverviewPeers([]);
  renderCapacityRing(0, 0, 0, 0, 0);
  renderMiniChart([]);
  renderPeersTable([]);
  renderSessionsTable({ sessions: [] });
  drawLineChart(elements.earningsLineChart, []);
  drawPieChart(elements.earningsPieChart, []);

  setText(elements.earnToday, '$0.00');
  setText(elements.earnWeek, '$0.00');
  setText(elements.earnMonth, '$0.00');

  setText(elements.connectionStatus, message);
  setText(elements.connectionNetwork, message);
  setText(elements.connectionSources, message);
  setText(elements.connectionNotes, message);
  // Config form stays as-is when offline
  setText(elements.overviewDataSources, message);

  setBadgeTone(elements.overviewBadge, 'idle', 'Idle');
  setBadgeTone(elements.peersMeta, 'idle', '0 peers');
  setBadgeTone(elements.sessionsMeta, 'idle', '0 sessions');
  setBadgeTone(elements.earningsMeta, 'idle', 'month');
  setBadgeTone(elements.connectionMeta, 'idle', 'offline');
  setBadgeTone(elements.configMeta, 'idle', 'offline');
}

function renderDashboardData(results) {
  const networkOk = results.network.ok || results.peers.ok;
  const normalizedNetwork = normalizeNetworkData(
    results.network.ok ? results.network.data : null,
    results.peers.ok ? results.peers.data : null,
  );

  const peers = normalizedNetwork.peers;
  const stats = normalizedNetwork.stats;
  const dht = networkHealth(stats, peers.length);

  const statusPayload = results.status.ok ? results.status.data : null;
  const sessionsPayload = results.sessions.ok ? results.sessions.data : null;
  const earningsPayload = results.earnings.ok ? results.earnings.data : null;
  const dataSourcesPayload = results.dataSources.ok ? results.dataSources.data : null;
  const configPayload = results.config.ok ? results.config.data : null;

  const daemonStateRoot = safeObject(uiState.daemonState?.state);
  const daemonActiveSessions = safeNumber(daemonStateRoot?.activeSessions, 0);
  const daemonSessionDetails = safeArray(daemonStateRoot?.activeSessionDetails);
  const daemonDetailsCount = daemonSessionDetails.length;

  const nodeState = safeString(statusPayload?.state, 'idle');
  const activeSessions = Math.max(
    safeNumber(statusPayload?.activeSessions, safeNumber(sessionsPayload?.total, 0)),
    daemonActiveSessions,
    daemonDetailsCount,
  );
  const earningsToday = earningsPayload?.today ?? statusPayload?.earningsToday ?? '0';
  const uptime = safeString(statusPayload?.uptime, '0s');

  setText(elements.ovNodeState, nodeState);
  setText(elements.ovPeers, formatInt(peers.length));
  setText(elements.ovSessions, formatInt(activeSessions));
  setText(elements.ovEarnings, formatMoney(earningsToday));
  setText(elements.ovDhtHealth, dht.label);
  setText(elements.ovUptime, uptime);
  setText(elements.ovPeersCount, formatInt(peers.length));

  if (activeSessions > 0 && uiState.lastActiveSessions === 0) {
    if (getActiveView() === 'overview') {
      setActiveView('sessions');
      appendSystemLog('Active session detected. Switched to Sessions view.');
    }
  }
  uiState.lastActiveSessions = activeSessions;

  setBadgeTone(
    elements.overviewBadge,
    nodeState === 'idle' && !isModeRunning('seed') && !isModeRunning('connect') ? 'idle' : dht.tone,
    `${nodeState.toUpperCase()} • DHT ${dht.label}`,
  );

  renderOverviewPeers(peers);

  const capacityPercent = safeNumber(statusPayload?.capacityUsedPercent, 0);
  const proxyPort = safeNumber(statusPayload?.proxyPort, 0);
  renderCapacityRing(capacityPercent, proxyPort, activeSessions, peers.length, stats.dhtNodeCount);

  if (results.earnings.ok) {
    renderMiniChart(safeArray(earningsPayload?.daily));
  }

  renderPeersTable(peers);

  if (networkOk) {
    setText(elements.peersMessage, `Peer visibility merged from daemon and DHT. Last scan: ${formatRelativeTime(stats.lastScanAt)}`);
  } else {
    const msg = results.network.error ?? results.peers.error ?? 'network unavailable';
    setText(elements.peersMessage, `Unable to load peers: ${msg}`);
  }

  setBadgeTone(
    elements.peersMeta,
    dht.tone,
    `${formatInt(peers.length)} peers • DHT ${dht.label}`,
  );

  const sessionRowsFromApi = safeArray(sessionsPayload?.sessions);
  const totalSessionsFromApi = safeNumber(sessionsPayload?.total, sessionRowsFromApi.length);
  const missingLiveSessions = Math.max(0, activeSessions - totalSessionsFromApi);

  let sessionsForTable = sessionsPayload;
  let usingLiveSessionFallback = false;
  let sessionsUnavailable = false;

  if (!results.sessions.ok) {
    sessionsUnavailable = true;
  }

  if (sessionRowsFromApi.length === 0 && (activeSessions > 0 || daemonDetailsCount > 0)) {
    const now = Date.now();
    const fromDaemon = daemonSessionDetails
      .map((entry, index) => {
        const row = safeObject(entry);
        if (!row) {
          return null;
        }
        const startedAt = safeNumber(row.startedAt, now);
        return {
          sessionId: safeString(row.sessionId, `live-${index + 1}`),
          provider: safeString(row.provider, 'live'),
          startedAt,
          totalTokens: safeNumber(row.totalTokens, 0),
          totalRequests: safeNumber(row.totalRequests, 0),
          durationMs: Math.max(0, now - startedAt),
          avgLatencyMs: safeNumber(row.avgLatencyMs, 0),
          peerSwitches: 0,
        };
      })
      .filter((item) => item !== null);

    const fallbackRows = fromDaemon.length > 0
      ? fromDaemon
      : Array.from({ length: Math.max(1, Math.round(activeSessions)) }, (_, index) => ({
        sessionId: `live-${index + 1}`,
        provider: 'live',
        startedAt: now,
        totalTokens: 0,
        totalRequests: 0,
        durationMs: 0,
        avgLatencyMs: 0,
        peerSwitches: 0,
      }));
    sessionsForTable = {
      sessions: fallbackRows,
      total: fallbackRows.length,
    };
    usingLiveSessionFallback = true;
  }

  const sessionDebugKey = [
    `status=${safeNumber(statusPayload?.activeSessions, -1)}`,
    `daemon=${daemonActiveSessions}`,
    `details=${daemonDetailsCount}`,
    `apiTotal=${totalSessionsFromApi}`,
    `apiRows=${sessionRowsFromApi.length}`,
    `apiOk=${results.sessions.ok}`,
    `fallback=${usingLiveSessionFallback}`,
  ].join('|');
  if (sessionDebugKey !== uiState.lastSessionDebugKey) {
    uiState.lastSessionDebugKey = sessionDebugKey;
    appendSystemLog(`Session debug: ${sessionDebugKey}`);
  }

  renderSessionsTable(sessionsForTable);
  if (results.sessions.ok || usingLiveSessionFallback) {
    const totalSessions = Math.max(totalSessionsFromApi, activeSessions);
    setBadgeTone(elements.sessionsMeta, totalSessions > 0 ? 'active' : 'idle', `${formatInt(totalSessions)} sessions`);
    if (usingLiveSessionFallback) {
      setText(
        elements.sessionsMessage,
        sessionsUnavailable
          ? `${formatInt(activeSessions)} active session(s) detected from daemon state. Sessions API is degraded, showing live placeholders.`
          : `${formatInt(activeSessions)} active session(s) detected from daemon state. Detailed metering rows will appear as writes land.`,
      );
    } else if (missingLiveSessions > 0) {
      setText(
        elements.sessionsMessage,
        `Showing ${formatInt(totalSessionsFromApi)} metered session(s). ${formatInt(missingLiveSessions)} live session(s) are still syncing.`,
      );
    } else {
      setText(elements.sessionsMessage, 'Session metrics from metering storage.');
    }
  } else {
    setBadgeTone(elements.sessionsMeta, 'warn', 'sessions unavailable');
    setText(elements.sessionsMessage, `Unable to load sessions: ${results.sessions.error ?? 'unknown error'}`);
  }

  if (results.earnings.ok) {
    setText(elements.earnToday, formatMoney(earningsPayload?.today));
    setText(elements.earnWeek, formatMoney(earningsPayload?.thisWeek));
    setText(elements.earnMonth, formatMoney(earningsPayload?.thisMonth));

    drawLineChart(elements.earningsLineChart, safeArray(earningsPayload?.daily));
    drawPieChart(elements.earningsPieChart, safeArray(earningsPayload?.byProvider));

    setText(elements.earningsMessage, 'Earnings from metering data.');
    setBadgeTone(elements.earningsMeta, 'active', uiState.earningsPeriod);
  } else {
    setText(elements.earningsMessage, `Unable to load earnings: ${results.earnings.error ?? 'unknown error'}`);
    setText(elements.earnToday, '$0.00');
    setText(elements.earnWeek, '$0.00');
    setText(elements.earnMonth, '$0.00');
    drawLineChart(elements.earningsLineChart, []);
    drawPieChart(elements.earningsPieChart, []);
    setBadgeTone(elements.earningsMeta, 'warn', 'degraded');
  }

  if (results.status.ok) {
    setText(elements.connectionStatus, JSON.stringify(statusPayload, null, 2));
  } else {
    setText(elements.connectionStatus, `Unable to load status: ${results.status.error ?? 'unknown error'}`);
  }

  if (networkOk) {
    setText(elements.connectionNetwork, JSON.stringify({ peers: peers.slice(0, 200), stats }, null, 2));
  } else {
    setText(elements.connectionNetwork, `Unable to load network: ${results.network.error ?? 'unknown error'}`);
  }

  if (results.dataSources.ok) {
    setText(elements.connectionSources, JSON.stringify(dataSourcesPayload, null, 2));
  } else {
    setText(elements.connectionSources, `Unable to load data sources: ${results.dataSources.error ?? 'unknown error'}`);
  }

  const degradedReasons = safeArray(dataSourcesPayload?.degradedReasons)
    .filter((item) => typeof item === 'string' && item.trim().length > 0);

  const notes = [
    `DHT health: ${dht.label}`,
    `DHT nodes: ${formatInt(stats.dhtNodeCount)}`,
    `Lookup success: ${formatPercent(stats.lookupSuccessRate * 100)}`,
    `Avg lookup latency: ${formatLatency(stats.averageLookupLatencyMs)}`,
    `Last scan: ${formatRelativeTime(stats.lastScanAt)}`,
    `Capacity used: ${formatPercent(statusPayload?.capacityUsedPercent)}`,
    `Daemon alive: ${Boolean(statusPayload?.daemonAlive)}`,
  ];

  if (safeString(stats.healthReason, '').length > 0) {
    notes.push(`DHT reason: ${stats.healthReason}`);
  }

  if (degradedReasons.length > 0) {
    notes.push(`Data source degraded: ${degradedReasons.join(' | ')}`);
  }

  setText(elements.connectionNotes, notes.join('\n'));
  setBadgeTone(elements.connectionMeta, dht.tone, `DHT ${dht.label}`);

  if (results.config.ok) {
    const config = configPayload?.config ?? configPayload;
    populateSettingsForm(config);

    const pluginCount = safeArray(config?.plugins).length;
    setBadgeTone(elements.configMeta, 'active', `${pluginCount} plugins`);
    setText(elements.configMessage, 'Settings loaded from dashboard API.');
  } else {
    setText(elements.configMessage, `Unable to load config: ${results.config.error ?? 'unknown error'}`);
    setBadgeTone(elements.configMeta, 'warn', 'config unavailable');
  }
}

async function refreshDashboardData(processes) {
  if (!isModeRunning('dashboard', processes)) {
    renderOfflineState('Dashboard engine is offline. Start or restart it from Desktop Controls.');
    return;
  }

  const [
    network,
    peers,
    sessions,
    earnings,
    status,
    dataSources,
    config,
  ] = await Promise.all([
    getDashboardData('network'),
    getDashboardData('peers'),
    getDashboardData('sessions', { limit: 100, offset: 0 }),
    getDashboardData('earnings', { period: uiState.earningsPeriod }),
    getDashboardData('status'),
    getDashboardData('data-sources'),
    getDashboardData('config'),
  ]);

  renderDashboardData({
    network,
    peers,
    sessions,
    earnings,
    status,
    dataSources,
    config,
  });

  // Refresh wallet, chat data, and proxy status in parallel
  void refreshWalletInfo();
  void refreshChatConversations();
  void refreshChatProxyStatus();
}

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

function appendSystemLog(message) {
  appendLog({
    mode: 'dashboard',
    stream: 'system',
    line: message,
    timestamp: Date.now(),
  });
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
    await bridge.start({
      mode: 'connect',
      router: safeString(elements.connectRouter?.value, 'claude-code').trim() || 'claude-code',
    });
  });

  bindAction('connectStopBtn', async () => {
    await bridge.stop('connect');
  });

  bindAction('dashboardRestartBtn', async () => {
    await bridge.stop('dashboard');
    await bridge.start({
      mode: 'dashboard',
      dashboardPort: getDashboardPort(),
    });
  });

  bindAction('dashboardOpenBtn', async () => {
    await bridge.openDashboard(getDashboardPort());
  }, { refreshAfter: false });

  bindAction('refreshBtn', refreshAll);

  bindAction('clearLogsBtn', async () => {
    await bridge.clearLogs();
  });

  bindAction('startAllBtn', async () => {
    if (!isModeRunning('dashboard')) {
      await bridge.start({ mode: 'dashboard', dashboardPort: getDashboardPort() });
    }
    if (!isModeRunning('seed')) {
      await bridge.start({
        mode: 'seed',
        provider: safeString(elements.seedProvider?.value, 'anthropic').trim() || 'anthropic',
      });
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
    if (isModeRunning('dashboard')) {
      await bridge.stop('dashboard');
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

  void refreshAll();
  setInterval(() => {
    void refreshAll();
  }, POLL_INTERVAL_MS);
}

if (elements.dashboardPort) {
  elements.dashboardPort.addEventListener('change', () => {
    if (isModeRunning('dashboard')) {
      appendSystemLog('Dashboard port updated. Click Restart to move the embedded dashboard engine.');
    }
  });
}

if (elements.ovSessionsCard) {
  elements.ovSessionsCard.title = 'Open Sessions view';
  elements.ovSessionsCard.addEventListener('click', () => {
    setActiveView('sessions');
  });
}

function initSortableHeaders() {
  if (elements.peersHead) {
    elements.peersHead.addEventListener('click', (e) => {
      const th = e.target.closest('.sortable');
      if (!th) return;
      const key = th.dataset.sort;
      if (uiState.peerSort.key === key) {
        uiState.peerSort.dir = uiState.peerSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        uiState.peerSort = { key, dir: 'asc' };
      }
      renderPeersTable(uiState.lastPeers);
    });
  }

  if (elements.sessionsHead) {
    elements.sessionsHead.addEventListener('click', (e) => {
      const th = e.target.closest('.sortable');
      if (!th) return;
      const key = th.dataset.sort;
      if (uiState.sessionSort.key === key) {
        uiState.sessionSort.dir = uiState.sessionSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        uiState.sessionSort = { key, dir: 'asc' };
      }
      if (uiState.lastSessionsPayload) {
        renderSessionsTable(uiState.lastSessionsPayload);
      }
    });
  }
}

if (elements.peerFilter) {
  elements.peerFilter.addEventListener('input', (e) => {
    uiState.peerFilter = e.target.value;
    renderPeersTable(uiState.lastPeers);
  });
}

// ── Wallet Functions ──

async function refreshWalletInfo() {
  if (!bridge || !bridge.walletGetInfo) return;

  try {
    const result = await bridge.walletGetInfo(getDashboardPort());
    if (result.ok && result.data) {
      uiState.walletInfo = result.data;
      renderWalletView(result.data);
    } else {
      setText(elements.walletMessage, result.error || 'Unable to load wallet info');
      setBadgeTone(elements.walletMeta, 'warn', 'Error');
    }
  } catch (err) {
    setText(elements.walletMessage, 'Wallet bridge unavailable');
  }
}

function renderWalletView(info) {
  if (!info) return;

  const addr = info.address;
  if (addr) {
    setText(elements.walletAddress, addr);
    setBadgeTone(elements.walletMeta, 'active', `${addr.slice(0, 6)}...${addr.slice(-4)}`);
  } else {
    setText(elements.walletAddress, 'Not configured');
    setBadgeTone(elements.walletMeta, 'idle', 'Not connected');
  }

  setText(elements.walletChain, safeString(info.chainId, 'base-sepolia'));
  setText(elements.walletETH, `${safeString(info.balanceETH, '0.00')} ETH`);
  setText(elements.walletUSDC, `${safeString(info.balanceUSDC, '0.00')} USDC`);
  setText(elements.walletNetwork, 'Base');
  setText(elements.escrowDeposited, formatMoney(info.escrow?.deposited));
  setText(elements.escrowCommitted, formatMoney(info.escrow?.committed));
  setText(elements.escrowAvailable, formatMoney(info.escrow?.available));
  setText(elements.walletMessage, addr ? 'Wallet derived from node identity.' : 'Configure wallet address in Settings or start seeding to auto-generate.');
}

function showWalletAction(text, type) {
  if (!elements.walletActionMessage) return;
  elements.walletActionMessage.textContent = text;
  elements.walletActionMessage.className = `message settings-message ${type}`;
  setTimeout(() => {
    if (elements.walletActionMessage.textContent === text) {
      elements.walletActionMessage.textContent = '';
      elements.walletActionMessage.className = 'message';
    }
  }, 8000);
}

if (elements.walletDepositBtn && bridge) {
  elements.walletDepositBtn.addEventListener('click', async () => {
    const amount = elements.walletAmount?.value;
    if (!amount || Number(amount) <= 0) {
      showWalletAction('Enter a valid amount', 'error');
      return;
    }
    elements.walletDepositBtn.disabled = true;
    try {
      const result = await bridge.walletDeposit(amount);
      const action = getWalletActionResult(result, 'Deposit initiated', 'Deposit failed');
      showWalletAction(action.message, action.type);
    } catch (err) {
      showWalletAction('Deposit failed', 'error');
    } finally {
      elements.walletDepositBtn.disabled = false;
    }
  });
}

if (elements.walletWithdrawBtn && bridge) {
  elements.walletWithdrawBtn.addEventListener('click', async () => {
    const amount = elements.walletAmount?.value;
    if (!amount || Number(amount) <= 0) {
      showWalletAction('Enter a valid amount', 'error');
      return;
    }
    elements.walletWithdrawBtn.disabled = true;
    try {
      const result = await bridge.walletWithdraw(amount);
      const action = getWalletActionResult(result, 'Withdrawal initiated', 'Withdrawal failed');
      showWalletAction(action.message, action.type);
    } catch (err) {
      showWalletAction('Withdrawal failed', 'error');
    } finally {
      elements.walletWithdrawBtn.disabled = false;
    }
  });
}

if (elements.walletCopyBtn) {
  elements.walletCopyBtn.addEventListener('click', () => {
    const addr = elements.walletAddress?.textContent;
    if (addr && addr !== 'Not configured') {
      navigator.clipboard.writeText(addr).then(() => {
        elements.walletCopyBtn.textContent = 'Copied!';
        setTimeout(() => { elements.walletCopyBtn.textContent = 'Copy'; }, 1500);
      });
    }
  });
}

// ── WalletConnect Functions ──

function setWalletMode(mode) {
  uiState.walletMode = mode;
  if (elements.walletModeNode) elements.walletModeNode.classList.toggle('active', mode === 'node');
  if (elements.walletModeExternal) elements.walletModeExternal.classList.toggle('active', mode === 'external');
  if (elements.walletNodeSection) elements.walletNodeSection.style.display = mode === 'node' ? '' : 'none';
  if (elements.walletExternalSection) elements.walletExternalSection.style.display = mode === 'external' ? '' : 'none';
}

if (elements.walletModeNode) {
  elements.walletModeNode.addEventListener('click', () => setWalletMode('node'));
}

if (elements.walletModeExternal) {
  elements.walletModeExternal.addEventListener('click', () => {
    setWalletMode('external');
    refreshWcState();
  });
}

function renderWcState(state) {
  uiState.wcState = state || uiState.wcState;
  const s = uiState.wcState;

  if (s.connected && s.address) {
    setText(elements.wcStatusText, 'Connected');
    if (elements.wcAddressRow) elements.wcAddressRow.style.display = '';
    setText(elements.wcAddress, s.address);
    if (elements.wcConnectBtn) elements.wcConnectBtn.style.display = 'none';
    if (elements.wcDisconnectBtn) elements.wcDisconnectBtn.style.display = '';
    if (elements.wcQrContainer) elements.wcQrContainer.style.display = 'none';
  } else if (s.pairingUri) {
    setText(elements.wcStatusText, 'Waiting for approval...');
    if (elements.wcAddressRow) elements.wcAddressRow.style.display = 'none';
    if (elements.wcConnectBtn) elements.wcConnectBtn.style.display = 'none';
    if (elements.wcDisconnectBtn) elements.wcDisconnectBtn.style.display = 'none';
    if (elements.wcQrContainer) elements.wcQrContainer.style.display = '';
    drawQrCode(s.pairingUri);
  } else {
    setText(elements.wcStatusText, 'Not connected');
    if (elements.wcAddressRow) elements.wcAddressRow.style.display = 'none';
    if (elements.wcConnectBtn) elements.wcConnectBtn.style.display = '';
    if (elements.wcDisconnectBtn) elements.wcDisconnectBtn.style.display = 'none';
    if (elements.wcQrContainer) elements.wcQrContainer.style.display = 'none';
  }
}

async function refreshWcState() {
  if (!bridge || !bridge.walletConnectState) return;
  try {
    const result = await bridge.walletConnectState();
    if (result.ok) {
      renderWcState(result.data);
    }
  } catch {
    // WC unavailable
  }
}

async function connectWalletConnect() {
  if (!bridge || !bridge.walletConnectConnect) return;
  if (elements.wcConnectBtn) elements.wcConnectBtn.disabled = true;

  try {
    const result = await bridge.walletConnectConnect();
    if (!result.ok) {
      showWalletAction(result.error || 'Failed to start WalletConnect', 'error');
    }
  } catch (err) {
    showWalletAction('WalletConnect connection failed', 'error');
  } finally {
    if (elements.wcConnectBtn) elements.wcConnectBtn.disabled = false;
  }
}

async function disconnectWalletConnect() {
  if (!bridge || !bridge.walletConnectDisconnect) return;
  try {
    await bridge.walletConnectDisconnect();
    renderWcState({ connected: false, address: null, chainId: null, pairingUri: null });
  } catch (err) {
    showWalletAction('Disconnect failed', 'error');
  }
}

function drawQrCode(text) {
  const canvas = elements.wcQrCanvas;
  if (!canvas) return;

  // Lightweight inline QR code generator (numeric mode for URI)
  // Uses a simple grid pattern as a visual placeholder
  const ctx = canvas.getContext('2d');
  const size = 260;
  canvas.width = size;
  canvas.height = size;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Generate a deterministic pattern from the URI
  const moduleCount = 33;
  const cellSize = Math.floor(size / moduleCount);
  const offset = Math.floor((size - cellSize * moduleCount) / 2);

  ctx.fillStyle = '#000000';

  // Create hash-based modules from the text
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }

  // Draw finder patterns (3 corners)
  const drawFinder = (x, y) => {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const isOuter = dy === 0 || dy === 6 || dx === 0 || dx === 6;
        const isInner = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
        if (isOuter || isInner) {
          ctx.fillRect(offset + (x + dx) * cellSize, offset + (y + dy) * cellSize, cellSize, cellSize);
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(moduleCount - 7, 0);
  drawFinder(0, moduleCount - 7);

  // Fill data modules with hash-seeded pattern
  let seed = Math.abs(hash);
  for (let y = 0; y < moduleCount; y++) {
    for (let x = 0; x < moduleCount; x++) {
      // Skip finder pattern areas
      if ((x < 8 && y < 8) || (x >= moduleCount - 8 && y < 8) || (x < 8 && y >= moduleCount - 8)) {
        continue;
      }
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (seed % 3 === 0) {
        ctx.fillRect(offset + x * cellSize, offset + y * cellSize, cellSize, cellSize);
      }
    }
  }

  // Note: For production, use a real QR encoding library.
  // This placeholder pattern visually indicates a QR code
  // but is NOT scannable. The actual URI is copied via button.

  // Add a "Copy URI" hint text below the pattern
  ctx.fillStyle = '#666666';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Copy the URI and paste in your wallet', size / 2, size - 4);
}

if (elements.wcConnectBtn) {
  elements.wcConnectBtn.addEventListener('click', connectWalletConnect);
}

if (elements.wcDisconnectBtn) {
  elements.wcDisconnectBtn.addEventListener('click', disconnectWalletConnect);
}

if (elements.wcCopyBtn) {
  elements.wcCopyBtn.addEventListener('click', () => {
    const addr = elements.wcAddress?.textContent;
    if (addr && addr !== '-') {
      navigator.clipboard.writeText(addr).then(() => {
        elements.wcCopyBtn.textContent = 'Copied!';
        setTimeout(() => { elements.wcCopyBtn.textContent = 'Copy'; }, 1500);
      });
    }
  });
}

// Listen for WalletConnect state changes
if (bridge && bridge.onWalletConnectStateChanged) {
  bridge.onWalletConnectStateChanged((state) => {
    renderWcState(state);
  });
}

// ── AI Chat Functions ──

function formatChatTime(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  // Basic code block rendering for assistant messages
  let html = escapeHtml(text);
  // Fenced code blocks: ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
    return `<pre class="chat-code-block">${langLabel}<code>${code}</code></pre>`;
  });
  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Newlines to <br>
  html = html.replace(/\n/g, '<br>');
  return html;
}

async function refreshChatProxyStatus() {
  if (!bridge || !bridge.chatAiGetProxyStatus) return;

  try {
    const result = await bridge.chatAiGetProxyStatus();
    if (result.ok && result.data) {
      const { running, port } = result.data;
      if (running) {
        setBadgeTone(elements.chatProxyStatus, 'active', `Proxy :${port}`);
      } else {
        setBadgeTone(elements.chatProxyStatus, 'idle', 'Proxy offline');
      }
    }
  } catch {
    setBadgeTone(elements.chatProxyStatus, 'idle', 'Proxy offline');
  }
}

async function refreshChatConversations() {
  if (!bridge || !bridge.chatAiListConversations) return;

  try {
    const result = await bridge.chatAiListConversations();
    if (result.ok) {
      uiState.chatConversations = result.data || [];
      renderChatConversations();
    }
  } catch {
    // Chat unavailable
  }
}

function renderChatConversations() {
  const container = elements.chatConversations;
  if (!container) return;

  const convs = uiState.chatConversations;
  if (convs.length === 0) {
    container.innerHTML = '<div class="chat-empty">No conversations yet</div>';
    return;
  }

  container.innerHTML = '';
  for (const conv of convs) {
    const item = document.createElement('div');
    item.className = `chat-conv-item${conv.id === uiState.chatActiveConversation ? ' active' : ''}`;
    item.dataset.convId = conv.id;

    let html = `<div class="chat-conv-peer">${escapeHtml(conv.title)}</div>`;
    if (conv.updatedAt > 0) {
      html += `<span class="chat-conv-time">${formatChatTime(conv.updatedAt)}</span>`;
    }
    html += `<div class="chat-conv-preview">${conv.messageCount} messages · ${conv.model.split('-').slice(0, 2).join('-')}</div>`;

    item.innerHTML = html;
    item.addEventListener('click', () => openConversation(conv.id));
    container.appendChild(item);
  }
}

async function openConversation(convId) {
  if (!bridge || !bridge.chatAiGetConversation) return;

  uiState.chatActiveConversation = convId;

  try {
    const result = await bridge.chatAiGetConversation(convId);
    if (result.ok && result.data) {
      const conv = result.data;
      uiState.chatMessages = conv.messages || [];

      // Update header
      const header = elements.chatHeader;
      if (header) {
        const peerSpan = header.querySelector('.chat-thread-peer');
        if (peerSpan) peerSpan.textContent = conv.title;
      }

      // Show delete button
      if (elements.chatDeleteBtn) elements.chatDeleteBtn.style.display = '';

      // Set model selector
      if (elements.chatModelSelect) {
        elements.chatModelSelect.value = conv.model;
      }

      // Enable input
      if (elements.chatInput) elements.chatInput.disabled = false;
      if (elements.chatSendBtn) elements.chatSendBtn.disabled = false;

      renderChatMessages();
      renderChatConversations();
    }
  } catch {
    // Conversation load failed
  }
}

function renderChatMessages() {
  const container = elements.chatMessages;
  if (!container) return;

  const msgs = uiState.chatMessages;
  if (msgs.length === 0) {
    container.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-title">Leechless AI Chat</div>
        <div class="chat-welcome-subtitle">Send messages through the P2P marketplace to inference providers.</div>
        <div class="chat-welcome-subtitle">Start the Buyer runtime and create a new conversation to begin.</div>
      </div>`;
    return;
  }

  container.innerHTML = '';
  for (const msg of msgs) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.role === 'user' ? 'own' : 'other'}`;

    if (msg.role === 'assistant') {
      bubble.innerHTML = `<div class="chat-bubble-content">${renderMarkdown(msg.content)}</div>`;
    } else {
      bubble.innerHTML = `<div>${escapeHtml(msg.content)}</div>`;
    }

    container.appendChild(bubble);
  }

  container.scrollTop = container.scrollHeight;
}

async function createNewConversation() {
  if (!bridge || !bridge.chatAiCreateConversation) return;

  const model = elements.chatModelSelect?.value || 'claude-sonnet-4-20250514';
  try {
    const result = await bridge.chatAiCreateConversation(model);
    if (result.ok && result.data) {
      await refreshChatConversations();
      await openConversation(result.data.id);
    }
  } catch (err) {
    appendSystemLog(`Failed to create conversation: ${err}`);
  }
}

async function deleteConversation() {
  const convId = uiState.chatActiveConversation;
  if (!convId || !bridge || !bridge.chatAiDeleteConversation) return;

  try {
    await bridge.chatAiDeleteConversation(convId);
    uiState.chatActiveConversation = null;
    uiState.chatMessages = [];

    // Reset UI
    if (elements.chatDeleteBtn) elements.chatDeleteBtn.style.display = 'none';
    if (elements.chatInput) elements.chatInput.disabled = true;
    if (elements.chatSendBtn) elements.chatSendBtn.disabled = true;

    const header = elements.chatHeader;
    if (header) {
      const peerSpan = header.querySelector('.chat-thread-peer');
      if (peerSpan) peerSpan.textContent = 'AI Assistant';
    }

    renderChatMessages();
    await refreshChatConversations();
  } catch (err) {
    appendSystemLog(`Failed to delete conversation: ${err}`);
  }
}

function setChatSending(sending) {
  uiState.chatSending = sending;
  if (elements.chatInput) elements.chatInput.disabled = sending;
  if (elements.chatSendBtn) {
    elements.chatSendBtn.disabled = sending;
    elements.chatSendBtn.style.display = sending ? 'none' : '';
  }
  if (elements.chatAbortBtn) elements.chatAbortBtn.style.display = sending ? '' : 'none';
  if (elements.chatStreamingIndicator) elements.chatStreamingIndicator.style.display = sending ? '' : 'none';
}

async function sendChatMessage() {
  const convId = uiState.chatActiveConversation;
  const input = elements.chatInput;
  if (!convId || !input || !bridge || !bridge.chatAiSend) return;

  const content = input.value.trim();
  if (content.length === 0) return;

  input.value = '';
  autoGrowTextarea(input);

  // Add user message to UI immediately
  uiState.chatMessages.push({ role: 'user', content });
  renderChatMessages();

  setChatSending(true);

  try {
    const model = elements.chatModelSelect?.value;
    const result = await bridge.chatAiSend(convId, content, model);
    if (!result.ok) {
      appendSystemLog(`Chat error: ${result.error}`);
    }
  } catch (err) {
    appendSystemLog(`Chat send failed: ${err}`);
  } finally {
    setChatSending(false);
  }
}

function autoGrowTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

// Chat event listeners
if (elements.chatSendBtn) {
  elements.chatSendBtn.addEventListener('click', sendChatMessage);
}

if (elements.chatAbortBtn) {
  elements.chatAbortBtn.addEventListener('click', async () => {
    if (bridge && bridge.chatAiAbort) {
      await bridge.chatAiAbort();
    }
    setChatSending(false);
  });
}

if (elements.chatInput) {
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  elements.chatInput.addEventListener('input', () => {
    autoGrowTextarea(elements.chatInput);
  });
}

if (elements.chatNewBtn) {
  elements.chatNewBtn.addEventListener('click', createNewConversation);
}

if (elements.chatDeleteBtn) {
  elements.chatDeleteBtn.addEventListener('click', deleteConversation);
}

// Listen for AI chat responses
if (bridge) {
  if (bridge.onChatAiDone) {
    bridge.onChatAiDone((data) => {
      if (data.conversationId === uiState.chatActiveConversation) {
        uiState.chatMessages.push(data.message);
        renderChatMessages();
        setChatSending(false);
      }
      refreshChatConversations();
    });
  }

  if (bridge.onChatAiError) {
    bridge.onChatAiError((data) => {
      if (data.conversationId === uiState.chatActiveConversation) {
        setChatSending(false);
        if (data.error !== 'Request aborted') {
          appendSystemLog(`AI Chat error: ${data.error}`);
        }
      }
    });
  }
}

let configFormPopulated = false;

function populateSettingsForm(config) {
  if (!config || configFormPopulated) return;
  configFormPopulated = true;

  const seller = safeObject(config.seller) ?? {};
  const buyer = safeObject(config.buyer) ?? {};
  const payments = safeObject(config.payments) ?? {};

  if (elements.cfgReserveFloor) elements.cfgReserveFloor.value = safeNumber(seller.reserveFloor, 0);
  if (elements.cfgPricePerToken) elements.cfgPricePerToken.value = safeNumber(seller.pricePerToken, 0);
  if (elements.cfgMaxBuyers) elements.cfgMaxBuyers.value = safeNumber(seller.maxConcurrentBuyers, 1);
  if (elements.cfgProxyPort) elements.cfgProxyPort.value = safeNumber(buyer.proxyPort, 8080);
  if (elements.cfgMaxPrice) elements.cfgMaxPrice.value = safeNumber(buyer.maxPricePerToken, 0);
  if (elements.cfgMinRep) elements.cfgMinRep.value = safeNumber(buyer.minPeerReputation, 0);
  if (elements.cfgPaymentMethod) elements.cfgPaymentMethod.value = safeString(payments.preferredMethod, 'crypto');
}

function getSettingsFromForm() {
  return {
    seller: {
      reserveFloor: parseInt(elements.cfgReserveFloor?.value) || 0,
      pricePerToken: parseFloat(elements.cfgPricePerToken?.value) || 0,
      maxConcurrentBuyers: parseInt(elements.cfgMaxBuyers?.value) || 1,
    },
    buyer: {
      proxyPort: parseInt(elements.cfgProxyPort?.value) || 8080,
      maxPricePerToken: parseFloat(elements.cfgMaxPrice?.value) || 0,
      minPeerReputation: parseInt(elements.cfgMinRep?.value) || 0,
    },
  };
}

async function saveConfig() {
  const configData = getSettingsFromForm();
  const saveBtn = elements.configSaveBtn;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const result = await getDashboardData('config');
    if (!result.ok) {
      showConfigMessage('Failed to read current config', 'error');
      return;
    }

    const currentConfig = result.data?.config ?? result.data;
    const merged = { ...currentConfig, ...configData };

    const port = getDashboardPort();
    const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    });

    if (response.ok) {
      showConfigMessage('Configuration saved successfully', 'success');
      configFormPopulated = false;
    } else {
      showConfigMessage('Failed to save configuration', 'error');
    }
  } catch (err) {
    showConfigMessage(`Error saving: ${err instanceof Error ? err.message : String(err)}`, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

function showConfigMessage(text, type) {
  if (!elements.configMessage) return;
  elements.configMessage.textContent = text;
  elements.configMessage.className = `message settings-message ${type}`;
  setTimeout(() => {
    if (elements.configMessage.textContent === text) {
      elements.configMessage.textContent = '';
      elements.configMessage.className = 'message';
    }
  }, 5000);
}

if (elements.configSaveBtn) {
  elements.configSaveBtn.addEventListener('click', saveConfig);
}

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
bindControls();
initSortableHeaders();
initPeriodToggle();
initializeBridge();
