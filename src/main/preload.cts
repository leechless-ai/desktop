import { contextBridge, ipcRenderer } from 'electron';
import type { RuntimeMode, RuntimeProcessState, StartOptions } from './process-manager.js';

type LogEvent = {
  mode: RuntimeMode;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  timestamp: number;
};

type RuntimeSnapshot = {
  processes: RuntimeProcessState[];
  daemonState: { exists: boolean; state: Record<string, unknown> | null };
  logs: LogEvent[];
};

type NetworkPeer = {
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

type NetworkStats = {
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

type NetworkSnapshot = {
  ok: boolean;
  peers: NetworkPeer[];
  stats: NetworkStats;
  error: string | null;
};

type DashboardEndpoint = 'status' | 'network' | 'peers' | 'sessions' | 'earnings' | 'config' | 'data-sources';

type DashboardDataResult = {
  ok: boolean;
  data: unknown | null;
  error: string | null;
  status: number | null;
};

const api = {
  getState(): Promise<RuntimeSnapshot> {
    return ipcRenderer.invoke('runtime:get-state') as Promise<RuntimeSnapshot>;
  },
  start(options: StartOptions): Promise<{ state: RuntimeProcessState; processes: RuntimeProcessState[]; daemonState: { exists: boolean; state: Record<string, unknown> | null } }> {
    return ipcRenderer.invoke('runtime:start', options) as Promise<{ state: RuntimeProcessState; processes: RuntimeProcessState[]; daemonState: { exists: boolean; state: Record<string, unknown> | null } }>;
  },
  stop(mode: RuntimeMode): Promise<{ state: RuntimeProcessState; processes: RuntimeProcessState[]; daemonState: { exists: boolean; state: Record<string, unknown> | null } }> {
    return ipcRenderer.invoke('runtime:stop', mode) as Promise<{ state: RuntimeProcessState; processes: RuntimeProcessState[]; daemonState: { exists: boolean; state: Record<string, unknown> | null } }>;
  },
  openDashboard(port?: number): Promise<{ ok: true }> {
    return ipcRenderer.invoke('runtime:open-dashboard', port) as Promise<{ ok: true }>;
  },
  clearLogs(): Promise<{ ok: true }> {
    return ipcRenderer.invoke('runtime:clear-logs') as Promise<{ ok: true }>;
  },
  getNetwork(port?: number): Promise<NetworkSnapshot> {
    return ipcRenderer.invoke('runtime:get-network', port) as Promise<NetworkSnapshot>;
  },
  getDashboardData(
    endpoint: DashboardEndpoint,
    options?: { port?: number; query?: Record<string, string | number | boolean> },
  ): Promise<DashboardDataResult> {
    return ipcRenderer.invoke('runtime:get-dashboard-data', endpoint, options) as Promise<DashboardDataResult>;
  },
  scanNetwork(port?: number): Promise<DashboardDataResult> {
    return ipcRenderer.invoke('runtime:scan-network', port) as Promise<DashboardDataResult>;
  },
  onLog(handler: (event: LogEvent) => void): () => void {
    const listener = (_: unknown, event: LogEvent) => handler(event);
    ipcRenderer.on('runtime:log', listener);
    return () => ipcRenderer.off('runtime:log', listener);
  },
  onState(handler: (states: RuntimeProcessState[]) => void): () => void {
    const listener = (_: unknown, states: RuntimeProcessState[]) => handler(states);
    ipcRenderer.on('runtime:state', listener);
    return () => ipcRenderer.off('runtime:state', listener);
  },

  // Wallet API
  walletGetInfo(port?: number): Promise<{ ok: boolean; data: unknown; error: string | null }> {
    return ipcRenderer.invoke('wallet:get-info', port);
  },
  walletDeposit(amount: string): Promise<{ ok: boolean; error?: string; message?: string }> {
    return ipcRenderer.invoke('wallet:deposit', amount);
  },
  walletWithdraw(amount: string): Promise<{ ok: boolean; error?: string; message?: string }> {
    return ipcRenderer.invoke('wallet:withdraw', amount);
  },

  // WalletConnect API
  walletConnectState(): Promise<{ ok: boolean; data: { connected: boolean; address: string | null; chainId: number | null; pairingUri: string | null } }> {
    return ipcRenderer.invoke('wallet:wc-state');
  },
  walletConnectConnect(): Promise<{ ok: boolean; data?: { uri: string }; error?: string }> {
    return ipcRenderer.invoke('wallet:wc-connect');
  },
  walletConnectDisconnect(): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke('wallet:wc-disconnect');
  },
  onWalletConnectStateChanged(handler: (state: { connected: boolean; address: string | null; chainId: number | null; pairingUri: string | null }) => void): () => void {
    const listener = (_: unknown, state: { connected: boolean; address: string | null; chainId: number | null; pairingUri: string | null }) => handler(state);
    ipcRenderer.on('wallet:wc-state-changed', listener);
    return () => ipcRenderer.off('wallet:wc-state-changed', listener);
  },

  // AI Chat API
  chatAiListConversations(): Promise<{ ok: boolean; data: unknown[] }> {
    return ipcRenderer.invoke('chat:ai-list-conversations');
  },
  chatAiGetConversation(id: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    return ipcRenderer.invoke('chat:ai-get-conversation', id);
  },
  chatAiCreateConversation(model: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    return ipcRenderer.invoke('chat:ai-create-conversation', model);
  },
  chatAiDeleteConversation(id: string): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke('chat:ai-delete-conversation', id);
  },
  chatAiSend(conversationId: string, message: string, model?: string): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke('chat:ai-send', conversationId, message, model);
  },
  chatAiAbort(): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke('chat:ai-abort');
  },
  chatAiGetProxyStatus(): Promise<{ ok: boolean; data: { running: boolean; port: number } }> {
    return ipcRenderer.invoke('chat:ai-get-proxy-status');
  },
  onChatAiDone(handler: (data: { conversationId: string; message: { role: string; content: string } }) => void): () => void {
    const listener = (_: unknown, data: { conversationId: string; message: { role: string; content: string } }) => handler(data);
    ipcRenderer.on('chat:ai-done', listener);
    return () => ipcRenderer.off('chat:ai-done', listener);
  },
  onChatAiError(handler: (data: { conversationId: string; error: string }) => void): () => void {
    const listener = (_: unknown, data: { conversationId: string; error: string }) => handler(data);
    ipcRenderer.on('chat:ai-error', listener);
    return () => ipcRenderer.off('chat:ai-error', listener);
  },
  onChatAiUserPersisted(handler: (data: { conversationId: string; message: { role: string; content: string } }) => void): () => void {
    const listener = (_: unknown, data: { conversationId: string; message: { role: string; content: string } }) => handler(data);
    ipcRenderer.on('chat:ai-user-persisted', listener);
    return () => ipcRenderer.off('chat:ai-user-persisted', listener);
  },
};

contextBridge.exposeInMainWorld('leechlessDesktop', api);

export type DesktopBridge = typeof api;
