// ── Documentation view: HTML builders ────────────────────────────────────────
// Pure string builders for the issue/epic/suggestion rows and the pager. No
// module state and no DOM access; documentation.ts owns the state and calls
// these to produce markup.
import { escHtml } from './state.js';
import { renderDiffHtml } from './lineDiff.js';
import { DOC_ACTIONS, DOC_CHANGE_ACTIONS } from './documentation-state.js';
// Pure: one JIRA issue row in the Search/Sprint/Fix Version list.
export function buildIssueRowHtml(issue, isSelected) {
  const checked = isSelected ? 'checked' : '';
  const selected = isSelected ? 'selected' : '';
  const typeClass = `doc-type-${(issue.issuetype || '').toLowerCase().replace(/\s+/g, '-')}`;
  const statusClass = `doc-status-${(issue.status || '').toLowerCase().replace(/\s+/g, '-')}`;
  return `<div class="doc-issue-row ${selected}" data-key="${escHtml(issue.key)}" data-action="${DOC_ACTIONS.rowClick}">
        <input type="checkbox" ${checked} data-key="${escHtml(issue.key)}" data-change-action="${DOC_CHANGE_ACTIONS.toggleKey}" onclick="event.stopPropagation()" />
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
}
// Pure: the pager under the issue list.
export function buildPagerHtml(page, totalPages, total, noun) {
  return totalPages > 1
    ? `<button class="btn-ghost btn-xs" ${page <= 1 ? 'disabled' : ''} data-action="${DOC_ACTIONS.setPage}" data-page="${page - 1}">‹ Prev</button>
           <span class="doc-page-info">Page ${page} of ${totalPages} (${total} ${noun}s)</span>
           <button class="btn-ghost btn-xs" ${page >= totalPages ? 'disabled' : ''} data-action="${DOC_ACTIONS.setPage}" data-page="${page + 1}">Next ›</button>`
    : `<span class="doc-page-info">${total} ${noun}${total === 1 ? '' : 's'}</span>`;
}
// Pure: builds one epic row's HTML (including its read-only, always-in-DOM
// closed-children list, collapsed/expanded via CSS) from the epic and its
// selected/expanded flags — no DOM/module-state reads, so it's directly
// unit-testable (same signature-change extraction as buildSuggestionRowHtml
// above). The epic row itself reuses the existing .doc-issue-row
// class/structure/selection wiring (docRowClick / docToggleKey) unchanged;
// the expand toggle is a separate data-action so a click on it doesn't also
// toggle selection (main.ts's delegated handler resolves to the *nearest*
// [data-action] ancestor-or-self of the click target).
export function buildEpicRowHtml(epic, selected, expanded) {
  const checked = selected ? 'checked' : '';
  const selectedClass = selected ? 'selected' : '';
  const statusClass = `doc-status-${(epic.status || '').toLowerCase().replace(/\s+/g, '-')}`;
  const childCount = epic.closedChildren.length;
  const itemClasses = ['doc-epic-item', expanded ? 'expanded' : ''].filter(Boolean).join(' ');
  const title = epic.epicName || epic.summary;
  const childrenHtml = childCount
    ? epic.closedChildren.map((c) => _buildEpicChildRowHtml(c)).join('')
    : '<p class="doc-empty doc-epic-children-empty">No closed issues.</p>';
  return `<div class="${itemClasses}" data-key="${escHtml(epic.key)}">
    <div class="doc-issue-row ${selectedClass}" data-key="${escHtml(epic.key)}" data-action="${DOC_ACTIONS.rowClick}">
      <input type="checkbox" ${checked} data-key="${escHtml(epic.key)}" data-change-action="${DOC_CHANGE_ACTIONS.toggleKey}" onclick="event.stopPropagation()" />
      <div class="doc-issue-body">
        <div class="doc-issue-top">
          <span class="doc-issue-key">${escHtml(epic.key)}</span>
          <span class="doc-type-badge doc-type-epic">Epic</span>
          <span class="doc-status-badge ${statusClass}">${escHtml(epic.status)}</span>
          <span class="doc-epic-closed-badge">${childCount} closed</span>
          ${epic.localExists ? '<span class="doc-local-badge" title="Already imported locally">✓ Local</span>' : ''}
        </div>
        <div class="doc-issue-title" title="${escHtml(title)}">${escHtml(title)}</div>
      </div>
      <button
        type="button"
        class="doc-epic-expand-btn"
        data-action="${DOC_ACTIONS.toggleEpic}"
        data-key="${escHtml(epic.key)}"
        aria-expanded="${expanded ? 'true' : 'false'}"
        aria-label="${expanded ? 'Collapse' : 'Expand'} closed issues for ${escHtml(epic.key)}"
      >
        <span class="doc-epic-expand-chevron">▾</span>
      </button>
    </div>
    <div class="doc-epic-children-body">
      <div class="doc-epic-children-inner">${childrenHtml}</div>
    </div>
  </div>`;
}
// Pure: one read-only closed-child row inside an expanded epic. No checkbox
// / selection — children ride along with their parent epic's selection.
function _buildEpicChildRowHtml(child) {
  const typeClass = `doc-type-${(child.issuetype || '').toLowerCase().replace(/\s+/g, '-')}`;
  const statusClass = `doc-status-${(child.status || '').toLowerCase().replace(/\s+/g, '-')}`;
  return `<div class="doc-epic-child-row" data-key="${escHtml(child.key)}">
    <span class="doc-issue-key">${escHtml(child.key)}</span>
    <span class="doc-type-badge ${typeClass}">${escHtml(child.issuetype)}</span>
    <span class="doc-status-badge ${statusClass}">${escHtml(child.status)}</span>
    ${child.localExists ? '<span class="doc-local-badge" title="Already imported locally">✓ Local</span>' : ''}
    <span class="doc-epic-child-title" title="${escHtml(child.summary)}">${escHtml(child.summary)}</span>
  </div>`;
}
// Pure: builds one suggestion row's HTML from the suggestion, its index, and
// its selected/expanded flags (passed explicitly instead of read from the
// module-private _selectedSuggestionIndexes/_expandedSuggestionIndexes Sets)
// so it's testable without DOM/module state \u2014 same signature-change extraction
// roadmap-render.ts's buildRoadmapCardHtml(doc, parent) used (#460/#508).
export function buildSuggestionRowHtml(s, index, selected, expanded) {
  const checked = selected ? 'checked' : '';
  const rowClasses = ['doc-suggestion-row', selected ? 'selected' : '', expanded ? 'expanded' : '']
    .filter(Boolean)
    .join(' ');
  const actionClass = `doc-action-${s.action.toLowerCase()}`;
  return `<div class="${rowClasses}" data-index="${index}">
    <div class="doc-suggestion-header" data-action="${DOC_ACTIONS.toggleSuggestion}" data-index="${index}">
      <input type="checkbox" ${checked} data-index="${index}" data-change-action="${DOC_CHANGE_ACTIONS.toggleSuggestionCheck}" onclick="event.stopPropagation()" />
      <div class="doc-suggestion-body">
        <div class="doc-suggestion-top">
          <span class="doc-suggestion-title">${escHtml(s.pageTitle)}</span>
          <span class="doc-action-badge ${actionClass}">${escHtml(s.action)}</span>
          <span class="doc-suggestion-status" data-index="${index}"></span>
        </div>
        <div class="doc-suggestion-path">${escHtml(s.hierarchyPath)}</div>
        ${_buildSuggestionLinkHtml(s)}
        <div class="doc-suggestion-error-text" data-index="${index}"></div>
      </div>
      <span class="doc-suggestion-chevron">\u25be</span>
    </div>
    <div class="doc-diff-body">
      <div class="doc-diff-inner">
        <div class="doc-diff-content">${renderDiffHtml(s)}</div>
      </div>
    </div>
  </div>`;
}
// Pure: the last segment of a " > "-joined hierarchy path is the immediate
// parent (see mapPageSummary in confluenceService.ts, which the analysis
// prompt's existing-page listing — and so a Create suggestion's proposed
// hierarchyPath — mirrors). Falls back to the raw path when it has no " > "
// separator (e.g. a single-level parent).
function _parentTitleFromHierarchyPath(hierarchyPath) {
  const segments = (hierarchyPath || '')
    .split('>')
    .map((p) => p.trim())
    .filter(Boolean);
  return segments.length ? segments[segments.length - 1] : hierarchyPath || '';
}
// Pure: renders the suggestion's Confluence deep link, if one was resolved
// (#662). Update/Delete link to the existing target page; Create links to
// the proposed parent instead, since the new page doesn't exist yet.
// Renders nothing when pageUrl is null/absent (Confluence unconfigured or
// the page couldn't be resolved) so the UI degrades gracefully.
function _buildSuggestionLinkHtml(s) {
  if (!s.pageUrl) return '';
  const label =
    s.action === 'Create'
      ? `New page under: ${escHtml(_parentTitleFromHierarchyPath(s.hierarchyPath))}`
      : 'View page in Confluence';
  return `<a class="doc-suggestion-link" href="${escHtml(s.pageUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${label} ↗</a>`;
}
//# sourceMappingURL=documentation-render.js.map
