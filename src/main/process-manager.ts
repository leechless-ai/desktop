import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type RuntimeMode = 'seed' | 'connect' | 'dashboard';

export interface RuntimeProcessState {
  mode: RuntimeMode;
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  lastExitCode: number | null;
  lastError: string | null;
}

export interface StartOptions {
  mode: RuntimeMode;
  provider?: string;
  router?: string;
  dashboardPort?: number;
  configPath?: string;
  verbose?: boolean;
}

export interface DaemonStateSnapshot {
  exists: boolean;
  state: Record<string, unknown> | null;
}

const DEFAULT_DASHBOARD_PORT = 3117;
const DEFAULT_CLI_COMMAND = 'leechless';
const CLI_COMMAND_ENV = 'LEECHLESS_CLI_BIN';

function resolveCliCommand(): string {
  const envCommand = process.env[CLI_COMMAND_ENV]?.trim();
  if (envCommand && envCommand.length > 0) {
    return envCommand;
  }
  return DEFAULT_CLI_COMMAND;
}

function resolveConfigPath(configPath?: string): string {
  if (!configPath || configPath.trim().length === 0) {
    return join(homedir(), '.leechless', 'config.json');
  }
  if (configPath.startsWith('~/')) {
    return join(homedir(), configPath.slice(2));
  }
  return resolve(configPath);
}

function resolveCommandArgs(opts: StartOptions): string[] {
  const args: string[] = [];

  if (opts.verbose) {
    args.push('--verbose');
  }

  const configPath = resolveConfigPath(opts.configPath);
  args.push('--config', configPath);

  switch (opts.mode) {
    case 'seed':
      args.push('seed', '--provider', opts.provider ?? 'anthropic');
      break;
    case 'connect':
      args.push('connect', '--router', opts.router ?? 'claude-code');
      break;
    case 'dashboard':
      args.push('dashboard', '--port', String(opts.dashboardPort ?? DEFAULT_DASHBOARD_PORT), '--no-open');
      break;
    default:
      throw new Error(`Unsupported runtime mode: ${String(opts.mode)}`);
  }

  return args;
}

export class ProcessManager {
  private readonly processes = new Map<RuntimeMode, ChildProcessWithoutNullStreams>();
  private readonly states = new Map<RuntimeMode, RuntimeProcessState>([
    ['seed', { mode: 'seed', running: false, pid: null, startedAt: null, lastExitCode: null, lastError: null }],
    ['connect', { mode: 'connect', running: false, pid: null, startedAt: null, lastExitCode: null, lastError: null }],
    ['dashboard', { mode: 'dashboard', running: false, pid: null, startedAt: null, lastExitCode: null, lastError: null }],
  ]);

  constructor(
    private readonly onLog: (mode: RuntimeMode, stream: 'stdout' | 'stderr' | 'system', line: string) => void,
  ) {}

  getState(): RuntimeProcessState[] {
    return [...this.states.values()].map((s) => ({ ...s }));
  }

  getDaemonStateSnapshot(): DaemonStateSnapshot {
    const stateFile = join(homedir(), '.leechless', 'daemon.state.json');
    if (!existsSync(stateFile)) {
      return { exists: false, state: null };
    }
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
      return { exists: true, state: parsed };
    } catch {
      return { exists: true, state: null };
    }
  }

  async start(opts: StartOptions): Promise<RuntimeProcessState> {
    const mode = opts.mode;
    if (this.processes.has(mode)) {
      throw new Error(`${mode} is already running`);
    }

    const cliCommand = resolveCliCommand();
    const args = resolveCommandArgs(opts);
    const childEnv = { ...process.env };
    delete childEnv['ELECTRON_RUN_AS_NODE'];

    const child = spawn(cliCommand, args, {
      cwd: process.cwd(),
      env: childEnv,
      stdio: 'pipe',
    });

    this.processes.set(mode, child);

    const state = this.states.get(mode)!;
    state.running = true;
    state.pid = child.pid ?? null;
    state.startedAt = Date.now();
    state.lastError = null;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim().length > 0) {
          this.onLog(mode, 'stdout', line);
        }
      }
    });

    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim().length > 0) {
          this.onLog(mode, 'stderr', line);
        }
      }
    });

    child.on('error', (err) => {
      state.lastError = err.message;
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        state.running = false;
        state.pid = null;
        this.processes.delete(mode);
        this.onLog(
          mode,
          'system',
          `CLI command "${cliCommand}" was not found. Install leechless on PATH or set ${CLI_COMMAND_ENV} to a valid executable path.`,
        );
        return;
      }
      this.onLog(mode, 'system', `Process error: ${err.message}`);
    });

    child.on('exit', (code, signal) => {
      this.processes.delete(mode);
      state.running = false;
      state.pid = null;
      state.lastExitCode = code;
      const reason = signal ? `signal=${signal}` : `code=${String(code)}`;
      this.onLog(mode, 'system', `Process exited (${reason})`);
    });

    this.onLog(
      mode,
      'system',
      `Started ${mode} with "${cliCommand}" (pid=${String(child.pid ?? 'unknown')})`,
    );
    return { ...state };
  }

  async stop(mode: RuntimeMode): Promise<RuntimeProcessState> {
    const child = this.processes.get(mode);
    const state = this.states.get(mode)!;

    if (!child) {
      state.running = false;
      state.pid = null;
      return { ...state };
    }

    await new Promise<void>((resolveStop) => {
      const timeout = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5_000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolveStop();
      });

      child.kill('SIGTERM');
    });

    return { ...state };
  }

  async stopAll(): Promise<void> {
    await this.stop('dashboard');
    await this.stop('connect');
    await this.stop('seed');
  }
}
