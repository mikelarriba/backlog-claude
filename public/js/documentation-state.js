// ── Documentation view: shared definitions and pure helpers ──────────────────
// Action-name constants, data shapes and DOM-free logic (pagination, execute
// result matching) shared by documentation.ts (wiring), documentation-render.ts
// (markup builders) and the unit tests. Imports nothing, so it is trivially
// testable without DOM or module mocks.
// Typed data-action names for the issue-row click, pager buttons, and
// suggestion-row expand/collapse toggle (issue #461 migration — see
// actions.ts and CTX_ACTIONS in list-filters.ts for the established
// pattern). Replaces onclick="docRowClick(event,'...')" /
// onclick="docSetPage(...)" / onclick="toggleSuggestionRow(...)" strings
// previously reached through main.ts's untyped window bridge.
export const DOC_ACTIONS = {
  rowClick: 'docRowClick',
  setPage: 'docSetPage',
  toggleSuggestion: 'toggleSuggestionRow',
  toggleEpic: 'docToggleEpicChildren',
  setMode: 'setDocMode',
  // search (issue #461 migration): the Search Issues tab's Search button.
  // docSearch was already directly imported into main.ts and reached
  // through data-action="docSearch" in index.html — the data-action string
  // itself needed no change — but was still dispatched via main.ts's
  // central switch rather than this module's own registry. Same "reuse the
  // existing data-action string as the registered name" shortcut #646 used
  // for toggleModelSection.
  search: 'docSearch',
  // The rest of the Documentation view's click switch cases (issue #461
  // migration, same shortcut as search above — each data-action string in
  // index.html is unchanged, only the dispatch moves off main.ts's central
  // switch onto this module's own registry).
  setTypeFilter: 'docSetTypeFilter',
  askAI: 'askAI',
  selectAllSuggestions: 'selectAllSuggestions',
  deselectAllSuggestions: 'deselectAllSuggestions',
  modify: 'modifyDocumentation',
  exportPdf: 'exportDocumentationPdf',
  undo: 'undoChanges',
  searchIssues: 'searchDocumentationIssues',
};
// Typed data-change-action names for the Sprint / Fix Version mode
// <select>s (index.html's #doc-sprint-select / #doc-filter-version) — the
// proof-of-concept pair for the new change-action registry (issue #461, see
// the "Change-event registry" section of actions.ts). Both elements already
// emit data-change-action="docSetSprint" / "docSetFixVersionBulk" in
// index.html; previously main.ts's change switch reached these two
// functions via an untyped `window` lookup even though it already had them
// as direct imports — this registration replaces that lookup with a real,
// typed call.
// toggleKey/toggleSuggestionCheck (added later) follow the same pattern for
// the issue-row and closed-epic-row checkboxes' onchange (docToggleKey) and
// the suggestion-row checkbox's onchange (toggleSuggestionCheck) — both
// previously reached through main.ts's untyped window bridge. toggleKey is
// shared by two markup sites (the JIRA-search issue list and the closed-
// epic-children list), same as DOC_ACTIONS.rowClick already is.
export const DOC_CHANGE_ACTIONS = {
  setSprint: 'docSetSprint',
  setFixVersionBulk: 'docSetFixVersionBulk',
  toggleKey: 'docToggleKeyChange',
  toggleSuggestionCheck: 'toggleSuggestionCheckChange',
};
// Typed data-keydown-action name for the Search Issues filter box's
// Enter-to-submit (issue #461's keydown-registry — see actions.ts's
// "Keydown-event registry" section and JIRA_PULL_ACTIONS in jira-pull.ts for
// the established pattern). Replaces the
// onkeydown="if (event.key === 'Enter') docSearch();" string previously
// reached through main.ts's untyped window bridge; docSearch is already
// directly imported everywhere else it's called, so this was the last
// reason it needed to be on that bridge at all.
export const DOC_KEYDOWN_ACTIONS = {
  filterKeydown: 'docFilterKeydown',
};
// `POST /api/confluence/execute`'s `results` array is index-aligned with the
// request's `suggestions` array (built via pMap, which preserves original
// position — see confluence.ts), so results must be matched back to their
// suggestion row by position within this execute batch, not by `pageTitle`:
// two suggestions can share a pageTitle (e.g. duplicate AI output), in which
// case a title-based lookup would incorrectly return the same result for both.
export function matchExecuteResults(selectedIndexes, results) {
  return selectedIndexes.map((index, pos) => ({ index, result: results[pos] }));
}
// Pure: clamps `page` into range and returns that page's slice plus the total
// page count (always >= 1).
export function paginate(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const start = (clamped - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), page: clamped, totalPages };
}
//# sourceMappingURL=documentation-state.js.map
