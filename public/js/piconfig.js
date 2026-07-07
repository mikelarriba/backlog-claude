// ── PI Sprint Configuration ────────────────────────────────────
import { fetchJSON, putJSON, escHtml, toggleSection, showJiraToast } from './state.js';
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
    const sprints =
      data.sprints && data.sprints.length
        ? data.sprints
        : [
            { name: 'Sprint 1', capacity: 40 },
            { name: 'Sprint 2', capacity: 40 },
            { name: 'Sprint 3', capacity: 40 },
            { name: 'Sprint 4', capacity: 40 },
          ];
    _setSprintsFor(piName, sprints);
    renderSprintRows(sprints);
  } catch {
    renderSprintRows([]);
  }
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
export function addSprintRow() {
  if (!_piConfigActivePi) return;
  const sprints = _sprintsFor(_piConfigActivePi);
  const nextNum = sprints.length + 1;
  sprints.push({ name: `Sprint ${nextNum}`, capacity: 40 });
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
