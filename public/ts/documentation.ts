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
import {
  DOC_ACTIONS,
  DOC_CHANGE_ACTIONS,
  DOC_KEYDOWN_ACTIONS,
  matchExecuteResults,
  paginate,
} from './documentation-state.js';
import type {
  DocIssue,
  DocEpic,
  ConfluenceSuggestion,
  ConfluenceExecuteResult,
  ConfluenceUndoResult,
  SuggestionStatus,
} from './documentation-state.js';
import {
  buildIssueRowHtml,
  buildPagerHtml,
  buildEpicRowHtml,
  buildSuggestionRowHtml,
} from './documentation-render.js';

// Re-exported so existing importers (and tests) of documentation.js keep working.
export { DOC_ACTIONS, DOC_CHANGE_ACTIONS, DOC_KEYDOWN_ACTIONS, matchExecuteResults };
export type { DocIssue, DocEpic, ConfluenceSuggestion };
export { buildEpicRowHtml, buildSuggestionRowHtml };
import {
  registerActions,
  registerChangeActions,
  registerInputActions,
  registerKeydownActions,
} from './actions.js';

registerActions({
  [DOC_ACTIONS.rowClick]: (el, e) => {
    docRowClick(e, el.dataset.key ?? '');
  },
  [DOC_ACTIONS.setPage]: (el) => {
    docSetPage(Number(el.dataset.page));
  },
  [DOC_ACTIONS.toggleSuggestion]: (el) => {
    toggleSuggestionRow(Number(el.dataset.index));
  },
  [DOC_ACTIONS.toggleEpic]: (el) => {
    docToggleEpicChildren(el.dataset.key ?? '');
  },
  [DOC_ACTIONS.setMode]: (el) => {
    setDocMode(el.dataset.filterValue ?? '');
  },
  [DOC_ACTIONS.search]: () => {
    docSearch();
  },
  [DOC_ACTIONS.setTypeFilter]: (el) => {
    docSetTypeFilter(el.dataset.filterValue as DocTypeFilter);
  },
  [DOC_ACTIONS.askAI]: () => {
    void askAI();
  },
  [DOC_ACTIONS.selectAllSuggestions]: () => {
    selectAllSuggestions();
  },
  [DOC_ACTIONS.deselectAllSuggestions]: () => {
    deselectAllSuggestions();
  },
  [DOC_ACTIONS.modify]: () => {
    modifyDocumentation();
  },
  [DOC_ACTIONS.exportPdf]: () => {
    void exportDocumentationPdf();
  },
  [DOC_ACTIONS.undo]: () => {
    void undoChanges();
  },
  [DOC_ACTIONS.searchIssues]: () => {
    void searchDocumentationIssues();
  },
});

registerChangeActions({
  [DOC_CHANGE_ACTIONS.setSprint]: (el) => {
    docSetSprint((el as HTMLSelectElement).value);
  },
  [DOC_CHANGE_ACTIONS.setFixVersionBulk]: (el) => {
    docSetFixVersionBulk((el as HTMLSelectElement).value);
  },
  [DOC_CHANGE_ACTIONS.toggleKey]: (el) => {
    const input = el as HTMLInputElement;
    docToggleKey(input.dataset.key ?? '', input.checked);
  },
  [DOC_CHANGE_ACTIONS.toggleSuggestionCheck]: (el) => {
    const input = el as HTMLInputElement;
    toggleSuggestionCheck(Number(input.dataset.index), input.checked);
  },
});

// Typed input-action registration (issue #461 migration — see actions.ts
// for the registerInputActions pattern, generalized from the click/change
// registries). Reuses the issue-filter box's existing
// data-input-action="..." string value (index.html) as the registered
// name, same single-site convention the registerChangeActions migrations
// use.
registerInputActions({
  docFilterInputAction: (el) => {
    docFilterInput((el as HTMLInputElement).value);
  },
});

registerKeydownActions({
  [DOC_KEYDOWN_ACTIONS.filterKeydown]: (_el, e) => {
    if (e.key === 'Enter') docSearch();
  },
});

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
let _allEpics: DocEpic[] = [];
const _selectedKeys = new Set<string>();
const _expandedEpicKeys = new Set<string>();
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
  _allEpics = [];
  _selectedKeys.clear();
  _expandedEpicKeys.clear();
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

// Sprint and Fix Version modes both render epic roll-up rows (#555); Search
// mode is untouched and keeps rendering flat JIRA issue rows.
function _isEpicMode(): boolean {
  return _currentMode === 'sprint' || _currentMode === 'fixversion';
}

// ── Mode switching ────────────────────────────────────────────────────────────
export function setDocMode(mode: string): void {
  if (_selectedKeys.size > 0) {
    const ok = window.confirm('Switching modes will clear your current selection. Continue?');
    if (!ok) return;
  }

  _currentMode = mode as DocMode;
  _allIssues = [];
  _allEpics = [];
  _selectedKeys.clear();
  _expandedEpicKeys.clear();

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

  // Sprint/Fix Version modes roll up into epics (#554's endpoint); Search
  // mode keeps hitting the flat issue search unchanged.
  const epicMode = _isEpicMode();
  const endpoint = epicMode ? '/api/jira/closed-epics' : '/api/jira/search';

  try {
    const params = new URLSearchParams(extraParams);
    const data = (await fetchJSON(`${endpoint}?${params}`)) as {
      issues?: DocIssue[];
      epics?: DocEpic[];
      total?: number;
    };

    if (seq !== _searchSeq) return;

    _selectedKeys.clear();
    _expandedEpicKeys.clear();
    _currentPage = 1;

    if (epicMode) {
      _allEpics = data.epics || [];
      _allIssues = [];
      if (preSelectAll) {
        _allEpics.forEach((e) => _selectedKeys.add(e.key));
      }
      renderEpicsList(_allEpics);
    } else {
      _allIssues = data.issues || [];
      _allEpics = [];
      if (preSelectAll) {
        _allIssues.forEach((i) => _selectedKeys.add(i.key));
      }
      renderIssuesList(_allIssues);
    }
    // Placeholder is the "before any search" state; after a search with 0
    // results the list renders its own empty-state message instead.
    _setPlaceholderVisible(false);
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

  const { pageItems, page, totalPages } = paginate(issues, _currentPage, PAGE_SIZE);
  _currentPage = page;

  listEl.innerHTML = pageItems
    .map((issue) => buildIssueRowHtml(issue, _selectedKeys.has(issue.key)))
    .join('');

  if (pagerEl) pagerEl.innerHTML = buildPagerHtml(page, totalPages, issues.length, 'issue');

  _updateSelectionCount();
}

export function docSetPage(page: number): void {
  _currentPage = page;
  if (_isEpicMode()) renderEpicsList(_allEpics);
  else renderIssuesList(_allIssues);
}

// ── Epic roll-up rendering (Sprint / Fix Version modes, #555) ────────────────
// Modeled directly on renderIssuesList() above: same pager math,
// _updateSelectionCount(), and empty-state handling — the only difference is
// the per-row markup, produced by the pure buildEpicRowHtml() builder so it's
// unit-testable without the DOM (same extraction pattern as
// buildSuggestionRowHtml()).
export function renderEpicsList(epics: DocEpic[]): void {
  const listEl = document.getElementById('doc-issues-list');
  const pagerEl = document.getElementById('doc-pagination');
  if (!listEl) return;

  if (!epics.length) {
    listEl.innerHTML =
      '<p class="doc-empty">No epics had issues closed in this sprint/fix version.</p>';
    if (pagerEl) pagerEl.innerHTML = '';
    _updateSelectionCount();
    return;
  }

  const { pageItems, page, totalPages } = paginate(epics, _currentPage, PAGE_SIZE);
  _currentPage = page;

  listEl.innerHTML = pageItems
    .map((epic) =>
      buildEpicRowHtml(epic, _selectedKeys.has(epic.key), _expandedEpicKeys.has(epic.key))
    )
    .join('');

  if (pagerEl) pagerEl.innerHTML = buildPagerHtml(page, totalPages, epics.length, 'epic');

  _updateSelectionCount();
}

// Toggles one epic row's expanded state in place (no full re-render — the
// children markup is already in the DOM from buildEpicRowHtml(), collapsed
// via CSS, same pattern as toggleSuggestionRow()'s diff body).
export function docToggleEpicChildren(key: string): void {
  if (_expandedEpicKeys.has(key)) _expandedEpicKeys.delete(key);
  else _expandedEpicKeys.add(key);

  const item = document.querySelector(`.doc-epic-item[data-key="${CSS.escape(key)}"]`);
  const expanded = _expandedEpicKeys.has(key);
  if (item) item.classList.toggle('expanded', expanded);

  const btn = item?.querySelector('.doc-epic-expand-btn') as HTMLElement | null;
  if (btn) {
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} closed issues for ${key}`);
  }
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
  const epicMode = _isEpicMode();
  const count = _selectedKeys.size;
  const total = epicMode ? _allEpics.length : _allIssues.length;
  const label = epicMode ? 'epics' : 'issues';

  if (countEl) {
    if (count === 0 || total === 0) {
      countEl.textContent = '';
    } else if (count === total) {
      countEl.textContent = `${total} ${label} loaded \u2014 all selected`;
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
    const payload: {
      jiraIds: string[];
      epics?: Array<{ key: string; summary?: string; closedChildKeys: string[] }>;
    } = { jiraIds: [..._selectedKeys] };

    // Epic mode (#556): also send each selected epic's closed child keys so
    // /analyze can fetch and reason over what actually shipped, not just the
    // epic's own summary. Derived from _allEpics (#555) — the epic-mode
    // selection unit is the epic key, so filter to selected epics and map
    // their closedChildren down to keys.
    if (_isEpicMode()) {
      payload.epics = _allEpics
        .filter((e) => _selectedKeys.has(e.key))
        .map((e) => ({
          key: e.key,
          summary: e.summary,
          closedChildKeys: e.closedChildren.map((c) => c.key),
        }));
    }

    const data = (await postJSON('/api/confluence/analyze', payload)) as {
      suggestions?: ConfluenceSuggestion[];
      warnings?: { unreachableCount: number; totalCount: number };
    };
    _suggestions = data.suggestions || [];
    renderAnalysisResults();
    // #631: a partial JIRA fetch no longer aborts the whole analysis — the
    // suggestions above are grounded in whatever issues were fetched, and
    // this just tells the user some were skipped rather than hiding it.
    if (data.warnings) {
      showJiraToast(
        'warn',
        `${data.warnings.unreachableCount} of ${data.warnings.totalCount} JIRA issue(s) could not be loaded and were skipped (rate limited or inaccessible).`
      );
    }
    void logAiSaving('doc_ai_run', 1);
  } catch (err) {
    _showResultsError(err);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// ── AI Analysis Results ──────────────────────────────────────────────────────
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

    matchExecuteResults(selectedIndexes, results).forEach(({ index, result }) => {
      if (result) {
        _setSuggestionStatus(index, result.success ? 'success' : 'error', result.error);
      } else {
        _setSuggestionStatus(index, 'error', 'No result returned for this item');
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
// The actual diff algorithm + HTML rendering live in lineDiff.ts, a pure,
// DOM-free module imported as renderDiffHtml() above (#458).

function _renderSuggestionRow(s: ConfluenceSuggestion, index: number): string {
  return buildSuggestionRowHtml(
    s,
    index,
    _selectedSuggestionIndexes.has(index),
    _expandedSuggestionIndexes.has(index)
  );
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

// ── Export PDF (#559) ─────────────────────────────────────────────────────────
// Renders the current AI-analysis report as a PDF, purely from client-side
// state (_suggestions) — no re-fetch, no Confluence/JIRA calls, nothing
// applied. POSTs to the server (the suggestions array is client state, not
// something the server can look up) and downloads the response the same way
// exportAiSavingsPptx() does in ai-savings.ts: fetch → res.blob() →
// createObjectURL → anchor.download.
function _currentScopeLabel(): string {
  if (_currentMode === 'sprint') {
    const select = document.getElementById('doc-sprint-select') as HTMLSelectElement | null;
    return select?.value ? `Sprint: ${select.value}` : '';
  }
  if (_currentMode === 'fixversion') {
    const select = document.getElementById('doc-filter-version') as HTMLSelectElement | null;
    return select?.value ? `Fix Version: ${select.value}` : '';
  }
  return 'Search Issues';
}

export async function exportDocumentationPdf(): Promise<void> {
  if (!_suggestions.length) return;
  try {
    const res = await fetch('/api/confluence/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestions: _suggestions, scope: _currentScopeLabel() }),
    });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proposed-documentation-changes.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    showJiraToast('error', `Failed to export PDF: ${(e as Error).message}`);
  }
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
