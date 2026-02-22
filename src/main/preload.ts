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
};

contextBridge.exposeInMainWorld('leechlessDesktop', api);

export type DesktopBridge = typeof api;
