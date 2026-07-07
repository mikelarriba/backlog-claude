// ── PI Sprint Configuration ────────────────────────────────────
import { fetchJSON, putJSON, escHtml, toggleSection, showJiraToast } from './state.js';
import { refreshRoadmapView } from './roadmap.js';
import { showJiraSelectModal, performJiraPull } from './jira-import.js';
import type { PISettings } from './state.js';

// _piConfigActivePi is a store-backed global in state.js (referenced from HTML onclick)

// ── Local types ──────────────────────────────────────────────
// jiraVersions is declared as `string[]` in global.d.ts (legacy ambient typing),
// but at runtime it is actually populated with version objects from the API
// (see list.js loadJiraVersions(): jiraVersions = data.versions). Use a local
// shape here to type its real usage without touching global.d.ts.
interface JiraVersion {
  name: string;
  released?: boolean;
}

// sprintConfig is declared as `SprintConfig = Record<string, unknown>` in
// state.ts/global.d.ts (legacy ambient typing), but at runtime each value is
// actually an array of Sprint objects keyed by PI name. Use a local shape
// here to type its real usage without touching global.d.ts.
interface Sprint {
  name: string;
  capacity: number;
}

interface SprintsResponse {
  sprints?: Sprint[];
}

interface SplitThresholdResponse {
  splitThreshold?: number;
}

// Response shape of GET /api/jira/by-fix-version/:version (see #349)
interface JiraByFixVersionIssue {
  key: string;
  summary: string;
  issuetype: string;
  status: string;
  priority: string;
  localExists: boolean;
  localFilename: string | null;
}

interface JiraByFixVersionResponse {
  fixVersion: string;
  total: number;
  issues: JiraByFixVersionIssue[];
}

type PiSectionKey = 'currentPi' | 'nextPi';

function _sprintsFor(piName: string): Sprint[] {
  const cfg = sprintConfig as unknown as Record<string, Sprint[]>;
  return cfg[piName] || [];
}

function _setSprintsFor(piName: string, sprints: Sprint[]): void {
  (sprintConfig as unknown as Record<string, Sprint[]>)[piName] = sprints;
}

export function togglePiConfigSection(): void {
  toggleSection('pi-config-body', 'pi-config-chevron');
  if (document.getElementById('pi-config-body')!.classList.contains('open') && !_piConfigActivePi) {
    renderPiConfigTabs();
  }
}

export function renderPiConfigTabs(): void {
  const tabs = document.getElementById('pi-config-tabs') as HTMLElement;

  // Build version options from jiraVersions (same data used in swimlane selects)
  const versions = jiraVersions as unknown as JiraVersion[];
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
        ${versionOptions.replace(
          `value="${escHtml(currentSelected)}"`,
          `value="${escHtml(currentSelected)}" selected`
        )}
      </select>
    </div>
    <button class="btn-pi-sync-jira" id="pi-config-sync-btn-currentPi" onclick="syncPiFromJira('currentPi')">
      <span class="pi-config-sync-btn-label">↓ Sync from JIRA</span>
    </button>
    <div class="pi-config-version-row">
      <label class="pi-config-version-label">Next PI</label>
      <select class="pi-config-version-select" onchange="_updatePiFromConfig('nextPi', this.value)">
        <option value="">— Select version —</option>
        ${versionOptions.replace(
          `value="${escHtml(nextSelected)}"`,
          `value="${escHtml(nextSelected)}" selected`
        )}
      </select>
    </div>
    <button class="btn-pi-sync-jira" id="pi-config-sync-btn-nextPi" onclick="syncPiFromJira('nextPi')">
      <span class="pi-config-sync-btn-label">↓ Sync from JIRA</span>
    </button>
    <div class="pi-config-tab-bar">${_renderPiTabButtons()}</div>`;

  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];
  if (pis.length && !_piConfigActivePi) selectPiConfigTab(pis[0]);
}

function _renderPiTabButtons(): string {
  const pis: Array<{ key: string; label: string; name: string }> = [];
  if (piSettings.currentPi)
    pis.push({ key: 'currentPi', label: 'Current PI', name: piSettings.currentPi });
  if (piSettings.nextPi) pis.push({ key: 'nextPi', label: 'Next PI', name: piSettings.nextPi });
  if (!pis.length) return '';
  return pis
    .map(
      (p) =>
        `<button class="pi-config-tab${_piConfigActivePi === p.name ? ' active' : ''}"
             onclick="selectPiConfigTab('${escHtml(p.name)}')">${escHtml(p.label)}<span class="pi-config-tab-name">${escHtml(p.name)}</span></button>`
    )
    .join('');
}

export async function _updatePiFromConfig(sectionKey: string, versionName: string): Promise<void> {
  const update: PISettings = { ...piSettings };
  if (sectionKey === 'currentPi') update.currentPi = versionName || null;
  if (sectionKey === 'nextPi') update.nextPi = versionName || null;
  try {
    await putJSON('/api/settings/pi', update);
    piSettings = update;
    renderPiConfigTabs();
    await loadAllSprintConfigs();
    // If active tab is no longer valid, switch to the first available PI
    const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];
    if (pis.length && !pis.includes(_piConfigActivePi as string)) {
      selectPiConfigTab(pis[0]);
    }
    refreshRoadmapView();
  } catch (e) {
    setPiConfigStatus('error', 'Failed to update PI: ' + (e as Error).message);
  }
}

// ── Sync PI from JIRA ────────────────────────────────────────
// Imports JIRA issues for the PI's fix version that don't exist locally yet.
// Distinct from the "Check JIRA" button (jira-pull.ts), which only refreshes
// issues that already have a local file.
export async function syncPiFromJira(sectionKey: PiSectionKey): Promise<void> {
  const versionName = sectionKey === 'currentPi' ? piSettings.currentPi : piSettings.nextPi;
  if (!versionName) {
    showJiraToast('error', 'Select a fix version for this PI before syncing from JIRA.');
    return;
  }

  const btn = document.getElementById(
    `pi-config-sync-btn-${sectionKey}`
  ) as HTMLButtonElement | null;
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<span class="spinner"></span><span class="pi-config-sync-btn-label">Syncing…</span>';
  }

  try {
    const data = (await fetchJSON(
      `/api/jira/by-fix-version/${encodeURIComponent(versionName)}`
    )) as JiraByFixVersionResponse;

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

    const newKeys = selected.filter((s) => !s.localExists).map((s) => s.key!);
    const overwriteKeys = selected.filter((s) => s.localExists).map((s) => s.key!);

    await performJiraPull([...newKeys, ...overwriteKeys], overwriteKeys, []);
    showJiraToast('success', `Synced ${selected.length} issue(s) from JIRA for "${versionName}".`);
  } catch (e) {
    showJiraToast('error', (e as Error).message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

export async function selectPiConfigTab(piName: string): Promise<void> {
  _piConfigActivePi = piName;
  // Update active tab style
  document.querySelectorAll('.pi-config-tab').forEach((t) => {
    t.classList.toggle('active', (t.textContent || '').includes(piName));
  });
  await loadSprintConfigForPi(piName);
}

export async function loadSprintConfigForPi(piName: string): Promise<void> {
  try {
    const data = (await fetchJSON(
      `/api/settings/pi/sprints/${encodeURIComponent(piName)}`
    )) as SprintsResponse;
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

export function renderSprintRows(sprints: Sprint[]): void {
  const container = document.getElementById('pi-config-sprints') as HTMLElement;
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

export function addSprintRow(): void {
  if (!_piConfigActivePi) return;
  const sprints = _sprintsFor(_piConfigActivePi);
  const nextNum = sprints.length + 1;
  sprints.push({ name: `Sprint ${nextNum}`, capacity: 40 });
  _setSprintsFor(_piConfigActivePi, sprints);
  renderSprintRows(sprints);
}

export function removeSprintRow(index: number): void {
  if (!_piConfigActivePi) return;
  const sprints = _sprintsFor(_piConfigActivePi);
  if (sprints.length <= 1) return; // keep at least one
  sprints.splice(index, 1);
  _setSprintsFor(_piConfigActivePi, sprints);
  renderSprintRows(sprints);
}

export function collectSprintRows(): Sprint[] {
  const rows = document.querySelectorAll('.pi-config-sprint-row');
  return Array.from(rows)
    .map((row) => ({
      name: (row.querySelector('.pi-config-sprint-name') as HTMLInputElement).value.trim(),
      capacity: Number((row.querySelector('.pi-config-sprint-cap') as HTMLInputElement).value) || 0,
    }))
    .filter((s) => s.name);
}

export async function saveSprintConfig(): Promise<void> {
  if (!_piConfigActivePi) return;
  const sprints = collectSprintRows();
  if (!sprints.length) {
    setPiConfigStatus('error', 'At least one sprint with a name is required.');
    return;
  }

  const btn = document.getElementById('pi-config-save-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const data = (await putJSON(
      `/api/settings/pi/sprints/${encodeURIComponent(_piConfigActivePi)}`,
      {
        sprints,
      }
    )) as SprintsResponse;
    _setSprintsFor(_piConfigActivePi, data.sprints || []);
    renderSprintRows(data.sprints || []);
    setPiConfigStatus('success', 'Sprint configuration saved.');
  } catch (e) {
    setPiConfigStatus('error', (e as Error).message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Configuration';
  }
}

export function setPiConfigStatus(type: string, message?: string): void {
  const el = document.getElementById('pi-config-status') as HTMLElement;
  el.className = `pi-config-status${type !== 'hidden' ? ' show ' + type : ''}`;
  el.textContent = message || '';
  if (type === 'success')
    setTimeout(() => {
      el.className = 'pi-config-status';
    }, 3000);
}

// Load sprint config for both PIs (called during init) — parallel fetches
export async function loadAllSprintConfigs(): Promise<void> {
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];

  const [, thresholdRes] = await Promise.all([
    // Fetch all PI sprint configs in parallel
    Promise.all(
      pis.map(async (piName) => {
        try {
          const data = (await fetchJSON(
            `/api/settings/pi/sprints/${encodeURIComponent(piName)}`
          )) as SprintsResponse;
          if (data.sprints && data.sprints.length) {
            _setSprintsFor(piName, data.sprints);
          }
        } catch (e) {
          console.warn(`Failed to load sprint config for ${piName}:`, (e as Error).message);
        }
      })
    ),
    // Fetch split threshold in parallel with sprint configs
    fetchJSON('/api/settings/pi/split-threshold').catch(
      () => null
    ) as Promise<SplitThresholdResponse | null>,
  ]);

  if (thresholdRes) {
    splitThreshold = thresholdRes.splitThreshold ?? 8;
    const el = document.getElementById('split-threshold-input') as HTMLInputElement | null;
    if (el) el.value = String(splitThreshold);
  }
}

export async function saveSplitThreshold(value: string): Promise<void> {
  const val = parseInt(value, 10);
  if (!val || val < 1) return;
  try {
    await putJSON('/api/settings/pi/split-threshold', { splitThreshold: val });
    splitThreshold = val;
    refreshRoadmapView();
    setPiConfigStatus('success', `Split threshold set to ${val} SP`);
  } catch (e) {
    console.warn('Failed to save split threshold:', (e as Error).message);
  }
}

// Get sprint names for a given PI version name
export function getSprintsForPi(piVersionName: string): Sprint[] {
  return _sprintsFor(piVersionName);
}
