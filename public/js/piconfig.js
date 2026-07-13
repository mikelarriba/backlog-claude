// ── PI Sprint Configuration ────────────────────────────────────
import {
  fetchJSON,
  putJSON,
  escHtml,
  toggleSection,
  showJiraToast,
  openModal,
  closeModal,
} from './state.js';
import { refreshRoadmapView } from './roadmap.js';
import { showJiraSelectModal, performJiraPull } from './jira-import.js';
function _sprintsFor(piName) {
  const cfg = sprintConfig;
  return cfg[piName] || [];
}
function _setSprintsFor(piName, sprints) {
  sprintConfig[piName] = sprints;
}
export function togglePiConfigSection() {
  toggleSection('pi-config-body', 'pi-config-chevron');
  if (document.getElementById('pi-config-body').classList.contains('open') && !_piConfigActivePi) {
    renderPiConfigTabs();
  }
}
export function renderPiConfigTabs() {
  const tabs = document.getElementById('pi-config-tabs');
  // Build version options from jiraVersions (same data used in swimlane selects)
  const versions = jiraVersions;
  const versionOptions = (versions || [])
    .map(
      (v) =>
        `<option value="${escHtml(v.name)}">${escHtml(v.name)}${v.released ? ' (released)' : ''}</option>`
    )
    .join('');
  const currentSelected = piSettings.currentPi || '';
  const nextSelected = piSettings.nextPi || '';
  tabs.innerHTML = `
    <div class="pi-config-version-row">
      <label class="pi-config-version-label">Current PI</label>
      <select class="pi-config-version-select" onchange="_updatePiFromConfig('currentPi', this.value)">
        <option value="">— Select version —</option>
        ${versionOptions.replace(`value="${escHtml(currentSelected)}"`, `value="${escHtml(currentSelected)}" selected`)}
      </select>
    </div>
    <button class="btn-pi-sync-jira" id="pi-config-sync-btn-currentPi" onclick="syncPiFromJira('currentPi')">
      <span class="pi-config-sync-btn-label">↓ Sync from JIRA</span>
    </button>
    <div class="pi-config-version-row">
      <label class="pi-config-version-label">Next PI</label>
      <select class="pi-config-version-select" onchange="_updatePiFromConfig('nextPi', this.value)">
        <option value="">— Select version —</option>
        ${versionOptions.replace(`value="${escHtml(nextSelected)}"`, `value="${escHtml(nextSelected)}" selected`)}
      </select>
    </div>
    <button class="btn-pi-sync-jira" id="pi-config-sync-btn-nextPi" onclick="syncPiFromJira('nextPi')">
      <span class="pi-config-sync-btn-label">↓ Sync from JIRA</span>
    </button>
    <div class="pi-config-tab-bar">${_renderPiTabButtons()}</div>`;
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  if (pis.length && !_piConfigActivePi) selectPiConfigTab(pis[0]);
}
function _renderPiTabButtons() {
  const pis = [];
  if (piSettings.currentPi)
    pis.push({ key: 'currentPi', label: 'Current PI', name: piSettings.currentPi });
  if (piSettings.nextPi) pis.push({ key: 'nextPi', label: 'Next PI', name: piSettings.nextPi });
  if (!pis.length) return '';
  return pis
    .map(
      (p) => `<button class="pi-config-tab${_piConfigActivePi === p.name ? ' active' : ''}"
             onclick="selectPiConfigTab('${escHtml(p.name)}')">${escHtml(p.label)}<span class="pi-config-tab-name">${escHtml(p.name)}</span></button>`
    )
    .join('');
}
export async function _updatePiFromConfig(sectionKey, versionName) {
  const update = { ...piSettings };
  if (sectionKey === 'currentPi') update.currentPi = versionName || null;
  if (sectionKey === 'nextPi') update.nextPi = versionName || null;
  try {
    await putJSON('/api/settings/pi', update);
    piSettings = update;
    renderPiConfigTabs();
    await loadAllSprintConfigs();
    // If active tab is no longer valid, switch to the first available PI
    const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
    if (pis.length && !pis.includes(_piConfigActivePi)) {
      selectPiConfigTab(pis[0]);
    }
    refreshRoadmapView();
  } catch (e) {
    setPiConfigStatus('error', 'Failed to update PI: ' + e.message);
  }
}
// ── Sync PI from JIRA ────────────────────────────────────────
// Imports JIRA issues for the PI's fix version that don't exist locally yet.
// Distinct from the "Check JIRA" button (jira-pull.ts), which only refreshes
// issues that already have a local file.
export async function syncPiFromJira(sectionKey) {
  const versionName = sectionKey === 'currentPi' ? piSettings.currentPi : piSettings.nextPi;
  if (!versionName) {
    showJiraToast('error', 'Select a fix version for this PI before syncing from JIRA.');
    return;
  }
  const btn = document.getElementById(`pi-config-sync-btn-${sectionKey}`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<span class="spinner"></span><span class="pi-config-sync-btn-label">Syncing…</span>';
  }
  try {
    const data = await fetchJSON(`/api/jira/by-fix-version/${encodeURIComponent(versionName)}`);
    const issues = data.issues || [];
    if (!issues.length) {
      showJiraToast('success', `No JIRA issues found for fix version "${versionName}".`);
      return;
    }
    const items = issues.map((issue) => ({
      key: issue.key,
      summary: issue.summary,
      type: issue.issuetype,
      localExists: issue.localExists,
    }));
    const selected = await showJiraSelectModal(
      `${issues.length} JIRA issue(s) for fix version "${versionName}"`,
      items,
      'Import selected',
      '✓ Already imported'
    );
    if (!selected.length) return;
    const newKeys = selected.filter((s) => !s.localExists).map((s) => s.key);
    const overwriteKeys = selected.filter((s) => s.localExists).map((s) => s.key);
    await performJiraPull([...newKeys, ...overwriteKeys], overwriteKeys, []);
    showJiraToast('success', `Synced ${selected.length} issue(s) from JIRA for "${versionName}".`);
  } catch (e) {
    showJiraToast('error', e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}
export async function selectPiConfigTab(piName) {
  _piConfigActivePi = piName;
  // Update active tab style
  document.querySelectorAll('.pi-config-tab').forEach((t) => {
    t.classList.toggle('active', (t.textContent || '').includes(piName));
  });
  await loadSprintConfigForPi(piName);
}
export async function loadSprintConfigForPi(piName) {
  try {
    const data = await fetchJSON(`/api/settings/pi/sprints/${encodeURIComponent(piName)}`);
    const sprints = data.sprints || [];
    _setSprintsFor(piName, sprints);
    renderSprintRows(sprints);
    if (sprints.length) {
      hideJiraImportBanner();
      return;
    }
    // No sprints configured for this PI — offer to auto-suggest them from the
    // JIRA board (#352). This checks board-sprints eagerly (rather than only
    // on an "Import" click) so the boardNotConfigured fallback can go straight
    // to the static hint without a banner-then-skip round trip.
    await offerJiraSprintImport(piName);
  } catch {
    renderSprintRows([]);
    hideJiraImportBanner();
  }
}
// ── Sprint auto-suggestion from JIRA board (#352) ─────────────
// Sprints found on the JIRA board, offered for import into the currently
// empty grid. Cached from the eager board-sprints check so the "Import"
// button click doesn't need to re-fetch.
let _jiraImportCandidates = [];
const JIRA_IMPORT_DEFAULT_CAPACITY = 70;
function _jiraImportBannerEl() {
  return document.getElementById('pi-config-jira-banner');
}
async function offerJiraSprintImport(piName) {
  let boardData;
  try {
    boardData = await fetchJSON('/api/jira/board-sprints');
  } catch {
    boardData = null;
  }
  // The user may have switched PI tabs while this fetch was in flight.
  if (_piConfigActivePi !== piName) return;
  const candidates = boardData?.sprints || [];
  if (!boardData || boardData.boardNotConfigured || !candidates.length) {
    _jiraImportCandidates = [];
    renderJiraImportHint();
    return;
  }
  _jiraImportCandidates = candidates;
  renderJiraImportOffer();
}
function renderJiraImportOffer() {
  const el = _jiraImportBannerEl();
  if (!el) return;
  el.innerHTML = `
    <div class="pi-config-jira-banner-inner info">
      <span class="pi-config-jira-banner-text">No sprints configured for this PI. Import sprint names from JIRA?</span>
      <div class="pi-config-jira-banner-actions">
        <button class="pi-config-jira-banner-btn primary" onclick="confirmJiraSprintImport()">Import</button>
        <button class="pi-config-jira-banner-btn" onclick="skipJiraSprintImport()">Skip</button>
      </div>
    </div>`;
  openModal('pi-config-jira-banner');
}
function renderJiraImportConfirmation(count) {
  const el = _jiraImportBannerEl();
  if (!el) return;
  el.innerHTML = `
    <div class="pi-config-jira-banner-inner success">
      <span class="pi-config-jira-banner-text">Found ${count} sprint${count !== 1 ? 's' : ''} — they will be added with default capacity (${JIRA_IMPORT_DEFAULT_CAPACITY} SP).</span>
      <button class="pi-config-jira-banner-dismiss" onclick="dismissJiraImportBanner()" title="Dismiss" aria-label="Dismiss">&times;</button>
    </div>`;
  openModal('pi-config-jira-banner');
}
function renderJiraImportHint() {
  const el = _jiraImportBannerEl();
  if (!el) return;
  el.innerHTML = `
    <div class="pi-config-jira-banner-inner hint">
      <span class="pi-config-jira-banner-text">Add sprints manually using the grid below.</span>
    </div>`;
  openModal('pi-config-jira-banner');
}
function hideJiraImportBanner() {
  const el = _jiraImportBannerEl();
  if (!el) return;
  el.innerHTML = '';
  closeModal('pi-config-jira-banner');
}
export function confirmJiraSprintImport() {
  if (!_piConfigActivePi || !_jiraImportCandidates.length) return;
  const count = _jiraImportCandidates.length;
  for (const s of _jiraImportCandidates) {
    addSprintRow(s.name, JIRA_IMPORT_DEFAULT_CAPACITY);
  }
  _jiraImportCandidates = [];
  renderJiraImportConfirmation(count);
}
export function skipJiraSprintImport() {
  _jiraImportCandidates = [];
  renderJiraImportHint();
}
export function dismissJiraImportBanner() {
  _jiraImportCandidates = [];
  hideJiraImportBanner();
}
export function renderSprintRows(sprints) {
  const container = document.getElementById('pi-config-sprints');
  if (!sprints.length) {
    container.innerHTML =
      '<div class="pi-config-empty">No sprints defined. Click "+ Add Sprint".</div>';
    return;
  }
  container.innerHTML = sprints
    .map(
      (s, i) => `
    <div class="pi-config-sprint-row" data-idx="${i}">
      <input class="pi-config-sprint-name" type="text" value="${escHtml(s.name)}" placeholder="Sprint name" />
      <div class="pi-config-capacity-wrap">
        <input class="pi-config-sprint-cap" type="number" min="0" max="999" value="${s.capacity}" placeholder="SP" />
        <span class="pi-config-cap-label">SP</span>
      </div>
      <button class="pi-config-remove-btn" onclick="removeSprintRow(${i})" title="Remove sprint">&times;</button>
    </div>
  `
    )
    .join('');
}
// name/capacity let callers pre-fill a row (e.g. JIRA sprint import, #352)
// instead of always appending a blank "Sprint N" row.
export function addSprintRow(name, capacity) {
  if (!_piConfigActivePi) return;
  const sprints = _sprintsFor(_piConfigActivePi);
  const nextNum = sprints.length + 1;
  sprints.push({ name: name || `Sprint ${nextNum}`, capacity: capacity ?? 40 });
  _setSprintsFor(_piConfigActivePi, sprints);
  renderSprintRows(sprints);
}
export function removeSprintRow(index) {
  if (!_piConfigActivePi) return;
  const sprints = _sprintsFor(_piConfigActivePi);
  if (sprints.length <= 1) return; // keep at least one
  sprints.splice(index, 1);
  _setSprintsFor(_piConfigActivePi, sprints);
  renderSprintRows(sprints);
}
export function collectSprintRows() {
  const rows = document.querySelectorAll('.pi-config-sprint-row');
  return Array.from(rows)
    .map((row) => ({
      name: row.querySelector('.pi-config-sprint-name').value.trim(),
      capacity: Number(row.querySelector('.pi-config-sprint-cap').value) || 0,
    }))
    .filter((s) => s.name);
}
export async function saveSprintConfig() {
  if (!_piConfigActivePi) return;
  const sprints = collectSprintRows();
  if (!sprints.length) {
    setPiConfigStatus('error', 'At least one sprint with a name is required.');
    return;
  }
  const btn = document.getElementById('pi-config-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const data = await putJSON(
      `/api/settings/pi/sprints/${encodeURIComponent(_piConfigActivePi)}`,
      {
        sprints,
      }
    );
    _setSprintsFor(_piConfigActivePi, data.sprints || []);
    renderSprintRows(data.sprints || []);
    setPiConfigStatus('success', 'Sprint configuration saved.');
  } catch (e) {
    setPiConfigStatus('error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Configuration';
  }
}
export function setPiConfigStatus(type, message) {
  const el = document.getElementById('pi-config-status');
  el.className = `pi-config-status${type !== 'hidden' ? ' show ' + type : ''}`;
  el.textContent = message || '';
  if (type === 'success')
    setTimeout(() => {
      el.className = 'pi-config-status';
    }, 3000);
}
// Load sprint config for both PIs (called during init) — parallel fetches
export async function loadAllSprintConfigs() {
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  const [, thresholdRes] = await Promise.all([
    // Fetch all PI sprint configs in parallel
    Promise.all(
      pis.map(async (piName) => {
        try {
          const data = await fetchJSON(`/api/settings/pi/sprints/${encodeURIComponent(piName)}`);
          if (data.sprints && data.sprints.length) {
            _setSprintsFor(piName, data.sprints);
          }
        } catch (e) {
          console.warn(`Failed to load sprint config for ${piName}:`, e.message);
        }
      })
    ),
    // Fetch split threshold in parallel with sprint configs
    fetchJSON('/api/settings/pi/split-threshold').catch(() => null),
  ]);
  if (thresholdRes) {
    splitThreshold = thresholdRes.splitThreshold ?? 8;
    const el = document.getElementById('split-threshold-input');
    if (el) el.value = String(splitThreshold);
  }
}
export async function saveSplitThreshold(value) {
  const val = parseInt(value, 10);
  if (!val || val < 1) return;
  try {
    await putJSON('/api/settings/pi/split-threshold', { splitThreshold: val });
    splitThreshold = val;
    refreshRoadmapView();
    setPiConfigStatus('success', `Split threshold set to ${val} SP`);
  } catch (e) {
    console.warn('Failed to save split threshold:', e.message);
  }
}
// Get sprint names for a given PI version name
export function getSprintsForPi(piVersionName) {
  return _sprintsFor(piVersionName);
}
//# sourceMappingURL=piconfig.js.map
