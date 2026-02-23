import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
const CLI_NODE_BIN_ENV = 'LEECHLESS_NODE_BIN';
const LOCAL_CLI_BIN_RELATIVE = ['..', 'cli', 'dist', 'cli', 'index.js'] as const;
const RUNTIME_NATIVE_SCRIPT_RELATIVE = ['scripts', 'ensure-runtime-native-modules.mjs'] as const;
const DESKTOP_DATA_ROOT = join(homedir(), '.leechless-desktop');
const DESKTOP_SEED_DATA_DIR = join(DESKTOP_DATA_ROOT, 'seed');
const DESKTOP_CONNECT_DATA_DIR = join(DESKTOP_DATA_ROOT, 'connect');

function resolveCliCommand(): string {
  const envCommand = process.env[CLI_COMMAND_ENV]?.trim();
  if (envCommand && envCommand.length > 0) {
    return envCommand;
  }

  const localCli = resolve(process.cwd(), ...LOCAL_CLI_BIN_RELATIVE);
  if (existsSync(localCli)) {
    return localCli;
  }

  return DEFAULT_CLI_COMMAND;
}

function detectNodeArch(nodeBinary: string): string | null {
  try {
    const output = execFileSync(nodeBinary, ['-p', 'process.arch'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

type SemverTuple = [major: number, minor: number, patch: number];

function parseSemverTag(raw: string): SemverTuple | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemverDesc(a: SemverTuple, b: SemverTuple): number {
  if (a[0] !== b[0]) return b[0] - a[0];
  if (a[1] !== b[1]) return b[1] - a[1];
  return b[2] - a[2];
}

function resolveNodeBinary(targetArch: string): string {
  const envNode = process.env[CLI_NODE_BIN_ENV]?.trim();
  const candidates: string[] = [];
  if (envNode) {
    candidates.push(envNode);
  }

  const nvmBin = process.env['NVM_BIN']?.trim();
  if (nvmBin) {
    candidates.push(join(nvmBin, 'node'));
  }

  const nvmVersionsDir = join(homedir(), '.nvm', 'versions', 'node');
  if (existsSync(nvmVersionsDir)) {
    try {
      const nvmVersions = readdirSync(nvmVersionsDir)
        .map((name) => ({ name, semver: parseSemverTag(name) }))
        .sort((left, right) => {
          if (left.semver && right.semver) {
            return compareSemverDesc(left.semver, right.semver);
          }
          if (left.semver) return -1;
          if (right.semver) return 1;
          return right.name.localeCompare(left.name);
        })
        .map((entry) => entry.name);
      for (const version of nvmVersions) {
        candidates.push(join(nvmVersionsDir, version, 'bin', 'node'));
      }
    } catch {
      // Ignore nvm lookup failures and continue with other candidates.
    }
  }

  candidates.push('/opt/homebrew/bin/node');
  candidates.push('/usr/local/bin/node');
  candidates.push('node');

  const tried = new Set<string>();
  let firstExisting: string | null = null;

  for (const candidate of candidates) {
    if (!candidate || tried.has(candidate)) {
      continue;
    }
    tried.add(candidate);
    if (candidate !== 'node' && !existsSync(candidate)) {
      continue;
    }
    if (!firstExisting) {
      firstExisting = candidate;
    }
    const arch = detectNodeArch(candidate);
    if (arch === targetArch) {
      return candidate;
    }
  }

  return firstExisting ?? 'node';
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
      args.push('--data-dir', DESKTOP_SEED_DATA_DIR);
      args.push('seed', '--provider', opts.provider ?? 'anthropic');
      break;
    case 'connect':
      args.push('--data-dir', DESKTOP_CONNECT_DATA_DIR);
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
    const localCliPath = resolve(process.cwd(), ...LOCAL_CLI_BIN_RELATIVE);
    const useLocalCliScript = existsSync(localCliPath) && resolve(cliCommand) === localCliPath;
    const executable = useLocalCliScript ? resolveNodeBinary(process.arch) : cliCommand;
    const executableArgs = useLocalCliScript ? [localCliPath, ...args] : args;
    this.ensureRuntimeNativeModules(mode, executable, useLocalCliScript);
    const childEnv = { ...process.env };
    delete childEnv['ELECTRON_RUN_AS_NODE'];

    const child = spawn(executable, executableArgs, {
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
      `Started ${mode} with "${executable}" (pid=${String(child.pid ?? 'unknown')})`,
    );
    return { ...state };
  }

  private ensureRuntimeNativeModules(mode: RuntimeMode, executable: string, useLocalCliScript: boolean): void {
    if (!useLocalCliScript) {
      return;
    }

    const scriptPath = resolve(process.cwd(), ...RUNTIME_NATIVE_SCRIPT_RELATIVE);
    if (!existsSync(scriptPath)) {
      this.onLog(mode, 'system', 'Native module preflight script not found; skipping runtime alignment.');
      return;
    }

    try {
      const output = execFileSync(executable, [scriptPath], {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      for (const line of output.split(/\r?\n/)) {
        if (line.trim().length > 0) {
          this.onLog(mode, 'system', line);
        }
      }
    } catch (err) {
      const execErr = err as NodeJS.ErrnoException & { stderr?: string | Buffer };
      const detail = typeof execErr.stderr === 'string'
        ? execErr.stderr.trim()
        : Buffer.isBuffer(execErr.stderr)
          ? execErr.stderr.toString('utf8').trim()
          : execErr.message;
      throw new Error(`Native module alignment failed: ${detail || execErr.message}`);
    }
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
