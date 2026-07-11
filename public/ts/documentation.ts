// ── Documentation panel: JIRA issue filter & selector ───────────────────────
// Lets the user search/filter JIRA issues (free text, fix version, issue type),
// multi-select from a paginated results list, then hand the selection off to
// an "Ask AI" action, which POSTs to /api/confluence/analyze (see #371) and
// renders the returned suggestions (see the "AI Analysis Results" section
// below, #372).
import { fetchJSON, postJSON } from './state.js';

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

type DocTypeFilter = 'all' | 'epic' | 'story' | 'bug';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

let _allIssues: DocIssue[] = [];
const _selectedKeys = new Set<string>();
let _searchText = '';
let _typeFilter: DocTypeFilter = 'all';
let _fixVersionFilter = '';
let _versions: JiraVersion[] = [];
let _versionsLoaded = false;
let _currentPage = 1;
let _debounceTimer: ReturnType<typeof setTimeout> | undefined;
let _searchSeq = 0;

// ── Init ─────────────────────────────────────────────────────────────────────
export async function loadDocumentationView(): Promise<void> {
  if (!_versionsLoaded) {
    await loadDocVersions();
  }
  await searchDocumentationIssues();
}

async function loadDocVersions(): Promise<void> {
  const select = document.getElementById('doc-filter-version') as HTMLSelectElement | null;
  try {
    const data = (await fetchJSON('/api/jira/versions')) as { versions?: JiraVersion[] };
    _versions = data.versions || [];
    _versionsLoaded = true;
  } catch {
    _versions = [];
  }
  if (select) {
    const current = select.value;
    select.innerHTML =
      '<option value="">All fix versions</option>' +
      _versions.map((v) => `<option value="${_esc(v.name)}">${_esc(v.name)}</option>`).join('');
    select.value = current;
  }
}

// ── Search ───────────────────────────────────────────────────────────────────
export function docFilterInput(value: string): void {
  _searchText = value;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    void searchDocumentationIssues();
  }, SEARCH_DEBOUNCE_MS);
}

export function docSetTypeFilter(type: DocTypeFilter): void {
  if (_typeFilter === type) return;
  _typeFilter = type;
  document.querySelectorAll<HTMLElement>('.doc-chip').forEach((el) => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  void searchDocumentationIssues();
}

export function docSetFixVersion(value: string): void {
  _fixVersionFilter = value;
  void searchDocumentationIssues();
}

export async function searchDocumentationIssues(): Promise<void> {
  const seq = ++_searchSeq;
  const loadingEl = document.getElementById('doc-loading');
  const errorEl = document.getElementById('doc-error-banner') as HTMLElement | null;
  const listEl = document.getElementById('doc-issues-list');

  if (loadingEl) loadingEl.style.display = '';
  if (errorEl) errorEl.style.display = 'none';
  if (listEl) listEl.innerHTML = '';

  try {
    const params = new URLSearchParams({ type: _typeFilter });
    if (_searchText.trim()) params.set('text', _searchText.trim());
    if (_fixVersionFilter) params.set('fixVersion', _fixVersionFilter);

    const data = (await fetchJSON(`/api/jira/search?${params}`)) as {
      issues?: DocIssue[];
      total?: number;
    };

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
export function renderIssuesList(issues: DocIssue[]): void {
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
  if (countEl) {
    countEl.textContent = count > 0 ? `${count} of ${_allIssues.length} selected` : '';
  }
  if (askBtn) askBtn.disabled = count === 0;
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
  } catch (err) {
    _showResultsError(err);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// ── AI Analysis Results ──────────────────────────────────────────────────────
// Renders the ConfluenceSuggestion[] returned by POST /api/confluence/analyze
// (see src/routes/confluence.ts, #371) as a collapsible list with per-item
// selection and a unified-diff style expanded view. "Modify Documentation"
// is wired to a stub — the actual Confluence write happens in #373/#374.
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

// Above this many (current-lines × proposed-lines) cells, the O(n*m) LCS
// table would get too large to build cheaply in a browser tab — fall back to
// a naive "all removed, then all added" diff instead of true LCS.
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

// ── Modify Documentation (stub — Confluence writes land in #373/#374) ────────
export function modifyDocumentation(): void {
  if (_selectedSuggestionIndexes.size === 0) return;
  console.log(
    'modifyDocumentation: stub — selected suggestions:',
    [..._selectedSuggestionIndexes].map((i) => _suggestions[i])
  );
}

// ── Diff rendering ───────────────────────────────────────────────────────────
// No diff library exists in this codebase's dependencies (and adding one is
// out of scope for #372), so this is a small self-contained LCS-based line
// diff: lines common to both sides (in order) are context, lines only in
// "current" are removed, lines only in "proposed" are added. It doesn't need
// to be a perfect diff algorithm — just visually correct for review purposes.
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

  // Standard bottom-up LCS length table over lines.
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
      const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ';
      return `<div class="diff-line ${cls}"><span class="diff-marker">${marker}</span><span class="diff-text">${_esc(line.text)}</span></div>`;
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
          <span class="doc-suggestion-title">${_esc(s.pageTitle)}</span>
          <span class="doc-action-badge ${actionClass}">${_esc(s.action)}</span>
        </div>
        <div class="doc-suggestion-path">${_esc(s.hierarchyPath)}</div>
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

function _updateSuggestionSelectionState(): void {
  const countEl = document.getElementById('doc-results-selection-count');
  const modifyBtn = document.getElementById('doc-modify-btn') as HTMLButtonElement | null;
  const count = _selectedSuggestionIndexes.size;
  if (countEl) {
    countEl.textContent = _suggestions.length ? `${count} of ${_suggestions.length} selected` : '';
  }
  if (modifyBtn) modifyBtn.disabled = count === 0;
}

function _showResultsError(err: unknown): void {
  const banner = document.getElementById('doc-results-error-banner') as HTMLElement | null;
  const titleEl = document.getElementById('doc-results-error-title');
  const detailEl = document.getElementById('doc-results-error-detail');
  if (!banner) return;

  const message = (err as Error)?.message || String(err);
  let title = 'AI analysis failed';
  if (message.includes('JIRA_NOT_CONFIGURED') || message.includes('JIRA_API_TOKEN')) {
    title = 'JIRA not configured';
  } else if (message.includes('Could not fetch') && message.includes('JIRA issue')) {
    title = 'Could not fetch selected JIRA issues';
  } else if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    title = 'Network error';
  }

  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = message;
  banner.style.display = '';
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function _showDocError(err: unknown): void {
  const banner = document.getElementById('doc-error-banner') as HTMLElement | null;
  const detailEl = document.getElementById('doc-error-detail');
  const titleEl = document.getElementById('doc-error-title');
  if (!banner) return;

  const message = (err as Error)?.message || String(err);
  let title = 'Failed to load JIRA issues';
  if (message.includes('JIRA_NOT_CONFIGURED') || message.includes('JIRA_API_TOKEN')) {
    title = 'JIRA not configured';
  } else if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    title = 'Network error';
  }

  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = message;
  banner.style.display = '';
}

function _esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
