// ── Roadmap: JIRA sprint sync modals ────────────────────────────
// Push local sprint assignments to JIRA, and pull new/changed issues from
// JIRA sprints into the local backlog. Both are modal-driven flows that
// stream SSE progress from the server via raw fetch (not the shared
// fetchJSON/postJSON helpers, which only handle single JSON responses).
import { escHtml, postJSON, showJiraToast, getErrorMessage } from './state.js';
import type { SprintConfig } from './state.js';
import { loadDocs } from './list.js';
import type { RoadmapSprint } from './roadmap.js';

// ── Push Sprints to JIRA (modal-based) ──────────────────────
interface SprintPushItem {
  filename: string;
  docType: string;
  sprint: string;
  jiraId: string | null;
  title: string;
}

interface SprintPushChange {
  changeType: 'add' | 'change' | 'pull' | string;
  jiraId: string;
  filename?: string;
  docType?: string;
  title: string;
  targetSprint?: string;
  currentJiraSprint?: string;
}

let _sprintPushPreview: SprintPushChange[] = []; // current preview changes
let _sprintPushFilters: Record<string, boolean> = { add: true, change: true, pull: true };
let _sprintPushItems: SprintPushItem[] = []; // items prepared for preview

export async function pushSprintsToJira(): Promise<void> {
  const leafTypes = new Set(['story', 'spike', 'bug']);
  _sprintPushItems = allDocs
    .filter((d) => leafTypes.has(d.docType) && d.jiraId)
    .map((d) => ({
      filename: d.filename,
      docType: d.docType,
      sprint: d.sprint || '',
      jiraId: d.jiraId,
      title: d.title || d.filename,
    }));

  if (!_sprintPushItems.length) {
    showJiraToast('warn', 'No stories with a JIRA ID found.');
    return;
  }

  openSprintPushModal();
}

export function openSprintPushModal(): void {
  _sprintPushPreview = [];
  _sprintPushFilters = { add: true, change: true, pull: true };

  // Reset all steps
  (document.getElementById('sprint-push-select-step') as HTMLElement).style.display = '';
  document.getElementById('sprint-push-loading')!.classList.remove('show');
  document.getElementById('sprint-push-error')!.classList.remove('show');
  document.getElementById('sprint-push-empty')!.classList.remove('show');
  document.getElementById('sprint-push-list')!.innerHTML = '';
  document.getElementById('sprint-push-stats')!.textContent = '';
  (document.getElementById('sprint-push-actions') as HTMLElement).style.display = 'none';
  (document.getElementById('sprint-push-filters') as HTMLElement).style.display = 'none';
  document.getElementById('sprint-push-progress-msg')!.textContent =
    'Comparing sprint assignments with JIRA…';
  (document.getElementById('sprint-push-progress-fill') as HTMLElement).style.width = '0%';

  // Reset filter pills
  document.querySelectorAll('.sprint-push-pill').forEach((p) => p.classList.add('active'));

  // Populate sprint checkboxes from all PIs
  _populateSprintSelector();

  document.getElementById('sprint-push-overlay')!.classList.add('show');
}

function _populateSprintSelector(): void {
  const container = document.getElementById('sprint-push-sprint-list')!;
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];
  const seen = new Set<string>();
  let html = '';

  for (const pi of pis) {
    const sprints = ((sprintConfig as SprintConfig)[pi] as RoadmapSprint[] | undefined) || [];
    if (!sprints.length) continue;
    html += `<div class="sprint-push-pi-group"><span class="sprint-push-pi-label">${escHtml(pi)}</span>`;
    for (const s of sprints) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      html += `<label class="sprint-push-sprint-cb"><input type="checkbox" checked value="${escHtml(s.name)}"><span>${escHtml(s.name)}</span></label>`;
    }
    html += '</div>';
  }

  container.innerHTML = html || '<p class="sprint-push-no-sprints">No sprints configured.</p>';

  // Enable/disable preview button
  _updatePreviewBtnState();
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', _updatePreviewBtnState);
  });
}

function _updatePreviewBtnState(): void {
  const checked = document.querySelectorAll(
    '#sprint-push-sprint-list input[type="checkbox"]:checked'
  );
  const btn = document.getElementById('sprint-push-preview-btn') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = checked.length === 0;
    btn.textContent = checked.length
      ? `Preview Changes (${checked.length} sprint${checked.length !== 1 ? 's' : ''})`
      : 'Select sprints';
  }
}

export function sprintPushToggleAllSprints(checked: boolean): void {
  document
    .querySelectorAll<HTMLInputElement>('#sprint-push-sprint-list input[type="checkbox"]')
    .forEach((cb) => {
      cb.checked = checked;
    });
  _updatePreviewBtnState();
}

export async function startSprintPushPreview(): Promise<void> {
  // Gather selected sprints
  const selectedSprints = [
    ...document.querySelectorAll<HTMLInputElement>(
      '#sprint-push-sprint-list input[type="checkbox"]:checked'
    ),
  ].map((cb) => cb.value);

  if (!selectedSprints.length) return;

  // Switch to loading step
  (document.getElementById('sprint-push-select-step') as HTMLElement).style.display = 'none';
  document.getElementById('sprint-push-loading')!.classList.add('show');

  try {
    const body = JSON.stringify({ items: _sprintPushItems, selectedSprints });
    // Raw fetch: this streams SSE progress events, not a single JSON response —
    // the shared fetchJSON/postJSON helpers don't apply here.
    const response = await fetch('/api/jira/push-sprints-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: { changes?: SprintPushChange[] } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6)) as {
            type?: string;
            message?: string;
            current?: number;
            total?: number;
            changes?: SprintPushChange[];
          };
          if (payload.type === 'progress') {
            document.getElementById('sprint-push-progress-msg')!.textContent =
              payload.message ?? '';
            if (payload.current && payload.total) {
              const pct = Math.round((payload.current / payload.total) * 100);
              (document.getElementById('sprint-push-progress-fill') as HTMLElement).style.width =
                pct + '%';
            }
          } else if (payload.type === 'result') {
            result = payload;
          } else if (payload.type === 'error') {
            throw new Error(payload.message);
          }
        } catch (parseErr) {
          const msg = (parseErr as Error).message;
          if (msg && !msg.includes('JSON')) throw parseErr;
        }
      }
    }

    if (result) {
      _sprintPushPreview = result.changes || [];
      renderSprintPushPreview(result as { changes?: SprintPushChange[] });
    } else {
      showSprintPushError('No response received from server.');
    }
  } catch (e) {
    showSprintPushError('Failed to fetch preview: ' + getErrorMessage(e));
  }
}

export function closeSprintPushModal(): void {
  document.getElementById('sprint-push-overlay')!.classList.remove('show');
}

function showSprintPushError(msg: string): void {
  document.getElementById('sprint-push-loading')!.classList.remove('show');
  (document.getElementById('sprint-push-select-step') as HTMLElement).style.display = 'none';
  const el = document.getElementById('sprint-push-error')!;
  el.textContent = msg;
  el.classList.add('show');
}

function renderSprintPushPreview(preview: { changes?: SprintPushChange[] }): void {
  document.getElementById('sprint-push-loading')!.classList.remove('show');

  // Filter out items where the sprint hasn't actually changed (client-side safety net)
  const allChanges = preview.changes || [];
  const changes = allChanges.filter((c) => {
    if (c.changeType === 'change' && c.targetSprint && c.currentJiraSprint) {
      return c.targetSprint.toLowerCase().trim() !== c.currentJiraSprint.toLowerCase().trim();
    }
    return ['add', 'change', 'pull'].includes(c.changeType);
  });

  if (!changes.length) {
    document.getElementById('sprint-push-empty')!.classList.add('show');
    document.getElementById('sprint-push-stats')!.textContent = 'All in sync';
    return;
  }

  // Show filters and actions
  (document.getElementById('sprint-push-filters') as HTMLElement).style.display = 'flex';
  (document.getElementById('sprint-push-actions') as HTMLElement).style.display = 'flex';

  // Recompute counts from filtered set
  const adds = changes.filter((c) => c.changeType === 'add').length;
  const changesCount = changes.filter((c) => c.changeType === 'change').length;
  const pulls = changes.filter((c) => c.changeType === 'pull').length;

  // Update pill counts
  document.getElementById('sprint-push-count-add')!.textContent = String(adds);
  document.getElementById('sprint-push-count-change')!.textContent = String(changesCount);
  document.getElementById('sprint-push-count-pull')!.textContent = String(pulls);

  // Stats summary
  document.getElementById('sprint-push-stats')!.textContent =
    `${changes.length} change${changes.length !== 1 ? 's' : ''} found`;

  // Render rows
  const list = document.getElementById('sprint-push-list')!;
  list.innerHTML = '';

  for (const c of changes) {
    const row = document.createElement('label');
    row.className = 'sprint-push-item';
    row.dataset['type'] = c.changeType;

    let arrow = '';
    const badgeLabel =
      c.changeType === 'add' ? 'push' : c.changeType === 'pull' ? 'pull' : c.changeType;
    if (c.changeType === 'add') {
      arrow = `— → ${c.targetSprint}`;
    } else if (c.changeType === 'change') {
      arrow = `${c.currentJiraSprint} → ${c.targetSprint}`;
    } else if (c.changeType === 'pull') {
      arrow = `JIRA: ${c.currentJiraSprint} → local`;
    }

    row.innerHTML = `
      <input type="checkbox" checked data-jira-id="${c.jiraId}" data-change-type="${c.changeType}"
             data-filename="${c.filename || ''}" data-target-sprint="${c.targetSprint || ''}"
             data-doc-type="${c.docType || ''}"
             onchange="_sprintPushUpdateCount()">
      <span class="sprint-push-item-title" title="${_escHtml(c.title)}">${_escHtml(c.title)}</span>
      <span class="sprint-push-item-key">${_escHtml(c.jiraId)}</span>
      <span class="sprint-push-item-arrow">${_escHtml(arrow)}</span>
      <span class="sprint-push-badge sprint-push-badge-${c.changeType}">${_escHtml(badgeLabel)}</span>
    `;
    list.appendChild(row);
  }

  _sprintPushUpdateCount();
}

function _escHtml(s: string | null | undefined): string {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

export function toggleSprintPushFilter(type: string): void {
  _sprintPushFilters[type] = !_sprintPushFilters[type];

  // Update pill active state
  const pill = document.querySelector(`.sprint-push-pill-${type}`);
  if (pill) pill.classList.toggle('active', _sprintPushFilters[type]);

  _applySprintPushFilters();
}

function _applySprintPushFilters(): void {
  const items = document.querySelectorAll<HTMLElement>('.sprint-push-item');
  items.forEach((item) => {
    const type = item.dataset['type'] ?? '';
    item.style.display = _sprintPushFilters[type] ? '' : 'none';
  });
}

export function sprintPushSelectAll(checked: boolean): void {
  document.querySelectorAll<HTMLElement>('.sprint-push-item').forEach((item) => {
    if (item.style.display === 'none') return; // skip hidden
    const cb = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (cb) cb.checked = checked;
  });
  _sprintPushUpdateCount();
}

export function _sprintPushUpdateCount(): void {
  const all = document.querySelectorAll<HTMLInputElement>(
    '.sprint-push-item input[type="checkbox"]'
  );
  const checked = [...all].filter((cb) => cb.checked).length;
  const btn = document.getElementById('sprint-push-confirm') as HTMLButtonElement;
  btn.textContent = `Sync Changes (${checked}/${all.length})`;
  btn.disabled = checked === 0;
}

interface SprintPushResultItem {
  status: 'ok' | 'skipped' | 'error' | string;
}

export async function confirmSprintPush(): Promise<void> {
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    '.sprint-push-item input[type="checkbox"]:checked'
  );
  if (!checkboxes.length) return;

  const btn = document.getElementById('sprint-push-confirm') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Syncing…';

  const items = [...checkboxes].map((cb) => ({
    filename: cb.dataset['filename'],
    sprint: cb.dataset['targetSprint'],
    changeType: cb.dataset['changeType'],
    jiraId: cb.dataset['jiraId'],
    docType: cb.dataset['docType'] || '',
  }));

  try {
    const res = (await postJSON('/api/jira/push-sprints', { items })) as {
      results?: SprintPushResultItem[];
    };
    const ok = (res.results || []).filter((r) => r.status === 'ok').length;
    const skipped = (res.results || []).filter((r) => r.status === 'skipped').length;
    const errors = (res.results || []).filter((r) => r.status === 'error').length;
    const pushed = items.filter((i) => i.changeType === 'add' || i.changeType === 'change').length;
    const pulled = items.filter((i) => i.changeType === 'pull').length;
    let msg = `Sprint sync: ${ok} updated`;
    if (pushed) msg += ` (${pushed} pushed)`;
    if (pulled) msg += ` (${pulled} pulled)`;
    if (skipped) msg += `, ${skipped} skipped`;
    if (errors) msg += `, ${errors} failed`;
    showJiraToast(errors ? 'warn' : 'success', msg);
    if (pulled > 0) loadDocs(); // refresh local data after pull
    closeSprintPushModal();
  } catch (e) {
    showJiraToast('error', 'Failed to push sprints: ' + getErrorMessage(e));
    btn.disabled = false;
    _sprintPushUpdateCount();
  }
}

// ── Pull from JIRA Sprints ───────────────────────────────────

const JIRA_TYPE_TO_LOCAL: Record<string, string> = {
  'New Feature': 'feature',
  Epic: 'epic',
  Story: 'story',
  Improvement: 'story',
  Task: 'spike',
  Bug: 'bug',
};

export function pullFromJiraSprints(): void {
  const overlay = document.getElementById('pull-sprint-overlay')!;
  // Reset UI state
  (document.getElementById('pull-sprint-select-step') as HTMLElement).style.display = '';
  (document.getElementById('pull-sprint-loading') as HTMLElement).style.display = 'none';
  (document.getElementById('pull-sprint-error') as HTMLElement).style.display = 'none';
  (document.getElementById('pull-sprint-empty') as HTMLElement).style.display = 'none';
  document.getElementById('pull-sprint-results')!.innerHTML = '';
  (document.getElementById('pull-sprint-actions') as HTMLElement).style.display = 'none';

  // Populate sprint checkboxes
  const list = document.getElementById('pull-sprint-list')!;
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];
  let html = '';
  for (const pi of pis) {
    const sprints = ((sprintConfig as SprintConfig)[pi] as RoadmapSprint[] | undefined) || [];
    if (!sprints.length) continue;
    html += `<div class="sprint-push-pi-group"><strong>${escHtml(pi)}</strong></div>`;
    for (const s of sprints) {
      html += `<label class="sprint-push-sprint-item"><input type="checkbox" value="${escHtml(s.name)}" checked />${escHtml(s.name)}</label>`;
    }
  }
  list.innerHTML = html;
  overlay.classList.add('show');
}

export function closePullSprintModal(): void {
  document.getElementById('pull-sprint-overlay')!.classList.remove('show');
}

export function pullSprintToggleAll(checked: boolean): void {
  document
    .querySelectorAll<HTMLInputElement>('#pull-sprint-list input[type="checkbox"]')
    .forEach((cb) => (cb.checked = checked));
}

interface PullSprintResult {
  key: string;
  issuetype: string;
  summary: string;
  sprintName: string;
  storyPoints?: number | null;
}

export async function startPullSprintPreview(): Promise<void> {
  const cbs = document.querySelectorAll<HTMLInputElement>(
    '#pull-sprint-list input[type="checkbox"]:checked'
  );
  const selectedSprints = [...cbs].map((cb) => cb.value);
  if (!selectedSprints.length) {
    showJiraToast('error', 'Select at least one sprint');
    return;
  }

  (document.getElementById('pull-sprint-select-step') as HTMLElement).style.display = 'none';
  (document.getElementById('pull-sprint-loading') as HTMLElement).style.display = '';
  (document.getElementById('pull-sprint-error') as HTMLElement).style.display = 'none';
  (document.getElementById('pull-sprint-empty') as HTMLElement).style.display = 'none';
  document.getElementById('pull-sprint-results')!.innerHTML = '';
  (document.getElementById('pull-sprint-actions') as HTMLElement).style.display = 'none';

  try {
    // Raw fetch: this streams SSE progress events, not a single JSON response —
    // the shared fetchJSON/postJSON helpers don't apply here.
    const res = await fetch('/api/jira/pull-sprint-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedSprints }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: PullSprintResult[] | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const msg = JSON.parse(line.slice(6)) as {
          type?: string;
          message?: string;
          results?: PullSprintResult[];
        };
        if (msg.type === 'progress') {
          document.getElementById('pull-sprint-progress-msg')!.textContent = msg.message ?? '';
        } else if (msg.type === 'error') {
          (document.getElementById('pull-sprint-loading') as HTMLElement).style.display = 'none';
          (document.getElementById('pull-sprint-error') as HTMLElement).style.display = '';
          document.getElementById('pull-sprint-error')!.textContent = msg.message ?? '';
          return;
        } else if (msg.type === 'done') {
          result = msg.results ?? null;
        }
      }
    }

    (document.getElementById('pull-sprint-loading') as HTMLElement).style.display = 'none';

    if (!result || !result.length) {
      (document.getElementById('pull-sprint-empty') as HTMLElement).style.display = '';
      return;
    }

    _renderPullSprintResults(result);
  } catch (e) {
    (document.getElementById('pull-sprint-loading') as HTMLElement).style.display = 'none';
    (document.getElementById('pull-sprint-error') as HTMLElement).style.display = '';
    document.getElementById('pull-sprint-error')!.textContent = getErrorMessage(e);
  }
}

function _renderPullSprintResults(results: PullSprintResult[]): void {
  const container = document.getElementById('pull-sprint-results')!;
  let html = `<div class="sprint-push-results-header">
    <label><input type="checkbox" checked onchange="pullSprintSelectAllItems(this.checked)" /> Select all</label>
    <span>${results.length} new issue${results.length !== 1 ? 's' : ''} found</span>
  </div>`;

  for (const r of results) {
    const localType = JIRA_TYPE_TO_LOCAL[r.issuetype] || 'story';
    const typeBadge = `<span class="sprint-push-type sprint-push-type-${localType}">${escHtml(r.issuetype)}</span>`;
    const sp = r.storyPoints ? `${r.storyPoints} SP` : '';
    html += `<label class="sprint-push-item">
      <input type="checkbox" checked value="${escHtml(r.key)}" data-sprint="${escHtml(r.sprintName)}" onchange="_pullSprintUpdateCount()" />
      <div class="sprint-push-item-info">
        <div class="sprint-push-item-title">${typeBadge} <strong>${escHtml(r.key)}</strong> ${escHtml(r.summary)}</div>
        <div class="sprint-push-item-meta">${escHtml(r.sprintName)} ${sp ? '· ' + sp : ''}</div>
      </div>
    </label>`;
  }
  container.innerHTML = html;
  (document.getElementById('pull-sprint-actions') as HTMLElement).style.display = '';
  _pullSprintUpdateCount();
}

export function pullSprintSelectAllItems(checked: boolean): void {
  document
    .querySelectorAll<HTMLInputElement>('#pull-sprint-results input[type="checkbox"]')
    .forEach((cb) => (cb.checked = checked));
  _pullSprintUpdateCount();
}

export function _pullSprintUpdateCount(): void {
  const checked = document.querySelectorAll(
    '#pull-sprint-results input[type="checkbox"]:checked'
  ).length;
  const total = document.querySelectorAll('#pull-sprint-results input[type="checkbox"]').length;
  const btn = document.getElementById('pull-sprint-confirm');
  if (btn) btn.textContent = `Pull Selected (${checked}/${total})`;
}

export async function confirmPullSprint(): Promise<void> {
  const cbs = document.querySelectorAll<HTMLInputElement>(
    '#pull-sprint-results input[type="checkbox"]:checked'
  );
  const issues = [...cbs].map((cb) => ({ key: cb.value, sprintName: cb.dataset['sprint'] }));
  if (!issues.length) {
    showJiraToast('error', 'No issues selected');
    return;
  }

  const btn = document.getElementById('pull-sprint-confirm') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Pulling…';

  try {
    const data = (await postJSON('/api/jira/pull-sprint', { issues })) as {
      results?: SprintPushResultItem[];
    };
    const ok = data.results?.filter((r) => r.status === 'ok').length || 0;
    const err = data.results?.filter((r) => r.status === 'error').length || 0;
    showJiraToast('ok', `Pulled ${ok} issue${ok !== 1 ? 's' : ''}${err ? `, ${err} failed` : ''}`);
    closePullSprintModal();
    loadDocs();
  } catch (e) {
    showJiraToast('error', 'Pull failed: ' + getErrorMessage(e));
    btn.disabled = false;
    _pullSprintUpdateCount();
  }
}
