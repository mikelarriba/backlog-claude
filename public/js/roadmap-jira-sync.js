// ── Roadmap: JIRA sprint sync modals ────────────────────────────
// Push local sprint assignments to JIRA, and pull new/changed issues from
// JIRA sprints into the local backlog. Both are modal-driven flows that
// stream SSE progress from the server via raw fetch (not the shared
// fetchJSON/postJSON helpers, which only handle single JSON responses).
import {
  escHtml,
  postJSON,
  showJiraToast,
  getErrorMessage,
  openModal,
  closeModal,
} from './state.js';
import { loadDocs } from './list.js';
import { registerChangeActions } from './actions.js';
// Typed data-change-action names for the sprint-push and pull-sprint
// checkboxes' onchange handlers (issue #461 migration — see the
// "Change-event registry" section of actions.ts and DOC_CHANGE_ACTIONS in
// documentation.ts for the established pattern).
export const ROADMAP_JIRA_SYNC_CHANGE_ACTIONS = {
  sprintPushUpdateCount: 'roadmapJiraSyncSprintPushUpdateCount',
  pullSprintUpdateCount: 'roadmapJiraSyncPullSprintUpdateCount',
  pullSprintSelectAllItems: 'roadmapJiraSyncPullSprintSelectAllItems',
};
registerChangeActions({
  [ROADMAP_JIRA_SYNC_CHANGE_ACTIONS.sprintPushUpdateCount]: () => {
    _sprintPushUpdateCount();
  },
  [ROADMAP_JIRA_SYNC_CHANGE_ACTIONS.pullSprintUpdateCount]: () => {
    _pullSprintUpdateCount();
  },
  [ROADMAP_JIRA_SYNC_CHANGE_ACTIONS.pullSprintSelectAllItems]: (el) => {
    pullSprintSelectAllItems(el.checked);
  },
});
// Pure: buffer-line splitting shared by both SSE-over-fetch streams below
// (push-sprints-preview and pull-sprint-preview). `\n`-terminated lines are
// ready to process; any trailing partial line is carried forward as the new
// buffer, exactly like the original inline `buffer.split('\n'); buffer =
// lines.pop()` pattern at each call site.
export function splitSSEBuffer(buffer) {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  return { lines, remainder };
}
// Pure: strips the "data: " prefix from one SSE line, returning the raw JSON
// text still to be parsed by the caller (kept separate from JSON.parse so
// callers can decide their own try/catch scope around malformed payloads),
// or null for lines that aren't a data line (blank keep-alives, event:/id:
// lines, etc).
export function extractSSEDataPayload(line) {
  if (!line.startsWith('data: ')) return null;
  return line.slice(6);
}
let _sprintPushPreview = []; // current preview changes
let _sprintPushFilters = { add: true, change: true, pull: true };
let _sprintPushItems = []; // items prepared for preview
export async function pushSprintsToJira() {
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
export function openSprintPushModal() {
  _sprintPushPreview = [];
  _sprintPushFilters = { add: true, change: true, pull: true };
  // Reset all steps
  document.getElementById('sprint-push-select-step').style.display = '';
  document.getElementById('sprint-push-loading').classList.remove('show');
  document.getElementById('sprint-push-error').classList.remove('show');
  document.getElementById('sprint-push-empty').classList.remove('show');
  document.getElementById('sprint-push-list').innerHTML = '';
  document.getElementById('sprint-push-stats').textContent = '';
  document.getElementById('sprint-push-actions').style.display = 'none';
  document.getElementById('sprint-push-filters').style.display = 'none';
  document.getElementById('sprint-push-progress-msg').textContent =
    'Comparing sprint assignments with JIRA…';
  document.getElementById('sprint-push-progress-fill').style.width = '0%';
  // Reset filter pills
  document.querySelectorAll('.sprint-push-pill').forEach((p) => p.classList.add('active'));
  // Populate sprint checkboxes from all PIs
  _populateSprintSelector();
  openModal('sprint-push-overlay');
}
function _populateSprintSelector() {
  const container = document.getElementById('sprint-push-sprint-list');
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  const seen = new Set();
  let html = '';
  for (const pi of pis) {
    const sprints = sprintConfig[pi] || [];
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
function _updatePreviewBtnState() {
  const checked = document.querySelectorAll(
    '#sprint-push-sprint-list input[type="checkbox"]:checked'
  );
  const btn = document.getElementById('sprint-push-preview-btn');
  if (btn) {
    btn.disabled = checked.length === 0;
    btn.textContent = checked.length
      ? `Preview Changes (${checked.length} sprint${checked.length !== 1 ? 's' : ''})`
      : 'Select sprints';
  }
}
export function sprintPushToggleAllSprints(checked) {
  document.querySelectorAll('#sprint-push-sprint-list input[type="checkbox"]').forEach((cb) => {
    cb.checked = checked;
  });
  _updatePreviewBtnState();
}
export async function startSprintPushPreview() {
  // Gather selected sprints
  const selectedSprints = [
    ...document.querySelectorAll('#sprint-push-sprint-list input[type="checkbox"]:checked'),
  ].map((cb) => cb.value);
  if (!selectedSprints.length) return;
  // Switch to loading step
  document.getElementById('sprint-push-select-step').style.display = 'none';
  document.getElementById('sprint-push-loading').classList.add('show');
  try {
    const body = JSON.stringify({ items: _sprintPushItems, selectedSprints });
    // Raw fetch: this streams SSE progress events, not a single JSON response —
    // the shared fetchJSON/postJSON helpers don't apply here.
    const response = await fetch('/api/jira/push-sprints-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { lines, remainder } = splitSSEBuffer(buffer);
      buffer = remainder;
      for (const line of lines) {
        const raw = extractSSEDataPayload(line);
        if (raw === null) continue;
        try {
          const payload = JSON.parse(raw);
          if (payload.type === 'progress') {
            document.getElementById('sprint-push-progress-msg').textContent = payload.message ?? '';
            if (payload.current && payload.total) {
              const pct = Math.round((payload.current / payload.total) * 100);
              document.getElementById('sprint-push-progress-fill').style.width = pct + '%';
            }
          } else if (payload.type === 'result') {
            result = payload;
          } else if (payload.type === 'error') {
            throw new Error(payload.message);
          }
        } catch (parseErr) {
          const msg = parseErr.message;
          if (msg && !msg.includes('JSON')) throw parseErr;
        }
      }
    }
    if (result) {
      _sprintPushPreview = result.changes || [];
      renderSprintPushPreview(result);
    } else {
      showSprintPushError('No response received from server.');
    }
  } catch (e) {
    showSprintPushError('Failed to fetch preview: ' + getErrorMessage(e));
  }
}
export function closeSprintPushModal() {
  closeModal('sprint-push-overlay');
}
function showSprintPushError(msg) {
  document.getElementById('sprint-push-loading').classList.remove('show');
  document.getElementById('sprint-push-select-step').style.display = 'none';
  const el = document.getElementById('sprint-push-error');
  el.textContent = msg;
  el.classList.add('show');
}
// Pure: client-side safety net that drops "change" entries whose target
// sprint is actually identical to the current JIRA sprint (case/whitespace
// insensitive), and drops any change type outside the known set entirely.
export function filterSprintPushChanges(changes) {
  return changes.filter((c) => {
    if (c.changeType === 'change' && c.targetSprint && c.currentJiraSprint) {
      return c.targetSprint.toLowerCase().trim() !== c.currentJiraSprint.toLowerCase().trim();
    }
    return ['add', 'change', 'pull'].includes(c.changeType);
  });
}
// Pure: counts filtered changes by change type, for the filter-pill badges.
export function countSprintPushChangesByType(changes) {
  return {
    adds: changes.filter((c) => c.changeType === 'add').length,
    changesCount: changes.filter((c) => c.changeType === 'change').length,
    pulls: changes.filter((c) => c.changeType === 'pull').length,
  };
}
// Pure: the "from → to" arrow text shown per change row.
export function formatSprintChangeArrow(c) {
  if (c.changeType === 'add') return `— → ${c.targetSprint}`;
  if (c.changeType === 'change') return `${c.currentJiraSprint} → ${c.targetSprint}`;
  if (c.changeType === 'pull') return `JIRA: ${c.currentJiraSprint} → local`;
  return '';
}
// Pure: the badge label per change type ("add" reads as "push" to the user).
export function sprintChangeBadgeLabel(c) {
  return c.changeType === 'add' ? 'push' : c.changeType === 'pull' ? 'pull' : c.changeType;
}
// Pure: renders a single sprint-push preview row's HTML (checkbox with its
// data-* attributes, title, key, arrow, and change-type badge). Extracted
// from renderSprintPushPreview's row-building loop so the arrow/badge
// wiring and escaping are unit-testable without a DOM.
export function buildSprintPushRowHtml(c) {
  const arrow = formatSprintChangeArrow(c);
  const badgeLabel = sprintChangeBadgeLabel(c);
  return `
      <input type="checkbox" checked data-jira-id="${c.jiraId}" data-change-type="${c.changeType}"
             data-filename="${c.filename || ''}" data-target-sprint="${c.targetSprint || ''}"
             data-doc-type="${c.docType || ''}"
             data-change-action="${ROADMAP_JIRA_SYNC_CHANGE_ACTIONS.sprintPushUpdateCount}">
      <span class="sprint-push-item-title" title="${escHtml(c.title)}">${escHtml(c.title)}</span>
      <span class="sprint-push-item-key">${escHtml(c.jiraId)}</span>
      <span class="sprint-push-item-arrow">${escHtml(arrow)}</span>
      <span class="sprint-push-badge sprint-push-badge-${c.changeType}">${escHtml(badgeLabel)}</span>
    `;
}
function renderSprintPushPreview(preview) {
  document.getElementById('sprint-push-loading').classList.remove('show');
  // Filter out items where the sprint hasn't actually changed (client-side safety net)
  const allChanges = preview.changes || [];
  const changes = filterSprintPushChanges(allChanges);
  if (!changes.length) {
    document.getElementById('sprint-push-empty').classList.add('show');
    document.getElementById('sprint-push-stats').textContent = 'All in sync';
    return;
  }
  // Show filters and actions
  document.getElementById('sprint-push-filters').style.display = 'flex';
  document.getElementById('sprint-push-actions').style.display = 'flex';
  // Recompute counts from filtered set
  const { adds, changesCount, pulls } = countSprintPushChangesByType(changes);
  // Update pill counts
  document.getElementById('sprint-push-count-add').textContent = String(adds);
  document.getElementById('sprint-push-count-change').textContent = String(changesCount);
  document.getElementById('sprint-push-count-pull').textContent = String(pulls);
  // Stats summary
  document.getElementById('sprint-push-stats').textContent =
    `${changes.length} change${changes.length !== 1 ? 's' : ''} found`;
  // Render rows
  const list = document.getElementById('sprint-push-list');
  list.innerHTML = '';
  for (const c of changes) {
    const row = document.createElement('label');
    row.className = 'sprint-push-item';
    row.dataset['type'] = c.changeType;
    row.innerHTML = buildSprintPushRowHtml(c);
    list.appendChild(row);
  }
  _sprintPushUpdateCount();
}
export function toggleSprintPushFilter(type) {
  _sprintPushFilters[type] = !_sprintPushFilters[type];
  // Update pill active state
  const pill = document.querySelector(`.sprint-push-pill-${type}`);
  if (pill) pill.classList.toggle('active', _sprintPushFilters[type]);
  _applySprintPushFilters();
}
function _applySprintPushFilters() {
  const items = document.querySelectorAll('.sprint-push-item');
  items.forEach((item) => {
    const type = item.dataset['type'] ?? '';
    item.style.display = _sprintPushFilters[type] ? '' : 'none';
  });
}
export function sprintPushSelectAll(checked) {
  document.querySelectorAll('.sprint-push-item').forEach((item) => {
    if (item.style.display === 'none') return; // skip hidden
    const cb = item.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = checked;
  });
  _sprintPushUpdateCount();
}
// Pure: confirm-button label + disabled state for the sprint-push selection
// count, extracted out of _sprintPushUpdateCount below.
export function formatSprintPushConfirmLabel(checked, total) {
  return { text: `Sync Changes (${checked}/${total})`, disabled: checked === 0 };
}
export function _sprintPushUpdateCount() {
  const all = document.querySelectorAll('.sprint-push-item input[type="checkbox"]');
  const checked = [...all].filter((cb) => cb.checked).length;
  const btn = document.getElementById('sprint-push-confirm');
  const { text, disabled } = formatSprintPushConfirmLabel(checked, all.length);
  btn.textContent = text;
  btn.disabled = disabled;
}
// Pure: "Sprint sync: N updated (N pushed) (N pulled), N skipped, N failed"
// summary, plus the pulled count the caller uses to decide whether to
// refresh local data.
export function summarizeSprintPushResult(items, results) {
  const ok = results.filter((r) => r.status === 'ok').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const pushed = items.filter((i) => i.changeType === 'add' || i.changeType === 'change').length;
  const pulled = items.filter((i) => i.changeType === 'pull').length;
  let msg = `Sprint sync: ${ok} updated`;
  if (pushed) msg += ` (${pushed} pushed)`;
  if (pulled) msg += ` (${pulled} pulled)`;
  if (skipped) msg += `, ${skipped} skipped`;
  if (errors) msg += `, ${errors} failed`;
  return { msg, pulled, errors };
}
export async function confirmSprintPush() {
  const checkboxes = document.querySelectorAll('.sprint-push-item input[type="checkbox"]:checked');
  if (!checkboxes.length) return;
  const btn = document.getElementById('sprint-push-confirm');
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
    const res = await postJSON('/api/jira/push-sprints', { items });
    const { msg, pulled, errors } = summarizeSprintPushResult(items, res.results || []);
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
export const JIRA_TYPE_TO_LOCAL = {
  'New Feature': 'feature',
  Epic: 'epic',
  Story: 'story',
  Improvement: 'story',
  Task: 'spike',
  Bug: 'bug',
};
export function pullFromJiraSprints() {
  // Reset UI state
  document.getElementById('pull-sprint-select-step').style.display = '';
  document.getElementById('pull-sprint-loading').style.display = 'none';
  document.getElementById('pull-sprint-error').style.display = 'none';
  document.getElementById('pull-sprint-empty').style.display = 'none';
  document.getElementById('pull-sprint-results').innerHTML = '';
  document.getElementById('pull-sprint-actions').style.display = 'none';
  // Populate sprint checkboxes
  const list = document.getElementById('pull-sprint-list');
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  let html = '';
  for (const pi of pis) {
    const sprints = sprintConfig[pi] || [];
    if (!sprints.length) continue;
    html += `<div class="sprint-push-pi-group"><strong>${escHtml(pi)}</strong></div>`;
    for (const s of sprints) {
      html += `<label class="sprint-push-sprint-item"><input type="checkbox" value="${escHtml(s.name)}" checked />${escHtml(s.name)}</label>`;
    }
  }
  list.innerHTML = html;
  openModal('pull-sprint-overlay');
}
export function closePullSprintModal() {
  closeModal('pull-sprint-overlay');
}
export function pullSprintToggleAll(checked) {
  document
    .querySelectorAll('#pull-sprint-list input[type="checkbox"]')
    .forEach((cb) => (cb.checked = checked));
}
export async function startPullSprintPreview() {
  const cbs = document.querySelectorAll('#pull-sprint-list input[type="checkbox"]:checked');
  const selectedSprints = [...cbs].map((cb) => cb.value);
  if (!selectedSprints.length) {
    showJiraToast('error', 'Select at least one sprint');
    return;
  }
  document.getElementById('pull-sprint-select-step').style.display = 'none';
  document.getElementById('pull-sprint-loading').style.display = '';
  document.getElementById('pull-sprint-error').style.display = 'none';
  document.getElementById('pull-sprint-empty').style.display = 'none';
  document.getElementById('pull-sprint-results').innerHTML = '';
  document.getElementById('pull-sprint-actions').style.display = 'none';
  try {
    // Raw fetch: this streams SSE progress events, not a single JSON response —
    // the shared fetchJSON/postJSON helpers don't apply here.
    const res = await fetch('/api/jira/pull-sprint-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedSprints }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { lines, remainder } = splitSSEBuffer(buffer);
      buffer = remainder;
      for (const line of lines) {
        const raw = extractSSEDataPayload(line);
        if (raw === null) continue;
        const msg = JSON.parse(raw);
        if (msg.type === 'progress') {
          document.getElementById('pull-sprint-progress-msg').textContent = msg.message ?? '';
        } else if (msg.type === 'error') {
          document.getElementById('pull-sprint-loading').style.display = 'none';
          document.getElementById('pull-sprint-error').style.display = '';
          document.getElementById('pull-sprint-error').textContent = msg.message ?? '';
          return;
        } else if (msg.type === 'done') {
          result = msg.results ?? null;
        }
      }
    }
    document.getElementById('pull-sprint-loading').style.display = 'none';
    if (!result || !result.length) {
      document.getElementById('pull-sprint-empty').style.display = '';
      return;
    }
    _renderPullSprintResults(result);
  } catch (e) {
    document.getElementById('pull-sprint-loading').style.display = 'none';
    document.getElementById('pull-sprint-error').style.display = '';
    document.getElementById('pull-sprint-error').textContent = getErrorMessage(e);
  }
}
// Pure: renders a single pull-sprint-preview result row's HTML (checkbox,
// type badge, key, summary, and sprint/story-points meta line). Extracted
// from _renderPullSprintResults' row-building loop so the JIRA_TYPE_TO_LOCAL
// mapping and story-points conditional are unit-testable without a DOM.
export function buildPullSprintResultItemHtml(r) {
  const localType = JIRA_TYPE_TO_LOCAL[r.issuetype] || 'story';
  const typeBadge = `<span class="sprint-push-type sprint-push-type-${localType}">${escHtml(r.issuetype)}</span>`;
  const sp = r.storyPoints ? `${r.storyPoints} SP` : '';
  return `<label class="sprint-push-item">
      <input type="checkbox" checked value="${escHtml(r.key)}" data-sprint="${escHtml(r.sprintName)}" data-change-action="${ROADMAP_JIRA_SYNC_CHANGE_ACTIONS.pullSprintUpdateCount}" />
      <div class="sprint-push-item-info">
        <div class="sprint-push-item-title">${typeBadge} <strong>${escHtml(r.key)}</strong> ${escHtml(r.summary)}</div>
        <div class="sprint-push-item-meta">${escHtml(r.sprintName)} ${sp ? '· ' + sp : ''}</div>
      </div>
    </label>`;
}
function _renderPullSprintResults(results) {
  const container = document.getElementById('pull-sprint-results');
  let html = `<div class="sprint-push-results-header">
    <label><input type="checkbox" checked data-change-action="${ROADMAP_JIRA_SYNC_CHANGE_ACTIONS.pullSprintSelectAllItems}" /> Select all</label>
    <span>${results.length} new issue${results.length !== 1 ? 's' : ''} found</span>
  </div>`;
  for (const r of results) {
    html += buildPullSprintResultItemHtml(r);
  }
  container.innerHTML = html;
  document.getElementById('pull-sprint-actions').style.display = '';
  _pullSprintUpdateCount();
}
export function pullSprintSelectAllItems(checked) {
  document
    .querySelectorAll('#pull-sprint-results input[type="checkbox"]')
    .forEach((cb) => (cb.checked = checked));
  _pullSprintUpdateCount();
}
// Pure: confirm-button label for the pull-sprint selection count, extracted
// out of _pullSprintUpdateCount below. Mirrors formatSprintPushConfirmLabel
// above, but this button is never disabled based on selection count, so the
// return shape is just the text.
export function formatPullSprintConfirmLabel(checked, total) {
  return `Pull Selected (${checked}/${total})`;
}
export function _pullSprintUpdateCount() {
  const checked = document.querySelectorAll(
    '#pull-sprint-results input[type="checkbox"]:checked'
  ).length;
  const total = document.querySelectorAll('#pull-sprint-results input[type="checkbox"]').length;
  const btn = document.getElementById('pull-sprint-confirm');
  if (btn) btn.textContent = formatPullSprintConfirmLabel(checked, total);
}
// Pure: "Pulled N issue(s), N failed" summary text.
export function summarizePullSprintResult(results) {
  const ok = results.filter((r) => r.status === 'ok').length;
  const err = results.filter((r) => r.status === 'error').length;
  return `Pulled ${ok} issue${ok !== 1 ? 's' : ''}${err ? `, ${err} failed` : ''}`;
}
export async function confirmPullSprint() {
  const cbs = document.querySelectorAll('#pull-sprint-results input[type="checkbox"]:checked');
  const issues = [...cbs].map((cb) => ({ key: cb.value, sprintName: cb.dataset['sprint'] }));
  if (!issues.length) {
    showJiraToast('error', 'No issues selected');
    return;
  }
  const btn = document.getElementById('pull-sprint-confirm');
  btn.disabled = true;
  btn.textContent = 'Pulling…';
  try {
    const data = await postJSON('/api/jira/pull-sprint', { issues });
    showJiraToast('ok', summarizePullSprintResult(data.results || []));
    closePullSprintModal();
    loadDocs();
  } catch (e) {
    showJiraToast('error', 'Pull failed: ' + getErrorMessage(e));
    btn.disabled = false;
    _pullSprintUpdateCount();
  }
}
//# sourceMappingURL=roadmap-jira-sync.js.map
