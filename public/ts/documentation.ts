// ── Documentation panel: mode-based JIRA issue selector ─────────────────────
// Three-tab UI introduced in #384/#386:
//   • By Sprint — loads all issues for a sprint, pre-selects all
//   • By Fix Version — loads all issues for a version, pre-selects all
//   • Search Issues — explicit trigger (Enter or Search button), no pre-select
// Issues are handed off to "Ask AI" → POST /api/confluence/analyze (#371)
// which returns suggestions rendered as a diff view (#372), then executed
// via POST /api/confluence/execute (#374) with a 60-second undo window.
import { fetchJSON, postJSON, showJiraToast, escHtml } from './state.js';
import { logAiSaving } from './ai-savings.js';

export interface DocIssue {
  key: string;
  summary: string;
  epicName?: string;
  issuetype: string;
  status: string;
  priority?: string;
  fixVersions?: string[];
  localExists?: boolean;
  localFilename?: string | null;
  localDocType?: string | null;
}

interface JiraVersion {
  id: string;
  name: string;
  released: boolean;
  archived: boolean;
}

interface JiraSprint {
  id: number;
  name: string;
  state?: string;
}

type DocMode = 'sprint' | 'fixversion' | 'search';
type DocTypeFilter = 'all' | 'epic' | 'story' | 'bug';

const PAGE_SIZE = 20;

let _allIssues: DocIssue[] = [];
const _selectedKeys = new Set<string>();
let _searchText = '';
let _typeFilter: DocTypeFilter = 'all';
let _versions: JiraVersion[] = [];
let _versionsLoaded = false;
let _sprints: JiraSprint[] = [];
let _sprintsLoaded = false;
let _currentMode: DocMode = 'sprint';
let _currentPage = 1;
let _searchSeq = 0;

// ── Init ─────────────────────────────────────────────────────────────────────
export async function loadDocumentationView(): Promise<void> {
  _allIssues = [];
  _selectedKeys.clear();
  _currentMode = 'sprint';
  _currentPage = 1;

  _clearIssuesList();
  _setPlaceholderVisible(true);
  _updateSelectionCount();

  // Show loading while we hydrate the two dropdowns
  const loadingEl = document.getElementById('doc-loading');
  if (loadingEl) loadingEl.style.display = '';

  await Promise.all([
    _sprintsLoaded ? Promise.resolve() : _loadDocSprints(),
    _versionsLoaded ? Promise.resolve() : _loadDocVersions(),
  ]);

  if (loadingEl) loadingEl.style.display = 'none';
}

async function _loadDocSprints(): Promise<void> {
  const select = document.getElementById('doc-sprint-select') as HTMLSelectElement | null;
  try {
    const data = (await fetchJSON('/api/jira/board-sprints')) as { sprints?: JiraSprint[] };
    _sprints = data.sprints || [];
    _sprintsLoaded = true;
  } catch {
    _sprints = [];
  }
  if (select) {
    select.innerHTML =
      '<option value="">Select a sprint\u2026</option>' +
      _sprints
        .map((s) => `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`)
        .join('');
  }
}

async function _loadDocVersions(): Promise<void> {
  const select = document.getElementById('doc-filter-version') as HTMLSelectElement | null;
  try {
    const data = (await fetchJSON('/api/jira/versions')) as { versions?: JiraVersion[] };
    _versions = data.versions || [];
    _versionsLoaded = true;
  } catch {
    _versions = [];
  }
  if (select) {
    select.innerHTML =
      '<option value="">Select a fix version\u2026</option>' +
      _versions
        .map((v) => `<option value="${escHtml(v.name)}">${escHtml(v.name)}</option>`)
        .join('');
  }
}

// ── Mode switching ────────────────────────────────────────────────────────────
export function setDocMode(mode: string): void {
  if (_selectedKeys.size > 0) {
    const ok = window.confirm('Switching modes will clear your current selection. Continue?');
    if (!ok) return;
  }

  _currentMode = mode as DocMode;
  _allIssues = [];
  _selectedKeys.clear();

  document.querySelectorAll<HTMLElement>('.doc-mode-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.mode === mode);
  });
  document.querySelectorAll<HTMLElement>('.doc-mode-panel').forEach((el) => {
    el.classList.toggle('active', el.id === `doc-mode-${mode}`);
  });

  _clearIssuesList();
  _setPlaceholderVisible(true);
  _updateSelectionCount();
}

// ── Sprint mode ───────────────────────────────────────────────────────────────
export function docSetSprint(value: string): void {
  if (!value) {
    _clearIssuesList();
    _setPlaceholderVisible(true);
    return;
  }
  void _fetchAndRender({ sprint: value }, true);
}

// ── Fix Version mode ──────────────────────────────────────────────────────────
export function docSetFixVersionBulk(value: string): void {
  if (!value) {
    _clearIssuesList();
    _setPlaceholderVisible(true);
    return;
  }
  void _fetchAndRender({ fixVersion: value }, true);
}

// Backwards-compat alias kept for the main.ts import — no longer wired to HTML
export function docSetFixVersion(value: string): void {
  docSetFixVersionBulk(value);
}

// ── Search mode ───────────────────────────────────────────────────────────────
export function docSearch(): void {
  const params: Record<string, string> = { type: _typeFilter };
  if (_searchText.trim()) params.text = _searchText.trim();
  void _fetchAndRender(params, false);
}

export function docFilterInput(value: string): void {
  _searchText = value;
  // No auto-search — user must click Search or press Enter
}

export function docSetTypeFilter(type: DocTypeFilter): void {
  if (_typeFilter === type) return;
  _typeFilter = type;
  document.querySelectorAll<HTMLElement>('.doc-chip').forEach((el) => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  // No auto-search in the new design — user triggers explicitly
}

// ── Retry (error-banner "Retry" button) ───────────────────────────────────────
export async function searchDocumentationIssues(): Promise<void> {
  if (_currentMode === 'sprint') {
    const select = document.getElementById('doc-sprint-select') as HTMLSelectElement | null;
    const value = select?.value ?? '';
    if (value) void _fetchAndRender({ sprint: value }, true);
  } else if (_currentMode === 'fixversion') {
    const select = document.getElementById('doc-filter-version') as HTMLSelectElement | null;
    const value = select?.value ?? '';
    if (value) void _fetchAndRender({ fixVersion: value }, true);
  } else {
    docSearch();
  }
}

// ── Shared fetch + render ─────────────────────────────────────────────────────
async function _fetchAndRender(
  extraParams: Record<string, string>,
  preSelectAll: boolean
): Promise<void> {
  const seq = ++_searchSeq;
  const loadingEl = document.getElementById('doc-loading');
  const errorEl = document.getElementById('doc-error-banner') as HTMLElement | null;

  _clearIssuesList();
  _setPlaceholderVisible(false);
  if (loadingEl) loadingEl.style.display = '';
  if (errorEl) errorEl.style.display = 'none';

  try {
    const params = new URLSearchParams(extraParams);
    const data = (await fetchJSON(`/api/jira/search?${params}`)) as {
      issues?: DocIssue[];
      total?: number;
    };

    if (seq !== _searchSeq) return;

    _allIssues = data.issues || [];
    _selectedKeys.clear();
    if (preSelectAll) {
      _allIssues.forEach((i) => _selectedKeys.add(i.key));
    }

    _currentPage = 1;
    renderIssuesList(_allIssues);

    if (!_allIssues.length) _setPlaceholderVisible(true);
  } catch (err) {
    if (seq !== _searchSeq) return;
    _showDocError(err);
  } finally {
    if (seq === _searchSeq && loadingEl) loadingEl.style.display = 'none';
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────
export function renderIssuesList(issues: DocIssue[]): void {
  const listEl = document.getElementById('doc-issues-list');
  const pagerEl = document.getElementById('doc-pagination');
  if (!listEl) return;

  if (!issues.length) {
    listEl.innerHTML = '';
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
      return `<div class="doc-issue-row ${selected}" data-key="${escHtml(issue.key)}" onclick="docRowClick(event,'${escHtml(issue.key)}')">
        <input type="checkbox" ${checked} onchange="docToggleKey('${escHtml(issue.key)}',this.checked)" onclick="event.stopPropagation()" />
        <div class="doc-issue-body">
          <div class="doc-issue-top">
            <span class="doc-issue-key">${escHtml(issue.key)}</span>
            <span class="doc-type-badge ${typeClass}">${escHtml(issue.issuetype)}</span>
            <span class="doc-status-badge ${statusClass}">${escHtml(issue.status)}</span>
            ${issue.localExists ? '<span class="doc-local-badge" title="Already imported locally">✓ Local</span>' : ''}
          </div>
          <div class="doc-issue-title" title="${escHtml(issue.summary)}">${escHtml(issue.summary)}</div>
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

export function docSetPage(page: number): void {
  _currentPage = page;
  renderIssuesList(_allIssues);
}

// ── Selection ────────────────────────────────────────────────────────────────
export function docRowClick(event: Event, key: string): void {
  const target = event.target as HTMLElement;
  if (target && (target.tagName === 'INPUT' || target.closest('input'))) return;
  const row = document.querySelector(`.doc-issue-row[data-key="${CSS.escape(key)}"]`);
  const cb = row?.querySelector('input[type=checkbox]') as HTMLInputElement | null;
  if (cb) {
    cb.checked = !cb.checked;
    docToggleKey(key, cb.checked);
  }
}

export function docToggleKey(key: string, checked: boolean): void {
  if (checked) _selectedKeys.add(key);
  else _selectedKeys.delete(key);

  const row = document.querySelector(`.doc-issue-row[data-key="${CSS.escape(key)}"]`);
  if (row) row.classList.toggle('selected', checked);

  _updateSelectionCount();
}

function _updateSelectionCount(): void {
  const countEl = document.getElementById('doc-selection-count');
  const askBtn = document.getElementById('doc-ask-ai-btn') as HTMLButtonElement | null;
  const count = _selectedKeys.size;
  const total = _allIssues.length;

  if (countEl) {
    if (count === 0 || total === 0) {
      countEl.textContent = '';
    } else if (count === total) {
      countEl.textContent = `${total} issues loaded \u2014 all selected`;
    } else {
      countEl.textContent = `${count} of ${total} selected`;
    }
  }
  if (askBtn) askBtn.disabled = count === 0;
}

// ── Private helpers ───────────────────────────────────────────────────────────
function _clearIssuesList(): void {
  const listEl = document.getElementById('doc-issues-list');
  const pagerEl = document.getElementById('doc-pagination');
  if (listEl) listEl.innerHTML = '';
  if (pagerEl) pagerEl.innerHTML = '';
}

function _setPlaceholderVisible(visible: boolean): void {
  const el = document.getElementById('doc-placeholder') as HTMLElement | null;
  if (el) el.style.display = visible ? '' : 'none';
}

function _showDocError(err: unknown): void {
  const banner = document.getElementById('doc-error-banner') as HTMLElement | null;
  const detailEl = document.getElementById('doc-error-detail');
  const titleEl = document.getElementById('doc-error-title');
  if (!banner) return;

  const message = (err as Error)?.message || String(err);
  let title = 'Failed to load JIRA issues';
  if (message.includes('JIRA_NOT_CONFIGURED') || message.includes('JIRA_API_TOKEN')) {
    title = 'JIRA not connected';
  } else if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    title = 'Network error';
  }

  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = message;
  banner.style.display = '';
}

// ── Ask AI ───────────────────────────────────────────────────────────────────
export async function askAI(): Promise<void> {
  if (_selectedKeys.size === 0) return;

  const panel = document.getElementById('doc-results-panel') as HTMLElement | null;
  const loadingEl = document.getElementById('doc-results-loading');
  const errorEl = document.getElementById('doc-results-error-banner') as HTMLElement | null;
  const toolbarEl = document.getElementById('doc-results-toolbar') as HTMLElement | null;
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
    const data = (await postJSON('/api/confluence/analyze', { jiraIds: [..._selectedKeys] })) as {
      suggestions?: ConfluenceSuggestion[];
    };
    _suggestions = data.suggestions || [];
    renderAnalysisResults();
    void logAiSaving('doc_ai_run', 1);
  } catch (err) {
    _showResultsError(err);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// ── AI Analysis Results ──────────────────────────────────────────────────────
export interface ConfluenceSuggestion {
  pageTitle: string;
  hierarchyPath: string;
  action: 'Create' | 'Update' | 'Delete';
  currentContent: string;
  proposedContent: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
}

const LCS_CELL_LIMIT = 250_000;

let _suggestions: ConfluenceSuggestion[] = [];
const _selectedSuggestionIndexes = new Set<number>();
const _expandedSuggestionIndexes = new Set<number>();

export function renderAnalysisResults(): void {
  const listEl = document.getElementById('doc-results-list');
  const toolbarEl = document.getElementById('doc-results-toolbar') as HTMLElement | null;
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

export function toggleSuggestionRow(index: number): void {
  if (_expandedSuggestionIndexes.has(index)) _expandedSuggestionIndexes.delete(index);
  else _expandedSuggestionIndexes.add(index);

  const row = document.querySelector(`.doc-suggestion-row[data-index="${index}"]`);
  if (row) row.classList.toggle('expanded', _expandedSuggestionIndexes.has(index));
}

export function toggleSuggestionCheck(index: number, checked: boolean): void {
  if (checked) _selectedSuggestionIndexes.add(index);
  else _selectedSuggestionIndexes.delete(index);

  const row = document.querySelector(`.doc-suggestion-row[data-index="${index}"]`);
  if (row) row.classList.toggle('selected', checked);

  _updateSuggestionSelectionState();
}

export function selectAllSuggestions(): void {
  _suggestions.forEach((_, i) => _selectedSuggestionIndexes.add(i));
  renderAnalysisResults();
}

export function deselectAllSuggestions(): void {
  _selectedSuggestionIndexes.clear();
  renderAnalysisResults();
}

// ── Modify Documentation / Execute + Undo (#374 backend, #375 wiring) ────────
interface ConfluenceExecuteResult {
  pageTitle: string;
  action: 'Create' | 'Update' | 'Delete';
  pageId: string | null;
  success: boolean;
  error?: string;
}

interface ConfluenceUndoResult {
  pageTitle: string;
  action: 'Create' | 'Update' | 'Delete';
  success: boolean;
  error?: string;
}

type SuggestionStatus = 'pending' | 'spinner' | 'success' | 'error';

const UNDO_WINDOW_SECONDS = 60;

let _undoSnapshotId: string | null = null;
let _undoCountdownInterval: ReturnType<typeof setInterval> | undefined;
let _undoRemainingSeconds = 0;

export function modifyDocumentation(): void {
  void executeChanges();
}

async function executeChanges(): Promise<void> {
  if (_selectedSuggestionIndexes.size === 0) return;

  const modifyBtn = document.getElementById('doc-modify-btn') as HTMLButtonElement | null;
  if (modifyBtn) modifyBtn.disabled = true;

  _hideUndoButton();

  const selectedIndexes = [..._selectedSuggestionIndexes];
  const selectedSuggestions = selectedIndexes.map((i) => _suggestions[i]);
  selectedIndexes.forEach((i) => _setSuggestionStatus(i, 'spinner'));

  try {
    const data = (await postJSON('/api/confluence/execute', {
      suggestions: selectedSuggestions,
    })) as {
      snapshotId?: string;
      results?: ConfluenceExecuteResult[];
    };
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
    selectedIndexes.forEach((i) => _setSuggestionStatus(i, 'pending'));
    _showResultsError(err, 'Modify Documentation failed');
  }
}

export async function undoChanges(): Promise<void> {
  if (!_undoSnapshotId) return;
  const snapshotId = _undoSnapshotId;
  const btn = document.getElementById('doc-undo-btn') as HTMLButtonElement | null;

  if (_undoCountdownInterval) {
    clearInterval(_undoCountdownInterval);
    _undoCountdownInterval = undefined;
  }
  if (btn) {
    btn.disabled = true;
    btn.classList.add('doc-undo-btn-loading');
    btn.textContent = 'Undoing\u2026';
  }

  try {
    (await postJSON(`/api/confluence/undo/${encodeURIComponent(snapshotId)}`, {})) as {
      results?: ConfluenceUndoResult[];
    };
    showJiraToast('success', 'Changes reverted');
    _hideUndoButton();
    renderAnalysisResults();
  } catch (err) {
    const message = (err as Error)?.message || String(err);
    if (message.toLowerCase().includes('expired') || message.toLowerCase().includes('not found')) {
      showJiraToast('error', 'Undo window expired');
      _hideUndoButton();
    } else {
      showJiraToast('error', `Undo failed: ${message}`);
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

function _showUndoButton(snapshotId: string): void {
  _undoSnapshotId = snapshotId;
  _undoRemainingSeconds = UNDO_WINDOW_SECONDS;
  const btn = document.getElementById('doc-undo-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.style.display = '';
  btn.disabled = false;
  btn.classList.remove('doc-undo-btn-loading');
  _updateUndoButtonLabel();
  _startUndoCountdownTimer();
}

function _hideUndoButton(): void {
  if (_undoCountdownInterval) {
    clearInterval(_undoCountdownInterval);
    _undoCountdownInterval = undefined;
  }
  _undoSnapshotId = null;
  const btn = document.getElementById('doc-undo-btn') as HTMLButtonElement | null;
  if (btn) {
    btn.style.display = 'none';
    btn.disabled = false;
    btn.classList.remove('doc-undo-btn-loading');
    btn.textContent = '\u21a9 Undo all changes';
  }
}

function _startUndoCountdownTimer(): void {
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

function _updateUndoButtonLabel(): void {
  const btn = document.getElementById('doc-undo-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.textContent = `\u21a9 Undo all changes (${_undoRemainingSeconds}s)`;
}

function _setSuggestionStatus(index: number, status: SuggestionStatus, message?: string): void {
  const statusEl = document.querySelector(
    `.doc-suggestion-status[data-index="${index}"]`
  ) as HTMLElement | null;
  const errorEl = document.querySelector(
    `.doc-suggestion-error-text[data-index="${index}"]`
  ) as HTMLElement | null;

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
function _computeLineDiff(current: string, proposed: string): DiffLine[] {
  const a = current.split('\n');
  const b = proposed.split('\n');
  const n = a.length;
  const m = b.length;

  if (n * m > LCS_CELL_LIMIT) {
    return [
      ...a.map((text): DiffLine => ({ type: 'remove', text })),
      ...b.map((text): DiffLine => ({ type: 'add', text })),
    ];
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
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

function _diffLinesForSuggestion(s: ConfluenceSuggestion): DiffLine[] {
  if (s.action === 'Create') {
    return (s.proposedContent || '').split('\n').map((text): DiffLine => ({ type: 'add', text }));
  }
  if (s.action === 'Delete') {
    return (s.currentContent || '').split('\n').map((text): DiffLine => ({ type: 'remove', text }));
  }
  return _computeLineDiff(s.currentContent || '', s.proposedContent || '');
}

function _renderDiffHtml(s: ConfluenceSuggestion): string {
  const lines = _diffLinesForSuggestion(s);
  if (!lines.length) return '<div class="doc-diff-empty">No content to compare.</div>';

  return lines
    .map((line) => {
      const cls =
        line.type === 'add' ? 'diff-add' : line.type === 'remove' ? 'diff-remove' : 'diff-context';
      const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '\u2212' : ' ';
      return `<div class="diff-line ${cls}"><span class="diff-marker">${marker}</span><span class="diff-text">${escHtml(line.text)}</span></div>`;
    })
    .join('');
}

function _renderSuggestionRow(s: ConfluenceSuggestion, index: number): string {
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
          <span class="doc-suggestion-title">${escHtml(s.pageTitle)}</span>
          <span class="doc-action-badge ${actionClass}">${escHtml(s.action)}</span>
          <span class="doc-suggestion-status" data-index="${index}"></span>
        </div>
        <div class="doc-suggestion-path">${escHtml(s.hierarchyPath)}</div>
        <div class="doc-suggestion-error-text" data-index="${index}"></div>
      </div>
      <span class="doc-suggestion-chevron">\u25be</span>
    </div>
    <div class="doc-diff-body">
      <div class="doc-diff-inner">
        <div class="doc-diff-content">${_renderDiffHtml(s)}</div>
      </div>
    </div>
  </div>`;
}

function _updateSuggestionSelectionState(): void {
  const countEl = document.getElementById('doc-results-selection-count');
  const modifyBtn = document.getElementById('doc-modify-btn') as HTMLButtonElement | null;
  const count = _selectedSuggestionIndexes.size;
  if (countEl) {
    countEl.textContent = _suggestions.length ? `${count} of ${_suggestions.length} selected` : '';
  }
  if (modifyBtn) modifyBtn.disabled = count === 0;
}

function _showResultsError(err: unknown, defaultTitle = 'AI analysis failed'): void {
  const banner = document.getElementById('doc-results-error-banner') as HTMLElement | null;
  const titleEl = document.getElementById('doc-results-error-title');
  const detailEl = document.getElementById('doc-results-error-detail');
  if (!banner) return;

  const message = (err as Error)?.message || String(err);
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
