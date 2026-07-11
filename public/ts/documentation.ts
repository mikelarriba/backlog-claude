// ── Documentation panel: JIRA issue filter & selector ───────────────────────
// Lets the user search/filter JIRA issues (free text, fix version, issue type),
// multi-select from a paginated results list, then hand the selection off to
// an "Ask AI" action. The AI call itself is out of scope for this module
// (see #371/#372) — askAI() is a stub the later work will replace.
import { fetchJSON } from './state.js';

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

// ── Ask AI (stub — implemented in #371/#372) ─────────────────────────────────
export function askAI(): void {
  if (_selectedKeys.size === 0) return;
  console.log('askAI: stub — selected JIRA issues:', [..._selectedKeys]);
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
