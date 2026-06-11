// ── Roadmap View coordinator (Two-Panel: Epics + Stories) ──────
import { escHtml, postJSON, showJiraToast, patchJSON } from './state.js';
import { renderRoadmapBoard } from './roadmap-render.js';
import { _rankSortFn } from './list-render.js';
import { loadDocs } from './list.js';
import { clearRoadmapSelection } from './roadmap-select.js';

// _roadmapVisiblePis is in state.js as a _storeVar global
let _roadmapPanelState = { epics: true, stories: true }; // expanded/collapsed
let _roadmapFocusedEpic = null; // filename of clicked feature (focus mode)

// ── Open / Close ─────────────────────────────────────────────
export function openRoadmapView() {
  // Hide other views
  document.getElementById('list-view').style.display = 'none';
  document.getElementById('refine-view')?.classList.remove('show');
  document.getElementById('detail-view').classList.remove('show');
  document.querySelector('.right').classList.remove('has-selection');
  currentFilename = null;
  currentDocType = null;

  // Show roadmap
  document.getElementById('roadmap-view').classList.add('show');
  document.querySelector('.right').classList.add('roadmap-mode');

  // Populate PI filter checkboxes
  populateRoadmapPiFilter();

  // Reset focus, search and multi-selection
  _roadmapFocusedEpic = null;
  clearRoadmapSelection();
  const searchInput = document.getElementById('rm-epic-search');
  if (searchInput) searchInput.value = '';

  renderRoadmapBoard();
}

export function closeRoadmapView() {
  document.getElementById('roadmap-view').classList.remove('show');
  document.querySelector('.right').classList.remove('roadmap-mode');
  document.querySelector('.right').classList.remove('has-selection');
  document.getElementById('detail-view').classList.remove('show');
  currentFilename = null;
  currentDocType = null;
  document.getElementById('list-view').style.display = '';
  _roadmapVisiblePis.clear();
  _roadmapFocusedEpic = null;
  clearRoadmapSelection();
}

export function isRoadmapOpen() {
  return document.getElementById('roadmap-view').classList.contains('show');
}

export function refreshRoadmapView() {
  if (isRoadmapOpen()) renderRoadmapBoard();
}

// ── PI Filter (checkboxes) ───────────────────────────────────
function populateRoadmapPiFilter() {
  const container = document.getElementById('roadmap-pi-filter');
  if (!container) return;
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  // On first open, check all PIs
  if (!_roadmapVisiblePis.size) pis.forEach((p) => _roadmapVisiblePis.add(p));
  let html = '';
  for (const pi of pis) {
    const checked = _roadmapVisiblePis.has(pi) ? ' checked' : '';
    html += `<label class="rm-pi-checkbox"><input type="checkbox"${checked} onchange="toggleRoadmapPi('${escHtml(pi)}', this.checked)"><span>${escHtml(pi)}</span></label>`;
  }
  container.innerHTML = html;
}

export function toggleRoadmapPi(piName, checked) {
  if (checked) _roadmapVisiblePis.add(piName);
  else _roadmapVisiblePis.delete(piName);
  renderRoadmapBoard();
}

// ── Panel collapse ───────────────────────────────────────────
export function toggleRoadmapPanel(panel) {
  _roadmapPanelState[panel] = !_roadmapPanelState[panel];
  const body = document.getElementById(`rm-body-${panel}`);
  const chevron = document.getElementById(`rm-chevron-${panel}`);
  if (_roadmapPanelState[panel]) {
    body.classList.remove('collapsed');
    chevron.textContent = '▼';
  } else {
    body.classList.add('collapsed');
    chevron.textContent = '▶';
  }
}

// ── Epic search filter ──────────────────────────────────────
export function filterRoadmapEpics(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('.rm-epic-card').forEach((card) => {
    const title = (card.querySelector('.rm-epic-title')?.textContent || '').toLowerCase();
    card.style.display = !q || title.includes(q) ? '' : 'none';
  });
  // Update visible count
  const visible = document.querySelectorAll('.rm-epic-card:not([style*="display: none"])').length;
  document.getElementById('rm-count-epics').textContent = visible;
}

// ── Epic focus (click on epic card) ──────────────────────────
export function focusEpic(filename) {
  if (_roadmapFocusedEpic === filename) {
    _roadmapFocusedEpic = null; // toggle off
  } else {
    _roadmapFocusedEpic = filename;
  }
  applyEpicFocus();
}

export function applyEpicFocus() {
  // Epic panel: highlight focused epic
  document.querySelectorAll('.rm-epic-card').forEach((card) => {
    card.classList.toggle('rm-focused', card.dataset.filename === _roadmapFocusedEpic);
    card.classList.toggle(
      'rm-dimmed',
      _roadmapFocusedEpic && card.dataset.filename !== _roadmapFocusedEpic
    );
  });

  // Story panel: dim non-matching stories
  const focusNone = _roadmapFocusedEpic === '__none__';
  document.querySelectorAll('.roadmap-card').forEach((card) => {
    if (!_roadmapFocusedEpic) {
      card.classList.remove('rm-dimmed');
      return;
    }
    const parent = card.dataset.parent || '';
    const matches = focusNone ? parent === '' : parent === _roadmapFocusedEpic;
    card.classList.toggle('rm-dimmed', !matches);
  });
}

// ── Push Sprints to JIRA (modal-based) ──────────────────────
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

  document.getElementById('sprint-push-overlay').classList.add('show');
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
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.type === 'progress') {
            document.getElementById('sprint-push-progress-msg').textContent = payload.message;
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
          if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
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
    showSprintPushError('Failed to fetch preview: ' + e.message);
  }
}

export function closeSprintPushModal() {
  document.getElementById('sprint-push-overlay').classList.remove('show');
}

function showSprintPushError(msg) {
  document.getElementById('sprint-push-loading').classList.remove('show');
  document.getElementById('sprint-push-select-step').style.display = 'none';
  const el = document.getElementById('sprint-push-error');
  el.textContent = msg;
  el.classList.add('show');
}

function renderSprintPushPreview(preview) {
  document.getElementById('sprint-push-loading').classList.remove('show');

  // Filter out items where the sprint hasn't actually changed (client-side safety net)
  const allChanges = preview.changes || [];
  const changes = allChanges.filter((c) => {
    if (c.changeType === 'change' && c.targetSprint && c.currentJiraSprint) {
      return c.targetSprint.toLowerCase().trim() !== c.currentJiraSprint.toLowerCase().trim();
    }
    return ['add', 'change', 'pull'].includes(c.changeType);
  });

  if (!changes.length) {
    document.getElementById('sprint-push-empty').classList.add('show');
    document.getElementById('sprint-push-stats').textContent = 'All in sync';
    return;
  }

  // Show filters and actions
  document.getElementById('sprint-push-filters').style.display = 'flex';
  document.getElementById('sprint-push-actions').style.display = 'flex';

  // Recompute counts from filtered set
  const adds = changes.filter((c) => c.changeType === 'add').length;
  const changesCount = changes.filter((c) => c.changeType === 'change').length;
  const pulls = changes.filter((c) => c.changeType === 'pull').length;

  // Update pill counts
  document.getElementById('sprint-push-count-add').textContent = adds;
  document.getElementById('sprint-push-count-change').textContent = changesCount;
  document.getElementById('sprint-push-count-pull').textContent = pulls;

  // Stats summary
  document.getElementById('sprint-push-stats').textContent =
    `${changes.length} change${changes.length !== 1 ? 's' : ''} found`;

  // Render rows
  const list = document.getElementById('sprint-push-list');
  list.innerHTML = '';

  for (const c of changes) {
    const row = document.createElement('label');
    row.className = 'sprint-push-item';
    row.dataset.type = c.changeType;

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

function _escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
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
    const type = item.dataset.type;
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

export function _sprintPushUpdateCount() {
  const all = document.querySelectorAll('.sprint-push-item input[type="checkbox"]');
  const checked = [...all].filter((cb) => cb.checked).length;
  const btn = document.getElementById('sprint-push-confirm');
  btn.textContent = `Sync Changes (${checked}/${all.length})`;
  btn.disabled = checked === 0;
}

export async function confirmSprintPush() {
  const checkboxes = document.querySelectorAll('.sprint-push-item input[type="checkbox"]:checked');
  if (!checkboxes.length) return;

  const btn = document.getElementById('sprint-push-confirm');
  btn.disabled = true;
  btn.textContent = 'Syncing…';

  const items = [...checkboxes].map((cb) => ({
    filename: cb.dataset.filename,
    sprint: cb.dataset.targetSprint,
    changeType: cb.dataset.changeType,
    jiraId: cb.dataset.jiraId,
    docType: cb.dataset.docType || '',
  }));

  try {
    const res = await postJSON('/api/jira/push-sprints', { items });
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
    showJiraToast('error', 'Failed to push sprints: ' + e.message);
    btn.disabled = false;
    _sprintPushUpdateCount();
  }
}

// ── Gather all sprints across visible PIs ────────────────────
export function getAllSprints() {
  const all = [];
  const seen = new Set();
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  for (const pi of pis) {
    if (!_roadmapVisiblePis.has(pi)) continue; // skip unchecked PIs
    for (const s of sprintConfig[pi] || []) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        all.push(s);
      }
    }
  }
  return all;
}

// ── Pull from JIRA Sprints ───────────────────────────────────

const JIRA_TYPE_TO_LOCAL = { 'New Feature': 'feature', Epic: 'epic', Story: 'story', Improvement: 'story', Task: 'spike', Bug: 'bug' };

export function pullFromJiraSprints() {
  const overlay = document.getElementById('pull-sprint-overlay');
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
  overlay.classList.add('show');
}

export function closePullSprintModal() {
  document.getElementById('pull-sprint-overlay').classList.remove('show');
}

export function pullSprintToggleAll(checked) {
  document.querySelectorAll('#pull-sprint-list input[type="checkbox"]').forEach(cb => cb.checked = checked);
}

export async function startPullSprintPreview() {
  const cbs = document.querySelectorAll('#pull-sprint-list input[type="checkbox"]:checked');
  const selectedSprints = [...cbs].map(cb => cb.value);
  if (!selectedSprints.length) { showJiraToast('error', 'Select at least one sprint'); return; }

  document.getElementById('pull-sprint-select-step').style.display = 'none';
  document.getElementById('pull-sprint-loading').style.display = '';
  document.getElementById('pull-sprint-error').style.display = 'none';
  document.getElementById('pull-sprint-empty').style.display = 'none';
  document.getElementById('pull-sprint-results').innerHTML = '';
  document.getElementById('pull-sprint-actions').style.display = 'none';

  try {
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
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const msg = JSON.parse(line.slice(6));
        if (msg.type === 'progress') {
          document.getElementById('pull-sprint-progress-msg').textContent = msg.message;
        } else if (msg.type === 'error') {
          document.getElementById('pull-sprint-loading').style.display = 'none';
          document.getElementById('pull-sprint-error').style.display = '';
          document.getElementById('pull-sprint-error').textContent = msg.message;
          return;
        } else if (msg.type === 'done') {
          result = msg.results;
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
    document.getElementById('pull-sprint-error').textContent = e.message;
  }
}

function _renderPullSprintResults(results) {
  const container = document.getElementById('pull-sprint-results');
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
  document.getElementById('pull-sprint-actions').style.display = '';
  _pullSprintUpdateCount();
}

export function pullSprintSelectAllItems(checked) {
  document.querySelectorAll('#pull-sprint-results input[type="checkbox"]').forEach(cb => cb.checked = checked);
  _pullSprintUpdateCount();
}

export function _pullSprintUpdateCount() {
  const checked = document.querySelectorAll('#pull-sprint-results input[type="checkbox"]:checked').length;
  const total = document.querySelectorAll('#pull-sprint-results input[type="checkbox"]').length;
  const btn = document.getElementById('pull-sprint-confirm');
  if (btn) btn.textContent = `Pull Selected (${checked}/${total})`;
}

export async function confirmPullSprint() {
  const cbs = document.querySelectorAll('#pull-sprint-results input[type="checkbox"]:checked');
  const issues = [...cbs].map(cb => ({ key: cb.value, sprintName: cb.dataset.sprint }));
  if (!issues.length) { showJiraToast('error', 'No issues selected'); return; }

  const btn = document.getElementById('pull-sprint-confirm');
  btn.disabled = true;
  btn.textContent = 'Pulling…';

  try {
    const res = await fetch('/api/jira/pull-sprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issues }),
    });
    const data = await res.json();
    const ok = data.results?.filter(r => r.status === 'ok').length || 0;
    const err = data.results?.filter(r => r.status === 'error').length || 0;
    showJiraToast('ok', `Pulled ${ok} issue${ok !== 1 ? 's' : ''}${err ? `, ${err} failed` : ''}`);
    closePullSprintModal();
    loadDocs();
  } catch (e) {
    showJiraToast('error', 'Pull failed: ' + e.message);
    btn.disabled = false;
    _pullSprintUpdateCount();
  }
}

// ── Dependency modal ─────────────────────────────────────────
let _depModalFilename = null;
let _depModalDocType = null;

export async function openDepModal(filename, docType) {
  _depModalFilename = filename;
  _depModalDocType = docType;

  const doc = allDocs.find((d) => d.filename === filename);
  document.getElementById('dep-modal-subtitle').textContent = doc?.title || filename;

  // Reset state
  document.getElementById('dep-blocks-list').innerHTML = '<div class="dep-loading">Loading…</div>';
  document.getElementById('dep-blockedby-list').innerHTML = '';

  document.getElementById('dep-overlay').classList.add('show');

  try {
    const data = await fetch(
      `/api/links/${encodeURIComponent(docType)}/${encodeURIComponent(filename)}`
    ).then((r) => r.json());
    renderDepLists(data);
    populateDepTargetSelect(filename, data);
  } catch (e) {
    document.getElementById('dep-blocks-list').innerHTML =
      `<div class="dep-error">${escHtml(e.message)}</div>`;
  }
}

function renderDepLists(data) {
  function depItemHtml(item, direction) {
    return `
      <div class="dep-item">
        <span class="dep-item-title">${escHtml(item.title || item.filename)}</span>
        <button class="btn-ghost btn-xs dep-remove-btn"
                onclick="removeDepLink('${escHtml(item.filename)}','${escHtml(item.docType || _depModalDocType)}','${direction}')"
                title="Remove">&times;</button>
      </div>`;
  }

  const blocksList = document.getElementById('dep-blocks-list');
  const blockedByList = document.getElementById('dep-blockedby-list');

  blocksList.innerHTML = (data.blocks || []).length
    ? (data.blocks || []).map((item) => depItemHtml(item, 'blocks')).join('')
    : '<div class="dep-empty">None</div>';

  blockedByList.innerHTML = (data.blockedBy || []).length
    ? (data.blockedBy || []).map((item) => depItemHtml(item, 'blockedBy')).join('')
    : '<div class="dep-empty">None</div>';

  const parallelList = document.getElementById('dep-parallel-list');
  if (parallelList) {
    parallelList.innerHTML = (data.parallel || []).length
      ? (data.parallel || []).map((item) => depItemHtml(item, 'parallel')).join('')
      : '<div class="dep-empty">None</div>';
  }
}

function populateDepTargetSelect(excludeFilename, currentData) {
  const leafTypes = new Set(['story', 'spike', 'bug']);
  const alreadyBlocks = new Set((currentData.blocks || []).map((b) => b.filename));
  const alreadyParallel = new Set((currentData.parallel || []).map((p) => p.filename));
  alreadyBlocks.add(excludeFilename);
  alreadyParallel.add(excludeFilename);

  const allCandidates = allDocs
    .filter((d) => leafTypes.has(d.docType))
    .sort((a, b) => (a.title || a.filename).localeCompare(b.title || b.filename));

  const blockCandidates = allCandidates.filter((d) => !alreadyBlocks.has(d.filename));
  const parallelCandidates = allCandidates.filter((d) => !alreadyParallel.has(d.filename));

  const select = document.getElementById('dep-target-select');
  if (select) {
    select.innerHTML = blockCandidates.length
      ? blockCandidates
          .map(
            (d) =>
              `<option value="${escHtml(d.filename)}" data-doctype="${d.docType}">${escHtml(d.title || d.filename)}</option>`
          )
          .join('')
      : '<option value="" disabled>No candidates</option>';
  }

  const parallelSelect = document.getElementById('dep-parallel-select');
  if (parallelSelect) {
    parallelSelect.innerHTML = parallelCandidates.length
      ? parallelCandidates
          .map(
            (d) =>
              `<option value="${escHtml(d.filename)}" data-doctype="${d.docType}">${escHtml(d.title || d.filename)}</option>`
          )
          .join('')
      : '<option value="" disabled>No candidates</option>';
  }
}

export async function addDepLink() {
  const select = document.getElementById('dep-target-select');
  const targetFilename = select.value;
  if (!targetFilename) return;
  const targetDocType = select.selectedOptions[0]?.dataset.doctype || 'story';

  try {
    await postJSON('/api/link', {
      linkType: 'blocks',
      sourceType: _depModalDocType,
      sourceFilename: _depModalFilename,
      targetType: targetDocType,
      targetFilename,
    });
    // Refresh modal
    const data = await fetch(
      `/api/links/${encodeURIComponent(_depModalDocType)}/${encodeURIComponent(_depModalFilename)}`
    ).then((r) => r.json());
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename, data);
    // Update allDocs entry
    const srcDoc = allDocs.find((d) => d.filename === _depModalFilename);
    if (srcDoc) {
      srcDoc.blocks = srcDoc.blocks || [];
      if (!srcDoc.blocks.includes(targetFilename)) srcDoc.blocks.push(targetFilename);
    }
    const tgtDoc = allDocs.find((d) => d.filename === targetFilename);
    if (tgtDoc) {
      tgtDoc.blockedBy = tgtDoc.blockedBy || [];
      if (!tgtDoc.blockedBy.includes(_depModalFilename)) tgtDoc.blockedBy.push(_depModalFilename);
    }
    renderRoadmapBoard();
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

export async function addParallelLink() {
  const select = document.getElementById('dep-parallel-select');
  if (!select) return;
  const targetFilename = select.value;
  if (!targetFilename) return;
  const targetDocType = select.selectedOptions[0]?.dataset.doctype || 'story';

  try {
    await postJSON('/api/link', {
      linkType: 'parallel',
      sourceType: _depModalDocType,
      sourceFilename: _depModalFilename,
      targetType: targetDocType,
      targetFilename,
    });
    const data = await fetch(
      `/api/links/${encodeURIComponent(_depModalDocType)}/${encodeURIComponent(_depModalFilename)}`
    ).then((r) => r.json());
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename, data);
    renderRoadmapBoard();
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

export async function removeDepLink(targetFilename, targetDocType, direction) {
  try {
    let srcFilename, srcDocType, tgtFilename, tgtDocType, linkType;
    if (direction === 'parallel') {
      linkType = 'parallel';
      srcFilename = _depModalFilename;
      srcDocType = _depModalDocType;
      tgtFilename = targetFilename;
      tgtDocType = targetDocType;
    } else if (direction === 'blocks') {
      linkType = 'blocks';
      srcFilename = _depModalFilename;
      srcDocType = _depModalDocType;
      tgtFilename = targetFilename;
      tgtDocType = targetDocType;
    } else {
      linkType = 'blocks';
      srcFilename = targetFilename;
      srcDocType = targetDocType;
      tgtFilename = _depModalFilename;
      tgtDocType = _depModalDocType;
    }
    await fetch('/api/link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkType,
        sourceType: srcDocType,
        sourceFilename: srcFilename,
        targetType: tgtDocType,
        targetFilename: tgtFilename,
      }),
    });
    // Refresh modal
    const data = await fetch(
      `/api/links/${encodeURIComponent(_depModalDocType)}/${encodeURIComponent(_depModalFilename)}`
    ).then((r) => r.json());
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename, data);
    // Update allDocs entries
    const srcDoc = allDocs.find((d) => d.filename === srcFilename);
    if (srcDoc) srcDoc.blocks = (srcDoc.blocks || []).filter((f) => f !== tgtFilename);
    const tgtDoc = allDocs.find((d) => d.filename === tgtFilename);
    if (tgtDoc) tgtDoc.blockedBy = (tgtDoc.blockedBy || []).filter((f) => f !== srcFilename);
    renderRoadmapBoard();
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

export function closeDepModal() {
  document.getElementById('dep-overlay').classList.remove('show');
  _depModalFilename = null;
  _depModalDocType = null;
}

// ── Split modal (kept from old roadmap) ──────────────────────
let _splitModalFilename = null;
let _splitModalDocType = null;
let _splitModalSprint1 = null;
let _splitModalSprint2 = null;

export function openSplitModal(filename, docType, sprint1, sprint2) {
  _splitModalFilename = filename;
  _splitModalDocType = docType;
  _splitModalSprint1 = sprint1 || null;
  _splitModalSprint2 = sprint2 || null;

  const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
  const sp = Number(doc?.storyPoints) || 0;
  const sprints = getAllSprints();

  const sprintOptions = sprints
    .map((s) => `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`)
    .join('');

  const sel1 = sprint1
    ? `<option value="${escHtml(sprint1)}" selected>${escHtml(sprint1)}</option>${sprintOptions}`
    : sprintOptions;
  const sel2 = sprint2
    ? `<option value="${escHtml(sprint2)}" selected>${escHtml(sprint2)}</option>${sprintOptions}`
    : sprintOptions;

  document.getElementById('split-modal-title').textContent = doc?.title || filename;
  document.getElementById('split-modal-sp').textContent = sp
    ? `${sp} SP → ~${Math.round(sp / 2)} SP each`
    : 'No SP estimate';
  document.getElementById('split-sprint-1').innerHTML = sel1;
  document.getElementById('split-sprint-2').innerHTML = sel2;
  document.getElementById('split-modal-output').innerHTML = '';
  document.getElementById('split-modal-status').className = 'split-modal-status';

  const applyBtn = document.getElementById('split-apply-btn');
  applyBtn.disabled = false;
  applyBtn.textContent = 'Split with AI';

  document.getElementById('split-overlay').classList.add('show');
}

export function closeSplitModal() {
  document.getElementById('split-overlay').classList.remove('show');
  _splitModalFilename = null;
  _splitModalDocType = null;
}

export async function executeSplit() {
  if (!_splitModalFilename) return;

  const sprint1 = document.getElementById('split-sprint-1').value;
  const sprint2 = document.getElementById('split-sprint-2').value;
  const btn = document.getElementById('split-apply-btn');
  const output = document.getElementById('split-modal-output');
  const status = document.getElementById('split-modal-status');

  btn.disabled = true;
  btn.textContent = 'Splitting…';
  output.textContent = '';
  status.className = 'split-modal-status';

  try {
    const res = await fetch('/api/docs/split-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: _splitModalFilename,
        docType: _splitModalDocType,
        targetCount: 2,
        sprints: [sprint1, sprint2].filter(Boolean),
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    let result = null;

    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.error) throw new Error(payload.error.message || 'Split failed');
          if (payload.text) output.textContent += payload.text;
          if (payload.done) {
            result = payload;
            done = true;
          }
        } catch (parseErr) {
          if (parseErr.message !== 'Split failed') continue;
          throw parseErr;
        }
      }
    }

    if (result) {
      status.className = 'split-modal-status show success';
      status.textContent = `Created ${result.files.length} stories. Original deleted.`;
      btn.textContent = 'Done';
      setTimeout(() => closeSplitModal(), 2000);
    }
  } catch (err) {
    status.className = 'split-modal-status show error';
    status.textContent = err.message || 'Split failed';
    btn.disabled = false;
    btn.textContent = 'Retry';
  }
}

// ── Roadmap context menus ─────────────────────────────────────

function _closeRoadmapCtx() {
  const el = document.getElementById('rm-context-menu');
  if (el) el.remove();
  document.removeEventListener('mousedown', _rmCtxDismiss);
  document.removeEventListener('contextmenu', _rmCtxDismiss);
}

function _rmCtxDismiss(e) {
  const menu = document.getElementById('rm-context-menu');
  if (menu && !menu.contains(e.target)) _closeRoadmapCtx();
}

function _showRoadmapCtx(x, y, html) {
  _closeRoadmapCtx();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'rm-context-menu';
  menu.innerHTML = html;
  document.body.appendChild(menu);

  // Position — keep on-screen
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', _rmCtxDismiss);
    document.addEventListener('contextmenu', _rmCtxDismiss);
  }, 0);
}

// ── Epic context menu (top panel) ────────────────────────────
export function handleEpicContextMenu(e, filename, docType) {
  e.preventDefault();
  e.stopPropagation();

  const doc = allDocs.find((d) => d.filename === filename);
  const title = doc?.title || filename;
  const shortTitle = title.length > 40 ? title.substring(0, 37) + '…' : title;

  const html = `
    <div class="ctx-header">${escHtml(shortTitle)}</div>
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick="rmCtxOpenEpic('${escHtml(filename)}','${escHtml(docType)}')">Open Epic</button>
    ${_buildSprintSubmenu(filename, docType)}
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick="rmCtxMoveEpic('${escHtml(filename)}','${escHtml(docType)}','up')">Move up</button>
    <button class="ctx-item" onclick="rmCtxMoveEpic('${escHtml(filename)}','${escHtml(docType)}','down')">Move down</button>
    <button class="ctx-item" onclick="rmCtxMoveEpic('${escHtml(filename)}','${escHtml(docType)}','top')">Move to the top</button>
    <button class="ctx-item" onclick="rmCtxMoveEpic('${escHtml(filename)}','${escHtml(docType)}','bottom')">Move to the bottom</button>
  `;
  _showRoadmapCtx(e.clientX, e.clientY, html);
}

export function rmCtxOpenEpic(filename, docType) {
  _closeRoadmapCtx();
  openDoc(filename, docType);
}

export async function rmCtxMoveEpic(filename, docType, direction) {
  _closeRoadmapCtx();

  // Get the visible epic cards in current order (respects search filter)
  const cards = [...document.querySelectorAll('.rm-epic-card:not([style*="display: none"])')];
  const filenames = cards.map((c) => c.dataset.filename).filter(Boolean);
  const idx = filenames.indexOf(filename);
  if (idx < 0) return;

  // Build the full ordered list of this docType for rerank
  const group = allDocs.filter((d) => d.docType === docType);
  const sorted = [...group].sort(_rankSortFn);
  const srcIdx = sorted.findIndex((d) => d.filename === filename);
  if (srcIdx < 0) return;

  const [item] = sorted.splice(srcIdx, 1);

  let targetIdx;
  if (direction === 'up') {
    // Move before the previous visible item in the full sorted list
    const prevFn = filenames[idx - 1];
    if (!prevFn) return;
    targetIdx = sorted.findIndex((d) => d.filename === prevFn);
    if (targetIdx < 0) return;
  } else if (direction === 'down') {
    const nextFn = filenames[idx + 1];
    if (!nextFn) return;
    targetIdx = sorted.findIndex((d) => d.filename === nextFn) + 1;
    if (targetIdx <= 0) return;
  } else if (direction === 'top') {
    // Move to the top position — before the first visible item
    const firstFn = filenames[0];
    targetIdx = firstFn ? sorted.findIndex((d) => d.filename === firstFn) : 0;
    if (targetIdx < 0) targetIdx = 0;
  } else {
    // bottom — after the last visible item
    const lastFn = filenames[filenames.length - 1];
    targetIdx = lastFn ? sorted.findIndex((d) => d.filename === lastFn) + 1 : sorted.length;
    if (targetIdx < 0) targetIdx = sorted.length;
  }

  sorted.splice(targetIdx, 0, item);

  try {
    await postJSON('/api/docs/rerank', {
      type: docType,
      orderedFilenames: sorted.map((d) => d.filename),
    });
    await loadDocs();
    refreshRoadmapView();
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

// ── Sprint submenu builder ───────────────────────────────────
function _buildSprintSubmenu(filename, docType) {
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  const seen = new Set();
  let items = '';

  for (const pi of pis) {
    for (const s of sprintConfig[pi] || []) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      items += `<button class="ctx-item" onclick="rmCtxSetSprint('${escHtml(filename)}','${escHtml(docType)}','${escHtml(s.name)}')">${escHtml(s.name)}</button>`;
    }
  }

  if (!items) return '';

  items += `<div class="ctx-separator"></div>`;
  items += `<button class="ctx-item ctx-danger" onclick="rmCtxSetSprint('${escHtml(filename)}','${escHtml(docType)}','')">Remove from sprint</button>`;

  return `
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Add to Sprint ▸</button>
      <div class="ctx-submenu">${items}</div>
    </div>`;
}

// ── Story context menu (bottom panel) ────────────────────────
export function handleStoryContextMenu(e, filename, docType) {
  e.preventDefault();
  e.stopPropagation();

  const doc = allDocs.find((d) => d.filename === filename);
  const title = doc?.title || filename;
  const shortTitle = title.length > 40 ? title.substring(0, 37) + '…' : title;

  const html = `
    <div class="ctx-header">${escHtml(shortTitle)}</div>
    <div class="ctx-separator"></div>
    ${_buildSprintSubmenu(filename, docType)}
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick="rmCtxMoveStory('${escHtml(filename)}','${escHtml(docType)}','up')">Move up</button>
    <button class="ctx-item" onclick="rmCtxMoveStory('${escHtml(filename)}','${escHtml(docType)}','down')">Move down</button>
    <button class="ctx-item" onclick="rmCtxMoveStory('${escHtml(filename)}','${escHtml(docType)}','top')">Move to the top</button>
    <button class="ctx-item" onclick="rmCtxMoveStory('${escHtml(filename)}','${escHtml(docType)}','bottom')">Move to the bottom</button>
  `;
  _showRoadmapCtx(e.clientX, e.clientY, html);
}

export async function rmCtxMoveStory(filename, docType, direction) {
  _closeRoadmapCtx();

  // Find the card and its sprint column
  const card = document.querySelector(`.roadmap-card[data-filename="${CSS.escape(filename)}"]`);
  if (!card) return;
  const column = card.closest('.roadmap-card-list');
  if (!column) return;

  // Get the ordered filenames in this column
  const cards = [...column.querySelectorAll('.roadmap-card')];
  const filenames = cards.map((c) => c.dataset.filename);
  const idx = filenames.indexOf(filename);
  if (idx < 0) return;

  // Build the full sorted list for this docType
  const group = allDocs.filter((d) => d.docType === docType);
  const sorted = [...group].sort(_rankSortFn);
  const srcIdx = sorted.findIndex((d) => d.filename === filename);
  if (srcIdx < 0) return;

  const [item] = sorted.splice(srcIdx, 1);

  let targetIdx;
  if (direction === 'up') {
    const prevFn = filenames[idx - 1];
    if (!prevFn) return;
    targetIdx = sorted.findIndex((d) => d.filename === prevFn);
    if (targetIdx < 0) return;
  } else if (direction === 'down') {
    const nextFn = filenames[idx + 1];
    if (!nextFn) return;
    targetIdx = sorted.findIndex((d) => d.filename === nextFn) + 1;
    if (targetIdx <= 0) return;
  } else if (direction === 'top') {
    const firstFn = filenames[0];
    targetIdx = firstFn ? sorted.findIndex((d) => d.filename === firstFn) : 0;
    if (targetIdx < 0) targetIdx = 0;
  } else {
    const lastFn = filenames[filenames.length - 1];
    targetIdx = lastFn ? sorted.findIndex((d) => d.filename === lastFn) + 1 : sorted.length;
    if (targetIdx < 0) targetIdx = sorted.length;
  }

  sorted.splice(targetIdx, 0, item);

  try {
    await postJSON('/api/docs/rerank', {
      type: docType,
      orderedFilenames: sorted.map((d) => d.filename),
    });
    await loadDocs();
    refreshRoadmapView();
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

// ── Set sprint from context menu ────────────────────────────
export async function rmCtxSetSprint(filename, docType, sprintName) {
  _closeRoadmapCtx();

  try {
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, {
      sprint: sprintName || null,
    });
    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    if (doc) doc.sprint = sprintName || null;
    renderRoadmapBoard();
    showJiraToast('success', sprintName ? `Moved to ${sprintName}` : 'Removed from sprint');
  } catch (e) {
    showJiraToast('error', e.message);
  }
}
