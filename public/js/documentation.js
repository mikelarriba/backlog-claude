// ── Documentation panel: JIRA issue filter & selector ───────────────────────
// Lets the user search/filter JIRA issues (free text, fix version, issue type),
// multi-select from a paginated results list, then hand the selection off to
// an "Ask AI" action, which POSTs to /api/confluence/analyze (see #371) and
// renders the returned suggestions (see the "AI Analysis Results" section
// below, #372).
import { fetchJSON, postJSON, showJiraToast } from './state.js';
import { logAiSaving } from './ai-savings.js';
const PAGE_SIZE = 20;
let _allIssues = [];
const _selectedKeys = new Set();
let _searchText = '';
let _typeFilter = 'all';
let _fixVersionFilter = '';
let _versions = [];
let _versionsLoaded = false;
let _currentPage = 1;
let _searchSeq = 0;
let _mode = 'sprint'; // 'sprint' | 'fixversion' | 'search'
let _sprintFilter = '';
let _sprints = [];
let _sprintsLoaded = false;
// ── Init ─────────────────────────────────────────────────────────────────────
export async function loadDocumentationView() {
  await Promise.all([
    _versionsLoaded ? null : loadDocVersions(),
    _sprintsLoaded ? null : loadDocSprints(),
  ]);
  const listEl = document.getElementById('doc-issues-list');
  const placeholderEl = document.getElementById('doc-placeholder');
  if (listEl) listEl.innerHTML = '';
  if (placeholderEl) placeholderEl.style.display = '';
}
async function loadDocVersions() {
  const select = document.getElementById('doc-filter-version');
  try {
    const data = await fetchJSON('/api/jira/versions');
    _versions = data.versions || [];
    _versionsLoaded = true;
  } catch {
    _versions = [];
  }
  if (select) {
    const current = select.value;
    select.innerHTML =
      '<option value="">Select a fix version…</option>' +
      _versions.map((v) => `<option value="${_esc(v.name)}">${_esc(v.name)}</option>`).join('');
    select.value = current;
  }
}
async function loadDocSprints() {
  const select = document.getElementById('doc-sprint-select');
  try {
    const data = await fetchJSON('/api/jira/board-sprints');
    _sprints = data.sprints || [];
    _sprintsLoaded = true;
  } catch {
    _sprints = [];
  }
  if (select) {
    select.innerHTML =
      '<option value="">Select a sprint…</option>' +
      _sprints.map((s) => `<option value="${_esc(s.name)}">${_esc(s.name)}</option>`).join('');
  }
}
// ── Mode switcher ─────────────────────────────────────────────────────────────
export function setDocMode(mode) {
  if (_mode === mode) return;
  if (
    _selectedKeys.size > 0 &&
    !confirm('Switching mode will clear your current selection. Continue?')
  ) {
    return;
  }
  _mode = mode;
  document.querySelectorAll('.doc-mode-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.mode === mode);
  });
  document.querySelectorAll('.doc-mode-panel').forEach((el) => {
    el.classList.toggle('active', el.id === `doc-mode-${mode}`);
  });
  // Reset all filter state
  _selectedKeys.clear();
  _allIssues = [];
  _currentPage = 1;
  _sprintFilter = '';
  _fixVersionFilter = '';
  _searchText = '';
  const listEl = document.getElementById('doc-issues-list');
  const placeholderEl = document.getElementById('doc-placeholder');
  const pagerEl = document.getElementById('doc-pagination');
  const errorEl = document.getElementById('doc-error-banner');
  if (listEl) listEl.innerHTML = '';
  if (placeholderEl) placeholderEl.style.display = '';
  if (pagerEl) pagerEl.innerHTML = '';
  if (errorEl) errorEl.style.display = 'none';
  const sprintSel = document.getElementById('doc-sprint-select');
  if (sprintSel) sprintSel.value = '';
  const versionSel = document.getElementById('doc-filter-version');
  if (versionSel) versionSel.value = '';
  const textInput = document.getElementById('doc-filter-text');
  if (textInput) textInput.value = '';
  _updateSelectionCount();
}
// ── Bulk-select loaders (sprint / fix version modes) ─────────────────────────
export async function docSetSprint(sprintName) {
  _sprintFilter = sprintName;
  if (!sprintName) return;
  await _loadAndPreselectAll({ sprint: sprintName });
}
export async function docSetFixVersionBulk(fixVersion) {
  _fixVersionFilter = fixVersion;
  if (!fixVersion) return;
  await _loadAndPreselectAll({ fixVersion });
}
async function _loadAndPreselectAll(extraParams) {
  const seq = ++_searchSeq;
  const loadingEl = document.getElementById('doc-loading');
  const errorEl = document.getElementById('doc-error-banner');
  const listEl = document.getElementById('doc-issues-list');
  const placeholderEl = document.getElementById('doc-placeholder');
  if (loadingEl) loadingEl.style.display = '';
  if (errorEl) errorEl.style.display = 'none';
  if (listEl) listEl.innerHTML = '';
  if (placeholderEl) placeholderEl.style.display = 'none';
  _selectedKeys.clear();
  try {
    const params = new URLSearchParams({ type: 'all', ...extraParams });
    const data = await fetchJSON(`/api/jira/search?${params}`);
    if (seq !== _searchSeq) return;
    _allIssues = data.issues || [];
    _currentPage = 1;
    _allIssues.forEach((issue) => _selectedKeys.add(issue.key));
    renderIssuesList(_allIssues);
  } catch (err) {
    if (seq !== _searchSeq) return;
    _showDocError(err);
  } finally {
    if (seq === _searchSeq && loadingEl) loadingEl.style.display = 'none';
  }
}
// ── Search ───────────────────────────────────────────────────────────────────
export function docFilterInput(value) {
  _searchText = value;
}
export function docSearch() {
  void searchDocumentationIssues();
}
export function docSetTypeFilter(type) {
  if (_typeFilter === type) return;
  _typeFilter = type;
  document.querySelectorAll('.doc-chip').forEach((el) => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  void searchDocumentationIssues();
}
export function docSetFixVersion(value) {
  _fixVersionFilter = value;
  void searchDocumentationIssues();
}
export async function searchDocumentationIssues() {
  const seq = ++_searchSeq;
  const loadingEl = document.getElementById('doc-loading');
  const errorEl = document.getElementById('doc-error-banner');
  const listEl = document.getElementById('doc-issues-list');
  const placeholderEl = document.getElementById('doc-placeholder');
  if (loadingEl) loadingEl.style.display = '';
  if (errorEl) errorEl.style.display = 'none';
  if (listEl) listEl.innerHTML = '';
  if (placeholderEl) placeholderEl.style.display = 'none';
  try {
    const params = new URLSearchParams({ type: _typeFilter });
    if (_searchText.trim()) params.set('text', _searchText.trim());
    if (_fixVersionFilter) params.set('fixVersion', _fixVersionFilter);
    const data = await fetchJSON(`/api/jira/search?${params}`);
    // A slower, earlier request could resolve after a newer one — ignore it.
    if (seq !== _searchSeq) return;
    _allIssues = data.issues || [];
    _currentPage = 1;
    renderIssuesList(_allIssues);
  } catch (err) {
    if (seq !== _searchSeq) return;
    _showDocError(err);
  } finally {
    if (seq === _searchSeq && loadingEl) loadingEl.style.display = 'none';
  }
}
// ── Rendering ────────────────────────────────────────────────────────────────
export function renderIssuesList(issues) {
  const listEl = document.getElementById('doc-issues-list');
  const pagerEl = document.getElementById('doc-pagination');
  if (!listEl) return;
  if (!issues.length) {
    listEl.innerHTML = '<p class="doc-empty">No JIRA issues match the current filters.</p>';
    if (pagerEl) pagerEl.innerHTML = '';
    _updateSelectionCount();
    return;
  }
  const totalPages = Math.max(1, Math.ceil(issues.length / PAGE_SIZE));
  _currentPage = Math.min(Math.max(1, _currentPage), totalPages);
  const start = (_currentPage - 1) * PAGE_SIZE;
  const pageItems = issues.slice(start, start + PAGE_SIZE);
  listEl.innerHTML = pageItems
    .map((issue) => {
      const checked = _selectedKeys.has(issue.key) ? 'checked' : '';
      const selected = _selectedKeys.has(issue.key) ? 'selected' : '';
      const typeClass = `doc-type-${(issue.issuetype || '').toLowerCase().replace(/\s+/g, '-')}`;
      const statusClass = `doc-status-${(issue.status || '').toLowerCase().replace(/\s+/g, '-')}`;
      return `<div class="doc-issue-row ${selected}" data-key="${_esc(issue.key)}" onclick="docRowClick(event,'${_esc(issue.key)}')">
        <input type="checkbox" ${checked} onchange="docToggleKey('${_esc(issue.key)}',this.checked)" onclick="event.stopPropagation()" />
        <div class="doc-issue-body">
          <div class="doc-issue-top">
            <span class="doc-issue-key">${_esc(issue.key)}</span>
            <span class="doc-type-badge ${typeClass}">${_esc(issue.issuetype)}</span>
            <span class="doc-status-badge ${statusClass}">${_esc(issue.status)}</span>
            ${issue.localExists ? '<span class="doc-local-badge" title="Already imported locally">✓ Local</span>' : ''}
          </div>
          <div class="doc-issue-title" title="${_esc(issue.summary)}">${_esc(issue.summary)}</div>
        </div>
      </div>`;
    })
    .join('');
  if (pagerEl) {
    pagerEl.innerHTML =
      totalPages > 1
        ? `<button class="btn-ghost btn-xs" ${_currentPage <= 1 ? 'disabled' : ''} onclick="docSetPage(${_currentPage - 1})">‹ Prev</button>
           <span class="doc-page-info">Page ${_currentPage} of ${totalPages} (${issues.length} issues)</span>
           <button class="btn-ghost btn-xs" ${_currentPage >= totalPages ? 'disabled' : ''} onclick="docSetPage(${_currentPage + 1})">Next ›</button>`
        : `<span class="doc-page-info">${issues.length} issue${issues.length === 1 ? '' : 's'}</span>`;
  }
  _updateSelectionCount();
}
export function docSetPage(page) {
  _currentPage = page;
  renderIssuesList(_allIssues);
}
// ── Selection ────────────────────────────────────────────────────────────────
export function docRowClick(event, key) {
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.closest('input'))) return;
  const row = document.querySelector(`.doc-issue-row[data-key="${CSS.escape(key)}"]`);
  const cb = row?.querySelector('input[type=checkbox]');
  if (cb) {
    cb.checked = !cb.checked;
    docToggleKey(key, cb.checked);
  }
}
export function docToggleKey(key, checked) {
  if (checked) _selectedKeys.add(key);
  else _selectedKeys.delete(key);
  const row = document.querySelector(`.doc-issue-row[data-key="${CSS.escape(key)}"]`);
  if (row) row.classList.toggle('selected', checked);
  _updateSelectionCount();
}
function _updateSelectionCount() {
  const countEl = document.getElementById('doc-selection-count');
  const askBtn = document.getElementById('doc-ask-ai-btn');
  const count = _selectedKeys.size;
  const total = _allIssues.length;
  if (countEl) {
    if (count === 0) {
      countEl.textContent = '';
    } else if ((_mode === 'sprint' || _mode === 'fixversion') && count === total && total > 0) {
      countEl.textContent = `${total} issues loaded — all selected`;
    } else {
      countEl.textContent = `${count} of ${total} selected`;
    }
  }
  if (askBtn) askBtn.disabled = count === 0;
}
// ── Ask AI ───────────────────────────────────────────────────────────────────
export async function askAI() {
  if (_selectedKeys.size === 0) return;
  const panel = document.getElementById('doc-results-panel');
  const loadingEl = document.getElementById('doc-results-loading');
  const errorEl = document.getElementById('doc-results-error-banner');
  const toolbarEl = document.getElementById('doc-results-toolbar');
  const listEl = document.getElementById('doc-results-list');
  if (panel) panel.style.display = '';
  if (loadingEl) loadingEl.style.display = '';
  if (errorEl) errorEl.style.display = 'none';
  if (toolbarEl) toolbarEl.style.display = 'none';
  if (listEl) listEl.innerHTML = '';
  _suggestions = [];
  _selectedSuggestionIndexes.clear();
  _expandedSuggestionIndexes.clear();
  try {
    const data = await postJSON('/api/confluence/analyze', { jiraIds: [..._selectedKeys] });
    _suggestions = data.suggestions || [];
    renderAnalysisResults();
    void logAiSaving('doc_ai_run', 1);
  } catch (err) {
    _showResultsError(err);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}
// Above this many (current-lines × proposed-lines) cells, the O(n*m) LCS
// table would get too large to build cheaply in a browser tab — fall back to
// a naive "all removed, then all added" diff instead of true LCS.
const LCS_CELL_LIMIT = 250000;
let _suggestions = [];
const _selectedSuggestionIndexes = new Set();
const _expandedSuggestionIndexes = new Set();
export function renderAnalysisResults() {
  const listEl = document.getElementById('doc-results-list');
  const toolbarEl = document.getElementById('doc-results-toolbar');
  if (!listEl) return;
  if (!_suggestions.length) {
    listEl.innerHTML =
      '<p class="doc-empty">No documentation changes were suggested for the selected issues.</p>';
    if (toolbarEl) toolbarEl.style.display = 'none';
    _updateSuggestionSelectionState();
    return;
  }
  if (toolbarEl) toolbarEl.style.display = '';
  listEl.innerHTML = _suggestions.map((s, i) => _renderSuggestionRow(s, i)).join('');
  _updateSuggestionSelectionState();
}
export function toggleSuggestionRow(index) {
  if (_expandedSuggestionIndexes.has(index)) _expandedSuggestionIndexes.delete(index);
  else _expandedSuggestionIndexes.add(index);
  const row = document.querySelector(`.doc-suggestion-row[data-index="${index}"]`);
  if (row) row.classList.toggle('expanded', _expandedSuggestionIndexes.has(index));
}
export function toggleSuggestionCheck(index, checked) {
  if (checked) _selectedSuggestionIndexes.add(index);
  else _selectedSuggestionIndexes.delete(index);
  const row = document.querySelector(`.doc-suggestion-row[data-index="${index}"]`);
  if (row) row.classList.toggle('selected', checked);
  _updateSuggestionSelectionState();
}
export function selectAllSuggestions() {
  _suggestions.forEach((_, i) => _selectedSuggestionIndexes.add(i));
  renderAnalysisResults();
}
export function deselectAllSuggestions() {
  _selectedSuggestionIndexes.clear();
  renderAnalysisResults();
}
const UNDO_WINDOW_SECONDS = 60;
let _undoSnapshotId = null;
let _undoCountdownInterval;
let _undoRemainingSeconds = 0;
export function modifyDocumentation() {
  void executeChanges();
}
async function executeChanges() {
  if (_selectedSuggestionIndexes.size === 0) return;
  const modifyBtn = document.getElementById('doc-modify-btn');
  if (modifyBtn) modifyBtn.disabled = true;
  // A fresh execute run supersedes any previous undo window.
  _hideUndoButton();
  const selectedIndexes = [..._selectedSuggestionIndexes];
  const selectedSuggestions = selectedIndexes.map((i) => _suggestions[i]);
  selectedIndexes.forEach((i) => _setSuggestionStatus(i, 'spinner'));
  try {
    const data = await postJSON('/api/confluence/execute', {
      suggestions: selectedSuggestions,
    });
    const results = data.results || [];
    selectedIndexes.forEach((i) => {
      const suggestion = _suggestions[i];
      const result = results.find((r) => r.pageTitle === suggestion.pageTitle);
      if (result) {
        _setSuggestionStatus(i, result.success ? 'success' : 'error', result.error);
      } else {
        _setSuggestionStatus(i, 'error', 'No result returned for this item');
      }
    });
    if (data.snapshotId && results.some((r) => r.success)) {
      _showUndoButton(data.snapshotId);
    }
    const successCount = results.filter((r) => r.success).length;
    if (successCount) void logAiSaving('doc_confluence_modify', successCount);
  } catch (err) {
    // The whole request failed (network error, or execute itself rejected
    // e.g. 503 CONFLUENCE_NOT_CONFIGURED / 400 validation) — nothing was
    // attempted, so reset the rows to pending rather than marking them
    // individually failed, and surface a banner instead.
    selectedIndexes.forEach((i) => _setSuggestionStatus(i, 'pending'));
    _showResultsError(err, 'Modify Documentation failed');
  }
}
export async function undoChanges() {
  if (!_undoSnapshotId) return;
  const snapshotId = _undoSnapshotId;
  const btn = document.getElementById('doc-undo-btn');
  if (_undoCountdownInterval) {
    clearInterval(_undoCountdownInterval);
    _undoCountdownInterval = undefined;
  }
  if (btn) {
    btn.disabled = true;
    btn.classList.add('doc-undo-btn-loading');
    btn.textContent = 'Undoing…';
  }
  try {
    await postJSON(`/api/confluence/undo/${encodeURIComponent(snapshotId)}`, {});
    showJiraToast('success', 'Changes reverted');
    _hideUndoButton();
    renderAnalysisResults();
  } catch (err) {
    const message = err?.message || String(err);
    if (message.toLowerCase().includes('expired') || message.toLowerCase().includes('not found')) {
      showJiraToast('error', 'Undo window expired');
      _hideUndoButton();
    } else {
      showJiraToast('error', `Undo failed: ${message}`);
      // The snapshot may still be valid server-side — re-enable the button
      // and resume the countdown from where it left off rather than losing
      // the undo window on a transient error.
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('doc-undo-btn-loading');
      }
      if (_undoSnapshotId) {
        _updateUndoButtonLabel();
        _startUndoCountdownTimer();
      }
    }
  }
}
function _showUndoButton(snapshotId) {
  _undoSnapshotId = snapshotId;
  _undoRemainingSeconds = UNDO_WINDOW_SECONDS;
  const btn = document.getElementById('doc-undo-btn');
  if (!btn) return;
  btn.style.display = '';
  btn.disabled = false;
  btn.classList.remove('doc-undo-btn-loading');
  _updateUndoButtonLabel();
  _startUndoCountdownTimer();
}
function _hideUndoButton() {
  if (_undoCountdownInterval) {
    clearInterval(_undoCountdownInterval);
    _undoCountdownInterval = undefined;
  }
  _undoSnapshotId = null;
  const btn = document.getElementById('doc-undo-btn');
  if (btn) {
    btn.style.display = 'none';
    btn.disabled = false;
    btn.classList.remove('doc-undo-btn-loading');
    btn.textContent = '↩ Undo all changes';
  }
}
function _startUndoCountdownTimer() {
  if (_undoCountdownInterval) clearInterval(_undoCountdownInterval);
  _undoCountdownInterval = setInterval(() => {
    _undoRemainingSeconds -= 1;
    if (_undoRemainingSeconds <= 0) {
      _hideUndoButton();
      return;
    }
    _updateUndoButtonLabel();
  }, 1000);
}
function _updateUndoButtonLabel() {
  const btn = document.getElementById('doc-undo-btn');
  if (!btn) return;
  btn.textContent = `↩ Undo all changes (${_undoRemainingSeconds}s)`;
}
function _setSuggestionStatus(index, status, message) {
  const statusEl = document.querySelector(`.doc-suggestion-status[data-index="${index}"]`);
  const errorEl = document.querySelector(`.doc-suggestion-error-text[data-index="${index}"]`);
  if (statusEl) {
    statusEl.className = `doc-suggestion-status ${status}`;
    statusEl.textContent = status === 'success' ? '✓' : status === 'error' ? '✗' : '';
    if (status === 'error' && message) statusEl.title = message;
    else statusEl.removeAttribute('title');
  }
  if (errorEl) {
    errorEl.textContent = status === 'error' && message ? message : '';
  }
}
// ── Diff rendering ───────────────────────────────────────────────────────────
// No diff library exists in this codebase's dependencies (and adding one is
// out of scope for #372), so this is a small self-contained LCS-based line
// diff: lines common to both sides (in order) are context, lines only in
// "current" are removed, lines only in "proposed" are added. It doesn't need
// to be a perfect diff algorithm — just visually correct for review purposes.
function _computeLineDiff(current, proposed) {
  const a = current.split('\n');
  const b = proposed.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > LCS_CELL_LIMIT) {
    return [
      ...a.map((text) => ({ type: 'remove', text })),
      ...b.map((text) => ({ type: 'add', text })),
    ];
  }
  // Standard bottom-up LCS length table over lines.
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      lines.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    lines.push({ type: 'remove', text: a[i] });
    i++;
  }
  while (j < m) {
    lines.push({ type: 'add', text: b[j] });
    j++;
  }
  return lines;
}
function _diffLinesForSuggestion(s) {
  if (s.action === 'Create') {
    return (s.proposedContent || '').split('\n').map((text) => ({ type: 'add', text }));
  }
  if (s.action === 'Delete') {
    return (s.currentContent || '').split('\n').map((text) => ({ type: 'remove', text }));
  }
  return _computeLineDiff(s.currentContent || '', s.proposedContent || '');
}
function _renderDiffHtml(s) {
  const lines = _diffLinesForSuggestion(s);
  if (!lines.length) return '<div class="doc-diff-empty">No content to compare.</div>';
  return lines
    .map((line) => {
      const cls =
        line.type === 'add' ? 'diff-add' : line.type === 'remove' ? 'diff-remove' : 'diff-context';
      const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ';
      return `<div class="diff-line ${cls}"><span class="diff-marker">${marker}</span><span class="diff-text">${_esc(line.text)}</span></div>`;
    })
    .join('');
}
function _renderSuggestionRow(s, index) {
  const checked = _selectedSuggestionIndexes.has(index) ? 'checked' : '';
  const rowClasses = [
    'doc-suggestion-row',
    _selectedSuggestionIndexes.has(index) ? 'selected' : '',
    _expandedSuggestionIndexes.has(index) ? 'expanded' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const actionClass = `doc-action-${s.action.toLowerCase()}`;
  return `<div class="${rowClasses}" data-index="${index}">
    <div class="doc-suggestion-header" onclick="toggleSuggestionRow(${index})">
      <input type="checkbox" ${checked} onclick="event.stopPropagation()" onchange="toggleSuggestionCheck(${index},this.checked)" />
      <div class="doc-suggestion-body">
        <div class="doc-suggestion-top">
          <span class="doc-suggestion-title">${_esc(s.pageTitle)}</span>
          <span class="doc-action-badge ${actionClass}">${_esc(s.action)}</span>
          <span class="doc-suggestion-status" data-index="${index}"></span>
        </div>
        <div class="doc-suggestion-path">${_esc(s.hierarchyPath)}</div>
        <div class="doc-suggestion-error-text" data-index="${index}"></div>
      </div>
      <span class="doc-suggestion-chevron">▾</span>
    </div>
    <div class="doc-diff-body">
      <div class="doc-diff-inner">
        <div class="doc-diff-content">${_renderDiffHtml(s)}</div>
      </div>
    </div>
  </div>`;
}
function _updateSuggestionSelectionState() {
  const countEl = document.getElementById('doc-results-selection-count');
  const modifyBtn = document.getElementById('doc-modify-btn');
  const count = _selectedSuggestionIndexes.size;
  if (countEl) {
    countEl.textContent = _suggestions.length ? `${count} of ${_suggestions.length} selected` : '';
  }
  if (modifyBtn) modifyBtn.disabled = count === 0;
}
function _showResultsError(err, defaultTitle = 'AI analysis failed') {
  const banner = document.getElementById('doc-results-error-banner');
  const titleEl = document.getElementById('doc-results-error-title');
  const detailEl = document.getElementById('doc-results-error-detail');
  if (!banner) return;
  const message = err?.message || String(err);
  let title = defaultTitle;
  if (message.includes('JIRA_NOT_CONFIGURED') || message.includes('JIRA_API_TOKEN')) {
    title = 'JIRA not configured';
  } else if (message.includes('Could not fetch') && message.includes('JIRA issue')) {
    title = 'Could not fetch selected JIRA issues';
  } else if (message.includes('Confluence') && message.includes('not configured')) {
    title = 'Confluence not configured';
  } else if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    title = 'Network error';
  }
  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = message;
  banner.style.display = '';
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function _showDocError(err) {
  const banner = document.getElementById('doc-error-banner');
  const detailEl = document.getElementById('doc-error-detail');
  const titleEl = document.getElementById('doc-error-title');
  if (!banner) return;
  const message = err?.message || String(err);
  let title = 'Failed to load JIRA issues';
  let detail = message;
  if (message.includes('JIRA_NOT_CONFIGURED') || message.includes('JIRA_API_TOKEN')) {
    title = 'JIRA not connected';
    detail = 'Check your API token in Settings.';
  } else if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    title = 'Network error';
  }
  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail;
  banner.style.display = '';
}
function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
//# sourceMappingURL=documentation.js.map
