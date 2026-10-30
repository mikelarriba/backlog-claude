// ── Documentation panel: AI suggestions (analysis results, execute, undo, PDF) ──
// Split out of documentation.ts (#699). Owns the suggestion list and its
// selection/expansion state; issue selection and view wiring stay in
// documentation.ts, which feeds this module via setSuggestions().
import { postJSON, showJiraToast } from './state.js';
import { logAiSaving } from './ai-savings.js';
import {
  showUndoButton,
  hideUndoButton,
  undoChanges as undoSnapshot,
} from './documentation-undo.js';
import { matchExecuteResults, resultsErrorTitle } from './documentation-state.js';
import type {
  ConfluenceSuggestion,
  ConfluenceExecuteResult,
  SuggestionStatus,
} from './documentation-state.js';
import { buildSuggestionRowHtml } from './documentation-render.js';

// ── AI Analysis Results ──────────────────────────────────────────────────────
let _suggestions: ConfluenceSuggestion[] = [];
const _selectedSuggestionIndexes = new Set<number>();
const _expandedSuggestionIndexes = new Set<number>();

export function resetSuggestions(): void {
  _suggestions = [];
  _selectedSuggestionIndexes.clear();
  _expandedSuggestionIndexes.clear();
}

export function setSuggestions(suggestions: ConfluenceSuggestion[]): void {
  _suggestions = suggestions;
}

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
// Undo window + countdown live in documentation-undo.ts

export function modifyDocumentation(): void {
  void executeChanges();
}

async function executeChanges(): Promise<void> {
  if (_selectedSuggestionIndexes.size === 0) return;

  const modifyBtn = document.getElementById('doc-modify-btn') as HTMLButtonElement | null;
  if (modifyBtn) modifyBtn.disabled = true;

  hideUndoButton();

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
      showUndoButton(data.snapshotId);
    }
    const successCount = results.filter((r) => r.success).length;
    if (successCount) void logAiSaving('doc_confluence_modify', successCount);
  } catch (err) {
    selectedIndexes.forEach((i) => _setSuggestionStatus(i, 'pending'));
    showResultsError(err, 'Modify Documentation failed');
  }
}

export async function undoChanges(): Promise<void> {
  await undoSnapshot(renderAnalysisResults);
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
export async function exportDocumentationPdf(scope: string): Promise<void> {
  if (!_suggestions.length) return;
  try {
    const res = await fetch('/api/confluence/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestions: _suggestions, scope }),
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

export function showResultsError(err: unknown, defaultTitle = 'AI analysis failed'): void {
  const banner = document.getElementById('doc-results-error-banner') as HTMLElement | null;
  const titleEl = document.getElementById('doc-results-error-title');
  const detailEl = document.getElementById('doc-results-error-detail');
  if (!banner) return;

  const message = (err as Error)?.message || String(err);
  const title = resultsErrorTitle(message, defaultTitle);

  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = message;
  banner.style.display = '';
}
