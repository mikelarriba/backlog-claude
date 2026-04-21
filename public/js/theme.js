// ── Theme management ───────────────────────────────────────────
// Supports: 'dark' | 'light' | 'system'
// Persisted in localStorage as 'vw-theme'.

(function () {
  const STORAGE_KEY = 'vw-theme';
  const html        = document.documentElement;

  function getSystemPreference() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme(preference) {
    const resolved = preference === 'system' ? getSystemPreference() : preference;
    html.setAttribute('data-theme', resolved);
  }

  function updateButtons(preference) {
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === preference);
    });
  }

  window.setTheme = function (preference) {
    localStorage.setItem(STORAGE_KEY, preference);
    applyTheme(preference);
    updateButtons(preference);
  };

  // Listen for OS-level changes (affects 'system' mode)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    const stored = localStorage.getItem(STORAGE_KEY) || 'system';
    if (stored === 'system') applyTheme('system');
  });

  // Init: apply before first paint to avoid flash
  const stored = localStorage.getItem(STORAGE_KEY) || 'system';
  applyTheme(stored);

  // Once DOM is ready, sync button states
  document.addEventListener('DOMContentLoaded', () => updateButtons(stored));
})();
