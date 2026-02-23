export function initNavigationModule({
  uiState,
  navButtons,
  views,
  toolbarViews = new Set(['overview', 'desktop']),
  storageKey = 'leechless-app-mode',
}) {
  function setActiveView(viewName) {
    for (const button of navButtons) {
      const active = button.dataset.view === viewName;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }

    for (const view of views) {
      view.classList.toggle('active', view.id === `view-${viewName}`);
    }

    const toolbar = document.querySelector('.runtime-toolbar');
    const mainContent = document.querySelector('.main-content');
    const showToolbar = toolbarViews.has(viewName);
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

  function setAppMode(mode) {
    uiState.appMode = mode;
    try {
      localStorage.setItem(storageKey, mode);
    } catch {
      // Ignore storage errors in restricted environments.
    }

    const modeButtons = document.querySelectorAll('.mode-btn[data-appmode]');
    for (const btn of modeButtons) {
      btn.classList.toggle('active', btn.dataset.appmode === mode);
    }

    const modeElements = document.querySelectorAll('[data-mode="seeder"], [data-mode="connect"], [data-mode="both"]');
    for (const el of modeElements) {
      const elMode = el.getAttribute('data-mode');
      if (elMode === 'both' || elMode === mode) {
        el.classList.remove('mode-hidden');
      } else {
        el.classList.add('mode-hidden');
      }
    }

    const activeView = getActiveView();
    const activeNavItem = document.querySelector(`.sidebar-nav li[data-mode] .sidebar-btn[data-view="${activeView}"]`);
    if (activeNavItem) {
      const parentLi = activeNavItem.closest('li[data-mode]');
      if (parentLi && parentLi.classList.contains('mode-hidden')) {
        setActiveView('overview');
      }
    }
  }

  function initNavigation() {
    for (const button of navButtons) {
      button.addEventListener('click', () => {
        const targetView = button.dataset.view || 'overview';
        setActiveView(targetView);
      });
    }

    const modeButtons = document.querySelectorAll('.mode-btn[data-appmode]');
    for (const btn of modeButtons) {
      btn.addEventListener('click', () => {
        setAppMode(btn.dataset.appmode);
      });
    }
  }

  function getSavedAppMode() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === 'connect' || saved === 'seeder') {
        return saved;
      }
      return null;
    } catch {
      return null;
    }
  }

  return {
    setActiveView,
    getActiveView,
    setAppMode,
    initNavigation,
    getSavedAppMode,
  };
}
