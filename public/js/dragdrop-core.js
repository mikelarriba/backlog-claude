import { _rankSortFn } from './list-render.js';
// Pure: computes the new rank order for a same-type group after dragging
// `srcFilename` to just before `insertBeforeFilename` (or to the end when
// null/undefined/not found). Returns null when `srcFilename` isn't in
// `group`, matching the original early-return-without-side-effects behavior.
export function computeRerankedOrder(group, srcFilename, insertBeforeFilename) {
  const sorted = [...group].sort(_rankSortFn);
  const draggedIdx = sorted.findIndex((d) => d.filename === srcFilename);
  if (draggedIdx < 0) return null;
  const [dragged] = sorted.splice(draggedIdx, 1);
  let insertIdx = sorted.length; // default: end
  if (insertBeforeFilename) {
    const targetIdx = sorted.findIndex((d) => d.filename === insertBeforeFilename);
    if (targetIdx >= 0) insertIdx = targetIdx;
  }
  sorted.splice(insertIdx, 0, dragged);
  return sorted.map((d) => d.filename);
}
// Pure: given the pre-move group and the orderedFilenames computeRerankedOrder
// above just produced, returns each doc with `rank` set to the sequential
// 1-based value the server's own batchRerank assigns for that exact filename
// order (rank = index + 1 — see src/services/batchService.ts). Lets callers
// apply the deterministic result locally right away instead of waiting on
// the debounced allDocs reload the rerank broadcast eventually triggers.
// Mirrors the pattern list.ts's own (unused) moveDocRank already established
// for this — "apply that same deterministic update locally instead of
// refetching the full doc list." Filenames not present in `group` are
// skipped rather than guessed at.
export function computeRerankedDocs(group, orderedFilenames) {
  const byFilename = new Map(group.map((d) => [d.filename, d]));
  const result = [];
  orderedFilenames.forEach((filename, i) => {
    const doc = byFilename.get(filename);
    if (doc) result.push({ ...doc, rank: i + 1 });
  });
  return result;
}
// Pure targeting logic for moveDocRank below, split out the same way
// computeRerankedOrder is split from executeRerankDrop so it's testable
// without a network call. Returns the insertBeforeFilename to pass to
// executeRerankDrop (null = move to the end), or `undefined` if the move
// is a no-op (item not found, or already at that edge of its group).
export function computeMoveTarget(group, filename, direction) {
  const sorted = [...group].sort(_rankSortFn);
  const idx = sorted.findIndex((d) => d.filename === filename);
  if (idx < 0) return undefined;
  if (direction === 'up' && idx === 0) return undefined;
  if (direction === 'down' && idx === sorted.length - 1) return undefined;
  return direction === 'up' ? sorted[idx - 1].filename : (sorted[idx + 2]?.filename ?? null);
}
// Pure targeting logic for moveDocRankToEdge below, the Home/End counterpart
// to computeMoveTarget's single-step ArrowUp/ArrowDown targeting. Returns the
// insertBeforeFilename to pass to executeRerankDrop (null = move to the end),
// or `undefined` if the move is a no-op (item not found, or already at that
// edge of its group) — same convention as computeMoveTarget.
export function computeEdgeMoveTarget(group, filename, edge) {
  const sorted = [...group].sort(_rankSortFn);
  const idx = sorted.findIndex((d) => d.filename === filename);
  if (idx < 0) return undefined;
  if (edge === 'first' && idx === 0) return undefined;
  if (edge === 'last' && idx === sorted.length - 1) return undefined;
  return edge === 'first' ? sorted[0].filename : null;
}
// Pure: reorders a multi-selection within a single type group's rank order.
// `sorted` is the group already in _rankSortFn order; `selected` is the set of
// filenames within that group to move. Returns the new filename order, or null
// when the move is a no-op (nothing selected, or the whole selection already
// sits at that edge). Non-contiguous selections are handled by nudging each
// selected item one slot past its nearest unselected neighbour (up: top→bottom
// scan, down: bottom→top), which collapses gaps toward the moved edge — the
// behaviour list editors give "move selection up/down". top/bottom lift the
// entire selection (preserving its internal order) to the front/back. This is
// the multi-item counterpart to computeMoveTarget/computeEdgeMoveTarget, which
// only target a single focused row.
export function computeSelectionMove(group, selected, action) {
  const order = [...group].sort(_rankSortFn).map((d) => d.filename);
  const sel = order.filter((f) => selected.has(f));
  if (!sel.length) return null;
  let next;
  if (action === 'top') {
    next = [...sel, ...order.filter((f) => !selected.has(f))];
  } else if (action === 'bottom') {
    next = [...order.filter((f) => !selected.has(f)), ...sel];
  } else if (action === 'up') {
    next = [...order];
    for (let i = 1; i < next.length; i++) {
      if (selected.has(next[i]) && !selected.has(next[i - 1])) {
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
      }
    }
  } else {
    next = [...order];
    for (let i = next.length - 2; i >= 0; i--) {
      if (selected.has(next[i]) && !selected.has(next[i + 1])) {
        [next[i + 1], next[i]] = [next[i], next[i + 1]];
      }
    }
  }
  if (next.length === order.length && next.every((f, i) => f === order[i])) return null;
  return next;
}
// Pure: builds the aria-live announcement for the context-menu multi-select
// move actions, mirroring the "Moved N item(s) to X" phrasing
// contextMoveToPI's toast already uses in list-filters.ts — the sibling
// batch action in the same context menu. Every other keyboard-operable
// reorder path in this issue announces its result (#486); this one didn't
// announce anything at all, unlike its own menu siblings which at least show
// a toast.
export function buildSelectionMoveAnnouncement(count, action) {
  const actionPhrase = action === 'top' || action === 'bottom' ? `to the ${action}` : action;
  return `Moved ${count} item${count === 1 ? '' : 's'} ${actionPhrase}.`;
}
// Fixed left-to-right order the three swimlane sections are rendered in
// (list-render.ts's renderSwimlaneSectionHtml calls), used by
// computeAdjacentSwimlane below for the keyboard-operable alternative to the
// mouse drag-to-swimlane move (#486).
const SWIMLANE_SECTION_ORDER = ['currentPi', 'nextPi', 'backlog'];
// Pure targeting logic for moveDocSwimlaneByKeyboard below, split out the
// same way computeMoveTarget is split from moveDocRank so it's testable
// without a DOM. Returns the section to move `currentSection` into for
// `direction`, or `undefined` when already at that edge. Mirrors
// roadmap-drag.ts's computeAdjacentColumn for the roadmap's own cross-sprint
// keyboard move (#486).
export function computeAdjacentSwimlane(currentSection, direction) {
  const idx = SWIMLANE_SECTION_ORDER.indexOf(currentSection);
  if (idx < 0) return undefined;
  if (direction === 'prev' && idx === 0) return undefined;
  if (direction === 'next' && idx === SWIMLANE_SECTION_ORDER.length - 1) return undefined;
  return direction === 'prev' ? SWIMLANE_SECTION_ORDER[idx - 1] : SWIMLANE_SECTION_ORDER[idx + 1];
}
// Pure: builds the aria-live announcement for a successful swimlane move.
// executeMoveDrop's mouse-drag path already moves the whole multi-selection
// when the dragged item is part of one (getDragDocs, used internally by
// executeMoveDrop) and its success toast already reflects that with a
// "(N items)" suffix — but until now the keyboard path's announcement below
// always named just the focused item, so a screen-reader user moving a
// multi-selection with arrow keys heard "Moved X to Current PI" even though
// several items moved together. Mirrors the toast's count-awareness instead
// (#486).
export function buildSwimlaneMoveAnnouncement(title, label, movedCount) {
  return movedCount > 1 ? `Moved ${movedCount} items to ${label}.` : `Moved ${title} to ${label}.`;
}
// Pure: builds the aria-live announcement for a Home/End jump, reusing the
// "Now position N of M" phrasing the single-step ArrowUp/ArrowDown path
// already announces so both keyboard paths read the same way (#486).
export function buildEdgeMoveAnnouncement(title, edge, total) {
  const position = edge === 'first' ? 1 : total;
  return `Moved ${title} to the ${edge === 'first' ? 'top' : 'bottom'}. Now position ${position} of ${total}.`;
}
// Pure: is a point (relY from the top of a drop-target rect of the given
// height) within the "center zone" — the middle 50% — where dropping
// offers a link/dependency action instead of a rerank/swimlane move?
// Extracted from the near-identical math previously duplicated between
// resolveDropTargets() and the mousemove handler below.
export function isCenterDropZone(relY, height) {
  return relY > height * 0.25 && relY < height * 0.75;
}
//# sourceMappingURL=dragdrop-core.js.map
