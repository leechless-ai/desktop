export function initRuntimeModule({
  elements,
  uiState,
  formatClock,
  formatDuration,
  setText,
}) {
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

  function appendSystemLog(message) {
    appendLog({
      mode: 'dashboard',
      stream: 'system',
      line: message,
      timestamp: Date.now(),
    });
  }

  return {
    appendLog,
    renderLogs,
    processByMode,
    isModeRunning,
    renderProcesses,
    renderDaemonState,
    appendSystemLog,
  };
}
