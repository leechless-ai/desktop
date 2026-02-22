const stateEls = {
  seed: document.getElementById('seedState'),
  connect: document.getElementById('connectState'),
  dashboard: document.getElementById('dashboardState'),
};

const daemonStateEl = document.getElementById('daemonState');
const logsEl = document.getElementById('logs');

const inputs = {
  seedProvider: document.getElementById('seedProvider'),
  connectRouter: document.getElementById('connectRouter'),
  dashboardPort: document.getElementById('dashboardPort'),
};

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

function appendLog(entry) {
  const line = document.createElement('div');
  line.className = `log-entry ${entry.stream}`;
  line.innerHTML = `<span class="ts">${formatTime(entry.timestamp)}</span>[${entry.mode}] ${escapeHtml(entry.line)}`;
  logsEl.appendChild(line);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderProcesses(processes) {
  for (const proc of processes) {
    const target = stateEls[proc.mode];
    if (!target) continue;

    if (proc.running) {
      const uptimeMs = proc.startedAt ? Date.now() - proc.startedAt : 0;
      const uptimeSec = Math.floor(uptimeMs / 1000);
      target.textContent = `Running (pid=${proc.pid ?? 'unknown'}, uptime=${uptimeSec}s)`;
      target.style.color = 'var(--good)';
    } else {
      const exitPart = proc.lastExitCode !== null ? `, exit=${proc.lastExitCode}` : '';
      const errPart = proc.lastError ? `, error=${proc.lastError}` : '';
      target.textContent = `Stopped${exitPart}${errPart}`;
      target.style.color = 'var(--muted)';
    }
  }
}

function renderDaemonState(snapshot) {
  if (!snapshot.exists) {
    daemonStateEl.textContent = 'No daemon state file found yet.';
    return;
  }
  if (!snapshot.state) {
    daemonStateEl.textContent = 'Daemon state file exists but could not be parsed.';
    return;
  }
  daemonStateEl.textContent = JSON.stringify(snapshot.state, null, 2);
}

async function refresh() {
  const snapshot = await window.leechlessDesktop.getState();
  logsEl.innerHTML = '';
  for (const entry of snapshot.logs) {
    appendLog(entry);
  }
  renderProcesses(snapshot.processes);
  renderDaemonState(snapshot.daemonState);
}

function hookButton(id, handler) {
  const el = document.getElementById(id);
  el.addEventListener('click', async () => {
    el.disabled = true;
    try {
      await handler();
      await refresh();
    } catch (err) {
      appendLog({
        mode: 'dashboard',
        stream: 'system',
        line: `Action failed: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
    } finally {
      el.disabled = false;
    }
  });
}

hookButton('seedStartBtn', async () => {
  await window.leechlessDesktop.start({
    mode: 'seed',
    provider: inputs.seedProvider.value.trim() || 'anthropic',
  });
});

hookButton('seedStopBtn', async () => {
  await window.leechlessDesktop.stop('seed');
});

hookButton('connectStartBtn', async () => {
  await window.leechlessDesktop.start({
    mode: 'connect',
    router: inputs.connectRouter.value.trim() || 'claude-code',
  });
});

hookButton('connectStopBtn', async () => {
  await window.leechlessDesktop.stop('connect');
});

hookButton('dashboardStartBtn', async () => {
  await window.leechlessDesktop.start({
    mode: 'dashboard',
    dashboardPort: Number(inputs.dashboardPort.value || '3117'),
  });
});

hookButton('dashboardStopBtn', async () => {
  await window.leechlessDesktop.stop('dashboard');
});

hookButton('dashboardOpenBtn', async () => {
  await window.leechlessDesktop.openDashboard(Number(inputs.dashboardPort.value || '3117'));
});

hookButton('refreshBtn', refresh);

hookButton('clearLogsBtn', async () => {
  await window.leechlessDesktop.clearLogs();
});

window.leechlessDesktop.onLog((event) => {
  appendLog(event);
});

window.leechlessDesktop.onState((states) => {
  renderProcesses(states);
});

void refresh();
setInterval(() => {
  void refresh();
}, 5000);
