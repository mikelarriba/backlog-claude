// ── Initialisation ─────────────────────────────────────────────
// Runs after all other scripts have loaded.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Split-panel mode ───────────────────────────────────────────
const SPLIT_MIN_WIDTH = 1280; // px — below this, use classic single-view nav

function isSplitMode() {
  return document.querySelector('.right').classList.contains('split-mode');
}

function updateSplitMode() {
  const wide  = window.innerWidth >= SPLIT_MIN_WIDTH;
  const right = document.querySelector('.right');
  const wasOn = right.classList.contains('split-mode');

  if (wide === wasOn) return; // no change

  right.classList.toggle('split-mode', wide);

  if (!wide && currentFilename) {
    // Switching to narrow with a doc open — hide the list so detail view
    // keeps behaving like the classic full-screen detail.
    document.getElementById('list-view').style.display = 'none';
  } else if (wide && currentFilename) {
    // Switching to wide with a doc open — show the list alongside.
    document.getElementById('list-view').style.display = '';
    // Re-highlight the active list item.
    highlightSelectedItem(currentFilename, currentDocType);
  }
}

function highlightSelectedItem(filename, docType) {
  document.querySelectorAll('.epic-item, .roadmap-card').forEach(el => el.classList.remove('selected'));
  if (filename) {
    document.querySelector(`.epic-item[data-filename="${CSS.escape(filename)}"][data-doctype="${docType}"]`)
      ?.classList.add('selected');
    document.querySelector(`.roadmap-card[data-filename="${CSS.escape(filename)}"][data-doctype="${docType}"]`)
      ?.classList.add('selected');
  }
}

let _lastInnerWidth = window.innerWidth;
window.addEventListener('resize', debounce(() => {
  // Skip if physical width hasn't changed (macOS virtual desktop switch fires
  // resize events without changing innerWidth; zoom changes do alter it).
  if (window.innerWidth === _lastInnerWidth) return;
  _lastInnerWidth = window.innerWidth;
  updateSplitMode();
}, 150));

// ── Left panel collapse toggle ────────────────────────────────
function toggleLeftPanel() {
  const app = document.getElementById('app-root');
  const btn = document.getElementById('left-toggle-btn');
  const collapsed = app.classList.toggle('left-collapsed');
  btn.textContent = collapsed ? '»' : '«';
  try { localStorage.setItem('leftPanelCollapsed', collapsed ? '1' : '0'); } catch {}
}

(function _restoreLeftPanel() {
  try {
    if (localStorage.getItem('leftPanelCollapsed') === '1') {
      const app = document.getElementById('app-root');
      const btn = document.getElementById('left-toggle-btn');
      if (app) { app.classList.add('left-collapsed'); if (btn) btn.textContent = '»'; }
    }
  } catch {}
})();

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); toggleLeftPanel(); }
});

// ── Model / Provider settings ─────────────────────────────────
function toggleModelSection() {
  toggleSection('model-section-body', 'model-chevron');
}

async function loadAppConfig() {
  try {
    const cfg = await fetchJSON('/api/config');
    if (cfg.jiraBase) jiraBase = cfg.jiraBase;
  } catch (e) { console.warn('Failed to load app config:', e.message); }
}

async function loadMetadata() {
  try {
    const { teams, workCategories } = await fetchJSON('/api/config/metadata');
    _populateTeamSelects(teams);
    _populateWorkCatSelects(workCategories);
    _renderTeamFilterPills(teams);
    _renderWorkCatFilterPills(workCategories);
  } catch (e) { console.warn('Failed to load metadata config:', e.message); }
}

function _populateTeamSelects(teams) {
  const selectIds = ['team', 'bug-team', 'detail-team-select'];
  for (const id of selectIds) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const firstOpt = sel.querySelector('option:first-child');
    sel.innerHTML = '';
    if (firstOpt) sel.appendChild(firstOpt.cloneNode(true));
    for (const t of teams) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    }
  }
}

function _populateWorkCatSelects(cats) {
  const selectIds = ['work-category', 'bug-work-category', 'detail-workcat-select'];
  for (const id of selectIds) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const firstOpt = sel.querySelector('option:first-child');
    sel.innerHTML = '';
    if (firstOpt) sel.appendChild(firstOpt.cloneNode(true));
    for (const c of cats) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
  }
}

const WORKCAT_SHORT_LABELS = {
  'Platform Maintenance': 'Maint.',
  'Technical Debt':       'Tech Debt',
};

function _renderTeamFilterPills(teams) {
  const container = document.querySelector('.filter-group [data-team="all"]')?.parentElement;
  if (!container) return;
  // Remove old team pills (keep the "All" pill)
  container.querySelectorAll('[data-team]:not([data-team="all"])').forEach(el => el.remove());
  for (const t of teams) {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.dataset.team = t;
    btn.textContent = t;
    btn.setAttribute('onclick', `setTeamFilter('${t}')`);
    container.appendChild(btn);
  }
}

function _renderWorkCatFilterPills(cats) {
  const container = document.querySelector('.filter-group-workcat [data-workcat="all"]')?.parentElement;
  if (!container) return;
  container.querySelectorAll('[data-workcat]:not([data-workcat="all"])').forEach(el => el.remove());
  for (const c of cats) {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.dataset.workcat = c;
    btn.textContent = WORKCAT_SHORT_LABELS[c] || c;
    btn.setAttribute('onclick', `setWorkCatFilter('${c}')`);
    container.appendChild(btn);
  }
}

let _availableProviders = [];

async function loadModelSetting() {
  try {
    const [{ providers }, { model, provider }] = await Promise.all([
      fetchJSON('/api/settings/providers'),
      fetchJSON('/api/settings/model'),
    ]);
    _availableProviders = providers || [];
    _renderProviderDropdown(provider || 'claude-cli');
    _renderModelDropdown(provider || 'claude-cli', model || '');
  } catch (e) { console.warn('Failed to load model setting:', e.message); }
}

function _renderProviderDropdown(selectedProvider) {
  const sel = document.getElementById('provider-select');
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of _availableProviders) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === selectedProvider) opt.selected = true;
    sel.appendChild(opt);
  }
}

function _renderModelDropdown(providerId, selectedModel) {
  const sel = document.getElementById('model-select');
  if (!sel) return;
  const provider = _availableProviders.find(p => p.id === providerId);
  sel.innerHTML = '';
  if (!provider) return;
  for (const m of provider.models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === selectedModel) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function onProviderChange(providerId) {
  _renderModelDropdown(providerId, '');
  await _saveModelSetting(providerId, '');
}

async function updateModelSetting(model) {
  const providerSel = document.getElementById('provider-select');
  const providerId = providerSel ? providerSel.value : 'claude-cli';
  await _saveModelSetting(providerId, model);
}

async function _saveModelSetting(provider, model) {
  const statusEl = document.getElementById('model-status');
  try {
    await putJSON('/api/settings/model', { provider: provider || null, model: model || null });
    statusEl.className = 'model-status show success';
    const pName = (_availableProviders.find(p => p.id === provider) || {}).name || provider;
    statusEl.textContent = model ? `Using ${pName} / ${model}` : `Using ${pName} default`;
    setTimeout(() => { statusEl.className = 'model-status'; }, 3000);
  } catch (e) {
    statusEl.className = 'model-status show error';
    statusEl.textContent = 'Failed to save';
  }
}

// Bootstrap — load PI settings, JIRA versions, sprint config, model & app config before docs so swimlanes render correctly
(async () => {
  await Promise.all([loadPiSettings(), loadJiraVersions(), loadModelSetting(), loadAppConfig(), loadMetadata()]);
  await loadAllSprintConfigs();
  loadDocs();
})();
initDragDrop();
updateSplitMode();

// SSE: auto-refresh on doc changes — debounced to collapse burst events
const _loadDocsDebounced = debounce(loadDocs, 100);

const evtSource = new EventSource('/api/events');
evtSource.onmessage = (e) => {
  try {
    const payload = JSON.parse(e.data);
    if (['feature_created','epic_created','story_created','spike_created','bug_created','status_updated','title_updated','doc_deleted','batch_deleted','batch_fix_version_updated','link_updated'].includes(payload.type)) {
      _loadDocsDebounced();
    }
    if (payload.type === 'pi_settings_updated') {
      piSettings = { currentPi: payload.currentPi, nextPi: payload.nextPi };
      loadAllSprintConfigs().then(() => { _loadDocsDebounced(); refreshRoadmapView(); });
    }
    if (payload.type === 'sprint_settings_updated') {
      loadAllSprintConfigs().then(() => { _loadDocsDebounced(); refreshRoadmapView(); });
    }
    if (payload.type === 'batch_sprint_updated') {
      _loadDocsDebounced();
      refreshRoadmapView();
    }
    if (payload.type === 'split_threshold_updated') {
      splitThreshold = payload.splitThreshold;
      const el = document.getElementById('split-threshold-input');
      if (el) el.value = splitThreshold;
      refreshRoadmapView();
    }
  } catch (e) { console.warn('SSE handler error:', e.message); }
};

// Close delete dialog on overlay click
document.getElementById('delete-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDeleteDialog();
});

// Close split modal on overlay click
document.getElementById('split-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSplitModal();
});
