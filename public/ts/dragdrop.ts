// ── Drag-and-drop: linking + swimlane moves + priority reordering ────────────
// Three coexisting operations based on drop zone:
//   - Drop ON item center (middle 50% of height) → action popup (link or dep)
//   - Drop on item edge / between items          → RERANK (insertion line)
//   - Drop on a .swimlane-section (different)    → MOVE to that PI
//
// Uses mouse events (not HTML5 DnD) for reliable cross-browser behaviour.
import {
  buildChildrenMap,
  getDescendants,
  postJSON,
  showJiraToast,
  TYPE_LABEL,
  DRAG_TARGETS,
  SECTION_LABELS,
  upsertDoc,
} from './state.js';
import type { DocEntry } from './state.js';
import { loadHierarchy } from './detail-links.js';
import {
  clearSelection,
  itemKey,
  getSelectedDocs,
  applyFilters,
  toggleItemSelection,
  rangeSelectItems,
} from './list-filters.js';
import { _rankSortFn } from './list-render.js';

// No aria-live region existed for list reorder before this; adds one,
// visually hidden but announced to screen readers, following the same
// lazily-created/appended-to-body convention introduced for canvas link
// mode (#486 phase 4/N, refine-canvas.ts's _canvasLinkStatusRegion).
function _listReorderStatusRegion(): HTMLElement {
  let el = document.getElementById('list-reorder-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'list-reorder-status';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    document.body.appendChild(el);
  }
  return el;
}

function _announceListReorderStatus(message: string): void {
  _listReorderStatusRegion().textContent = message;
}

// Same lazily-created aria-live region as _announceListReorderStatus above,
// just named for its own call sites (Ctrl/Cmd+Enter toggle and Shift+Enter
// range-select below, #486) — the backlog list only needs one polite status
// region, no reason to create a second DOM node for it.
function _announceListSelectionStatus(message: string): void {
  _listReorderStatusRegion().textContent = message;
}

export function getSwimlaneSection(doc: DocEntry | undefined | null): string {
  if (!doc) return 'backlog';
  if (doc.fixVersion && piSettings.currentPi && doc.fixVersion === piSettings.currentPi)
    return 'currentPi';
  if (doc.fixVersion && piSettings.nextPi && doc.fixVersion === piSettings.nextPi) return 'nextPi';
  return 'backlog';
}

export function sectionToFixVersion(section: string): string | null {
  if (section === 'currentPi') return piSettings.currentPi;
  if (section === 'nextPi') return piSettings.nextPi;
  return null; // backlog = clear version
}

// ── Drop action popup ─────────────────────────────────────────
interface DropRef {
  filename: string;
  docType: string;
}

let _dropPopup: HTMLElement | null = null;
let _pendingDropSrc: DropRef | null = null;
let _pendingDropTgt: DropRef | null = null;
let _escListener: ((e: KeyboardEvent) => void) | null = null;

export function showDropActionPopup(
  srcFilename: string,
  srcDocType: string,
  targetEl: HTMLElement,
  cursorX: number,
  cursorY: number
): void {
  hideDropActionPopup();

  const tgtFilename = targetEl.dataset.filename as string;
  const tgtDocType = targetEl.dataset.doctype as string;
  const tgtTitle =
    targetEl.querySelector('.epic-title-text')?.textContent ||
    targetEl.querySelector('.roadmap-card-title')?.textContent ||
    tgtFilename;

  const canLink = (DRAG_TARGETS[srcDocType] || []).includes(tgtDocType);
  const canDep = srcFilename !== tgtFilename && !canLink;

  if (!canLink && !canDep) return; // nothing to offer

  _pendingDropSrc = { filename: srcFilename, docType: srcDocType };
  _pendingDropTgt = { filename: tgtFilename, docType: tgtDocType };

  const popup = document.createElement('div');
  popup.className = 'drop-action-popup';

  // Subtitle — target item title
  const subtitle = document.createElement('div');
  subtitle.className = 'drop-action-popup-title';
  subtitle.textContent = tgtTitle.length > 40 ? tgtTitle.slice(0, 38) + '…' : tgtTitle;
  popup.appendChild(subtitle);

  if (canLink) {
    const btn = document.createElement('button');
    btn.className = 'drop-action-btn drop-link-btn';
    btn.innerHTML = '<span class="drop-action-btn-icon">🔗</span><span>Link as parent</span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      executeDropLink();
    });
    popup.appendChild(btn);
  }

  if (canDep) {
    const btn = document.createElement('button');
    btn.className = 'drop-action-btn drop-dep-btn';
    btn.innerHTML = '<span class="drop-action-btn-icon">🔒</span><span>Add dependency</span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      executeDropDep();
    });
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
  _dropPopup = popup;

  // Position near cursor, clamped to viewport
  const pw = popup.offsetWidth || 220;
  const ph = popup.offsetHeight || 90;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(cursorX + 12, vw - pw - 12);
  const top = Math.min(cursorY - 10, vh - ph - 12);
  popup.style.left = `${Math.max(8, left)}px`;
  popup.style.top = `${Math.max(8, top)}px`;

  // Dismiss on outside click
  setTimeout(() => {
    document.addEventListener('click', hideDropActionPopup, { once: true });
  }, 0);

  // Dismiss on Escape
  _escListener = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hideDropActionPopup();
  };
  document.addEventListener('keydown', _escListener);
}

export function hideDropActionPopup(): void {
  if (_dropPopup) {
    _dropPopup.remove();
    _dropPopup = null;
  }
  if (_escListener) {
    document.removeEventListener('keydown', _escListener);
    _escListener = null;
  }
  _pendingDropSrc = null;
  _pendingDropTgt = null;
}

async function executeDropLink(): Promise<void> {
  if (!_pendingDropSrc || !_pendingDropTgt) return;
  const src = _pendingDropSrc;
  const tgt = _pendingDropTgt;
  hideDropActionPopup();

  const tgtEl = document.querySelector(`#epic-list [data-filename="${CSS.escape(tgt.filename)}"]`);
  const tgtTitle = tgtEl?.querySelector('.epic-title-text')?.textContent || tgt.filename;
  const dragDocs = getDragDocs(src.filename, src.docType);

  try {
    let linked = 0;
    for (const d of dragDocs) {
      const valid = DRAG_TARGETS[d.docType] || [];
      if (!valid.includes(tgt.docType)) continue;
      await postJSON('/api/link', {
        sourceType: d.docType,
        sourceFilename: d.filename,
        targetType: tgt.docType,
        targetFilename: tgt.filename,
      });
      linked++;
    }
    const msg = linked > 1 ? `Linked ${linked} items to "${tgtTitle}"` : `Linked to "${tgtTitle}"`;
    showJiraToast('success', msg);
    clearSelection();
    if (currentFilename === src.filename || currentFilename === tgt.filename) {
      loadHierarchy(currentFilename as string, currentDocType as string);
    }
  } catch (err) {
    showJiraToast('error', (err as Error).message);
  }
}

async function executeDropDep(): Promise<void> {
  if (!_pendingDropSrc || !_pendingDropTgt) return;
  const src = _pendingDropSrc;
  const tgt = _pendingDropTgt;
  hideDropActionPopup();

  const tgtEl = document.querySelector(`#epic-list [data-filename="${CSS.escape(tgt.filename)}"]`);
  const tgtTitle = tgtEl?.querySelector('.epic-title-text')?.textContent || tgt.filename;

  try {
    await postJSON('/api/link', {
      linkType: 'blocks',
      sourceType: src.docType,
      sourceFilename: src.filename,
      targetType: tgt.docType,
      targetFilename: tgt.filename,
    });
    // Update allDocs entries optimistically
    const srcDoc = allDocs.find((d) => d.filename === src.filename);
    if (srcDoc) {
      srcDoc.blocks = srcDoc.blocks || [];
      if (!srcDoc.blocks.includes(tgt.filename)) srcDoc.blocks.push(tgt.filename);
    }
    const tgtDoc = allDocs.find((d) => d.filename === tgt.filename);
    if (tgtDoc) {
      tgtDoc.blockedBy = tgtDoc.blockedBy || [];
      if (!tgtDoc.blockedBy.includes(src.filename)) tgtDoc.blockedBy.push(src.filename);
    }
    applyFilters();
    showJiraToast(
      'success',
      `"${allDocs.find((d) => d.filename === src.filename)?.title || src.filename}" now blocks "${tgtTitle}"`
    );
  } catch (err) {
    showJiraToast('error', (err as Error).message);
  }
}

// Returns whether the move actually happened (false on a missing-PI-version
// precondition failure or a request error) — used by the keyboard-operable
// alternative below so it only announces "Moved" via aria-live when the move
// really succeeded, instead of duplicating this function's own precondition
// check (#486).
async function executeMoveDrop(
  srcFilename: string,
  srcDocType: string,
  dropSwimlane: HTMLElement
): Promise<boolean> {
  const targetSection = dropSwimlane.dataset.section as string;
  const newFixVersion = sectionToFixVersion(targetSection);

  if (targetSection !== 'backlog' && !newFixVersion) {
    showJiraToast('error', `Set a version for ${SECTION_LABELS[targetSection]} first`);
    return false;
  }

  const dragDocs = getDragDocs(srcFilename, srcDocType);
  const childrenMap = buildChildrenMap(allDocs);
  const allToMove: DocEntry[] = [];
  const seen = new Set<string>();
  for (const d of dragDocs) {
    if (seen.has(d.filename)) continue;
    seen.add(d.filename);
    allToMove.push(d);
    for (const desc of getDescendants(d.filename, childrenMap)) {
      if (!seen.has(desc.filename)) {
        seen.add(desc.filename);
        allToMove.push(desc);
      }
    }
  }

  try {
    await postJSON('/api/docs/batch-fix-version', {
      fixVersion: newFixVersion,
      docs: allToMove.map((d) => ({ type: d.docType, filename: d.filename })),
    });

    const label = SECTION_LABELS[targetSection];
    const countMsg = allToMove.length > 1 ? ` (${allToMove.length} items)` : '';
    showJiraToast('success', `Moved to ${label}${countMsg}`);
    clearSelection();
    return true;
  } catch (err) {
    showJiraToast('error', (err as Error).message);
    return false;
  }
}

// Returns the docs being dragged — either the multi-selection or just the single item
function getDragDocs(srcFilename: string, srcDocType: string): DocEntry[] {
  const key = itemKey(srcFilename, srcDocType);
  if (selectedItems.size > 1 && selectedItems.has(key)) {
    return getSelectedDocs();
  }
  const doc = allDocs.find((d) => d.filename === srcFilename && d.docType === srcDocType);
  return doc ? [doc] : [];
}

// ── Insertion marker (rerank visual indicator) ────────────────
let _insertionMarker: HTMLElement | null = null;

export function getInsertionMarker(): HTMLElement {
  if (!_insertionMarker) {
    _insertionMarker = document.createElement('div');
    _insertionMarker.className = 'rank-insert-line';
    document.body.appendChild(_insertionMarker);
  }
  return _insertionMarker;
}

export function showInsertionMarker(clientY: number): void {
  const list = document.getElementById('epic-list');
  if (!list) return;
  const listRect = list.getBoundingClientRect();
  const marker = getInsertionMarker();
  marker.style.display = 'block';
  marker.style.top = `${clientY - 1}px`;
  marker.style.left = `${listRect.left + 4}px`;
  marker.style.width = `${listRect.width - 8}px`;
}

export function hideInsertionMarker(): void {
  if (_insertionMarker) _insertionMarker.style.display = 'none';
}

// Returns the filename of the item the cursor is ABOVE (insert before it),
// or null to insert at the end of the type group.
function computeInsertBefore(srcDocType: string, clientY: number): string | null {
  const items = [...document.querySelectorAll<HTMLElement>('#epic-list .epic-item')].filter(
    (el) => el.dataset.doctype === srcDocType && !el.classList.contains('drag-source')
  );

  for (const el of items) {
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return el.dataset.filename as string;
  }
  return null; // insert at end
}

// Pure: computes the new rank order for a same-type group after dragging
// `srcFilename` to just before `insertBeforeFilename` (or to the end when
// null/undefined/not found). Returns null when `srcFilename` isn't in
// `group`, matching the original early-return-without-side-effects behavior.
export function computeRerankedOrder(
  group: DocEntry[],
  srcFilename: string,
  insertBeforeFilename: string | null | undefined
): string[] | null {
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
export function computeRerankedDocs(group: DocEntry[], orderedFilenames: string[]): DocEntry[] {
  const byFilename = new Map(group.map((d) => [d.filename, d]));
  const result: DocEntry[] = [];
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
export function computeMoveTarget(
  group: DocEntry[],
  filename: string,
  direction: 'up' | 'down'
): string | null | undefined {
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
export function computeEdgeMoveTarget(
  group: DocEntry[],
  filename: string,
  edge: 'first' | 'last'
): string | null | undefined {
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
export function computeSelectionMove(
  group: DocEntry[],
  selected: Set<string>,
  action: 'up' | 'down' | 'top' | 'bottom'
): string[] | null {
  const order = [...group].sort(_rankSortFn).map((d) => d.filename);
  const sel = order.filter((f) => selected.has(f));
  if (!sel.length) return null;

  let next: string[];
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
export function buildSelectionMoveAnnouncement(
  count: number,
  action: 'up' | 'down' | 'top' | 'bottom'
): string {
  const actionPhrase = action === 'top' || action === 'bottom' ? `to the ${action}` : action;
  return `Moved ${count} item${count === 1 ? '' : 's'} ${actionPhrase}.`;
}

// Multi-select counterpart to executeRerankDrop for the context-menu move
// actions. Groups the selected docs by type, reranks each type group
// independently via computeSelectionMove, then persists + applies each changed
// group exactly the way executeRerankDrop does for a single dragged item
// (POST /api/docs/rerank + the deterministic local upsert, which re-renders
// the list via the store's docs:changed event). Selecting a parent and a child
// together moves each within its own type group; children that aren't
// explicitly selected simply follow their parent's subtree in the tree render
// (visual nesting), so their rank is intentionally left untouched.
export async function moveSelectionRank(
  selected: { filename: string; docType: string }[],
  action: 'up' | 'down' | 'top' | 'bottom'
): Promise<void> {
  const byType = new Map<string, Set<string>>();
  for (const { filename, docType } of selected) {
    if (!byType.has(docType)) byType.set(docType, new Set());
    byType.get(docType)!.add(filename);
  }

  let movedAny = false;
  let erroredAny = false;
  for (const [docType, sel] of byType) {
    const group = allDocs.filter((d) => d.docType === docType);
    const orderedFilenames = computeSelectionMove(group, sel, action);
    if (!orderedFilenames) continue;
    try {
      await postJSON('/api/docs/rerank', { type: docType, orderedFilenames });
      computeRerankedDocs(group, orderedFilenames).forEach((d) => upsertDoc(d));
      movedAny = true;
    } catch (e) {
      showJiraToast('error', (e as Error).message);
      erroredAny = true;
    }
  }

  // Same aria-live region every other keyboard-operable reorder path in this
  // file already announces through (#486). Only announce the no-op edge case
  // when nothing errored, so a real request failure isn't misreported as
  // "already at the edge" — the error toast above already covers that case.
  if (movedAny) {
    _announceListReorderStatus(buildSelectionMoveAnnouncement(selected.length, action));
    // Every other keyboard-operable reorder path in this file restores focus
    // to a drag-handle after the re-render (see moveDocRank's .then() below);
    // this context-menu-driven multi-select path never did, so a keyboard/
    // screen-reader user who moved a selection via Shift+F10/right-click lost
    // their place entirely (focus fell back to <body>) — flagged as an open
    // gap in #608's status comment. Restore it to the first selected item's
    // handle, the same well-defined anchor moveDocRank uses for a single item.
    const anchor = selected[0]?.filename;
    if (anchor) {
      setTimeout(() => {
        document
          .querySelector<HTMLElement>(
            `.epic-item[data-filename="${CSS.escape(anchor)}"] .drag-handle`
          )
          ?.focus();
      }, 200);
    }
  } else if (!erroredAny) {
    const edge = action === 'up' || action === 'top' ? 'top' : 'bottom';
    _announceListReorderStatus(`Selection is already at the ${edge} of the list.`);
  }
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
export function computeAdjacentSwimlane(
  currentSection: string,
  direction: 'prev' | 'next'
): string | undefined {
  const idx = SWIMLANE_SECTION_ORDER.indexOf(currentSection);
  if (idx < 0) return undefined;
  if (direction === 'prev' && idx === 0) return undefined;
  if (direction === 'next' && idx === SWIMLANE_SECTION_ORDER.length - 1) return undefined;
  return direction === 'prev' ? SWIMLANE_SECTION_ORDER[idx - 1] : SWIMLANE_SECTION_ORDER[idx + 1];
}

// Keyboard-operable alternative to the mouse-drag rerank above — swaps the
// focused item with its immediate rank-order neighbor of the same docType
// and persists it the same way a drag-and-drop rerank does. Purely additive:
// calls the same executeRerankDrop() the drag handler already uses, so the
// visual reorder happens the same way (via the debounced allDocs reload
// triggered by the server's rerank broadcast), and does not change or
// remove the existing mouse drag-and-drop behavior.
export async function moveDocRank(
  filename: string,
  docType: string,
  direction: 'up' | 'down'
): Promise<void> {
  const group = allDocs.filter((d) => d.docType === docType);
  const insertBeforeFilename = computeMoveTarget(group, filename, direction);
  if (insertBeforeFilename === undefined) return;
  await executeRerankDrop(filename, docType, insertBeforeFilename);
}

// Home/End counterpart to moveDocRank: jumps the focused item straight to the
// top or bottom of its group instead of stepping one position at a time.
// Reuses the same executeRerankDrop() the drag and single-step keyboard paths
// already call, so all three cannot drift (#486).
export async function moveDocRankToEdge(
  filename: string,
  docType: string,
  edge: 'first' | 'last'
): Promise<void> {
  const group = allDocs.filter((d) => d.docType === docType);
  const insertBeforeFilename = computeEdgeMoveTarget(group, filename, edge);
  if (insertBeforeFilename === undefined) return;
  await executeRerankDrop(filename, docType, insertBeforeFilename);
}

export async function executeRerankDrop(
  srcFilename: string,
  srcDocType: string,
  insertBeforeFilename: string | null | undefined
): Promise<void> {
  const group = allDocs.filter((d) => d.docType === srcDocType);
  const orderedFilenames = computeRerankedOrder(group, srcFilename, insertBeforeFilename);
  if (!orderedFilenames) return;

  try {
    await postJSON('/api/docs/rerank', {
      type: srcDocType,
      orderedFilenames,
    });
    // Apply the server's deterministic rank assignment locally right away
    // (see computeRerankedDocs above) rather than waiting for the debounced
    // allDocs reload the rerank broadcast triggers. Without this, a caller
    // that re-renders synchronously right after this resolves — e.g.
    // roadmap-drag.ts's patchStoryColumn — read stale rank order off allDocs
    // and the column didn't visually re-sort even though the move had
    // already persisted; for the roadmap specifically this was effectively
    // permanent, since roadmap.ts doesn't subscribe to the docs:changed
    // event the eventual reload emits. Pre-existing gap, not introduced by
    // this change — the shipped mouse-drag rerank path called this same
    // function and had the identical bug (#486).
    computeRerankedDocs(group, orderedFilenames).forEach((d) => upsertDoc(d));
  } catch (e) {
    showJiraToast('error', (e as Error).message);
  }
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
export function buildSwimlaneMoveAnnouncement(
  title: string,
  label: string,
  movedCount: number
): string {
  return movedCount > 1 ? `Moved ${movedCount} items to ${label}.` : `Moved ${title} to ${label}.`;
}

// Keyboard-operable alternative to the mouse drag-to-swimlane-section move
// (the drop-on-a-.swimlane-section case documented at the top of this file)
// — moves the focused item to the previous/next swimlane section (Current
// PI / Next PI / Backlog, the same order they're rendered in), reusing the
// same executeMoveDrop() the mouse drop handler already calls so the two
// paths cannot drift. Purely additive: does not change or remove the
// existing mouse drag-and-drop behavior (#486).
async function moveDocSwimlaneByKeyboard(
  filename: string,
  docType: string,
  direction: 'prev' | 'next'
): Promise<void> {
  const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
  const title = doc?.title ?? 'Item';
  const currentSection = getSwimlaneSection(doc);
  const targetSection = computeAdjacentSwimlane(currentSection, direction);
  if (targetSection === undefined) {
    _announceListReorderStatus(
      `${title} is already in the ${direction === 'prev' ? 'first' : 'last'} swimlane section.`
    );
    return;
  }

  const targetEl = document.querySelector<HTMLElement>(
    `.swimlane-section[data-section="${targetSection}"]`
  );
  if (!targetEl) return;

  // Captured before executeMoveDrop runs: on success it calls
  // clearSelection(), so the selection driving getDragDocs's multi-item
  // count wouldn't be readable afterward.
  const movedCount = getDragDocs(filename, docType).length;

  const moved = await executeMoveDrop(filename, docType, targetEl);
  if (!moved) return;
  _announceListReorderStatus(
    buildSwimlaneMoveAnnouncement(title, SECTION_LABELS[targetSection], movedCount)
  );
  setTimeout(() => {
    document
      .querySelector<HTMLElement>(
        `.epic-item[data-filename="${CSS.escape(filename)}"] .drag-handle`
      )
      ?.focus();
  }, 200);
}

// Pure: builds the aria-live announcement for a Home/End jump, reusing the
// "Now position N of M" phrasing the single-step ArrowUp/ArrowDown path
// already announces so both keyboard paths read the same way (#486).
export function buildEdgeMoveAnnouncement(
  title: string,
  edge: 'first' | 'last',
  total: number
): string {
  const position = edge === 'first' ? 1 : total;
  return `Moved ${title} to the ${edge === 'first' ? 'top' : 'bottom'}. Now position ${position} of ${total}.`;
}

// Home/End keyboard path: jumps the focused item to the top or bottom of its
// group in one press, instead of holding an arrow key through the whole list.
// Mirrors moveDocSwimlaneByKeyboard's structure — announce-and-stop when the
// move is a no-op, otherwise persist, announce, and restore focus to the
// re-rendered handle (#486).
async function moveDocRankToEdgeByKeyboard(
  filename: string,
  docType: string,
  edge: 'first' | 'last'
): Promise<void> {
  const title = allDocs.find((d) => d.filename === filename)?.title ?? 'Item';
  const group = allDocs.filter((d) => d.docType === docType);

  if (computeEdgeMoveTarget(group, filename, edge) === undefined) {
    _announceListReorderStatus(
      `${title} is already at the ${edge === 'first' ? 'top' : 'bottom'} of the list.`
    );
    return;
  }

  await moveDocRankToEdge(filename, docType, edge);
  _announceListReorderStatus(buildEdgeMoveAnnouncement(title, edge, group.length));
  setTimeout(() => {
    document
      .querySelector<HTMLElement>(
        `.epic-item[data-filename="${CSS.escape(filename)}"] .drag-handle`
      )
      ?.focus();
  }, 200);
}

interface DragState {
  srcFilename: string;
  srcDocType: string;
  startX: number;
  startY: number;
  started: boolean;
  ghost: HTMLElement | null;
  currentTarget: HTMLElement | null;
  currentSwimlane: HTMLElement | null;
  isReranking: boolean;
  rerankInsertBefore: string | null | undefined;
}

// Pure: is a point (relY from the top of a drop-target rect of the given
// height) within the "center zone" — the middle 50% — where dropping
// offers a link/dependency action instead of a rerank/swimlane move?
// Extracted from the near-identical math previously duplicated between
// resolveDropTargets() and the mousemove handler below.
export function isCenterDropZone(relY: number, height: number): boolean {
  return relY > height * 0.25 && relY < height * 0.75;
}

function resolveDropTargets(
  snap: DragState,
  e: MouseEvent
): { dropTarget: HTMLElement | null; dropSwimlane: HTMLElement | null } {
  let dropTarget: HTMLElement | null = null,
    dropSwimlane: HTMLElement | null = null;

  if (snap.started && snap.ghost) {
    snap.ghost.style.visibility = 'hidden';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    snap.ghost.style.visibility = '';

    const itemUnder = elUnder?.closest('.epic-item') as HTMLElement | null;
    if (itemUnder && itemUnder.dataset.filename !== snap.srcFilename) {
      const rect = itemUnder.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      if (isCenterDropZone(relY, rect.height)) dropTarget = itemUnder;
    }

    if (!dropTarget) {
      const sectionUnder = elUnder?.closest('.swimlane-section') as HTMLElement | null;
      if (sectionUnder) {
        const srcDoc = allDocs.find((d) => d.filename === snap.srcFilename);
        const srcLane = getSwimlaneSection(srcDoc);
        if (sectionUnder.dataset.section !== srcLane) dropSwimlane = sectionUnder;
      }
    }
  }

  return {
    dropTarget: dropTarget || snap.currentTarget,
    dropSwimlane: dropSwimlane || snap.currentSwimlane,
  };
}

export function initDragDrop(): void {
  const list = document.getElementById('epic-list');
  if (!list) return;
  let state: DragState | null = null;
  const DRAG_THRESHOLD = 6;

  // Keyboard-operable alternative to the mouse drag above: ArrowUp/ArrowDown
  // on a focused drag handle rerank the item the same way a drag does, and
  // ArrowLeft/ArrowRight move it to the previous/next swimlane section the
  // same way dropping it on a .swimlane-section does (#486) — mirroring
  // roadmap-drag.ts's own up/down-rerank + left/right-cross-sprint-move
  // keyboard split for the roadmap's equivalent card. Focus is restored to
  // the same item's (re-rendered) handle afterward so repeated presses keep
  // working without re-tabbing. Announces the result via the aria-live
  // region above so screen-reader users get the same feedback sighted users
  // get from watching the item move (#486 phase 6/N, generalizing the
  // announcement pattern introduced for canvas link mode). Also handles
  // Ctrl/Cmd+Enter and Shift+Enter on the same handle for building a
  // multi-selection (see the block below) — the mouse-only gap this pass
  // closes: without it a keyboard user could never populate `selectedItems`
  // and so could never reach the multi-item batch context menu.
  list.addEventListener('keydown', (e: KeyboardEvent) => {
    const handle = (e.target as HTMLElement).closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.epic-item') as HTMLElement | null;
    if (!item) return;

    const filename = item.dataset.filename as string;
    const docType = item.dataset.doctype as string;

    // Ctrl/Cmd+Enter and Shift+Enter: keyboard-operable equivalents of
    // Cmd/Ctrl+Click and Shift+Click (list-filters.ts's handleItemClick) —
    // the only way a keyboard-only user can build a multi-selection to
    // reach the (already keyboard-reachable via the browser's native
    // Shift+F10/Menu-key context-menu trigger) batch context menu (#486).
    // Both call the exact same toggleItemSelection()/rangeSelectItems()
    // helpers the mouse path uses, so the two entry points can't drift.
    // Plain Enter does nothing on this handle today (no role=button
    // keydown-to-click shim is wired up for it), so there's nothing to
    // avoid double-triggering here — preventDefault is still applied so a
    // future Enter behavior on this element doesn't fire alongside these.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const title = allDocs.find((d) => d.filename === filename)?.title ?? 'Item';
      const nowSelected = toggleItemSelection(filename, docType);
      const count = selectedItems.size;
      _announceListSelectionStatus(
        nowSelected
          ? `Selected ${title}. ${count} item${count === 1 ? '' : 's'} selected.`
          : `Deselected ${title}. ${count} item${count === 1 ? '' : 's'} selected.`
      );
      return;
    }

    if (e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      if (!_lastClickedItem) {
        _announceListSelectionStatus(
          'No selection to extend. Press Ctrl+Enter (Cmd+Enter on Mac) to start a selection first.'
        );
        return;
      }
      const range = rangeSelectItems(filename, docType);
      const count = selectedItems.size;
      if (!range.length) {
        _announceListSelectionStatus(`Selection unchanged. ${count} item(s) selected.`);
        return;
      }
      if (range.length === 1) {
        const title = allDocs.find((d) => d.filename === range[0].filename)?.title ?? 'Item';
        _announceListSelectionStatus(
          `Selected ${title}. ${count} item${count === 1 ? '' : 's'} selected.`
        );
      } else {
        const startTitle = allDocs.find((d) => d.filename === range[0].filename)?.title ?? 'item';
        const endTitle =
          allDocs.find((d) => d.filename === range[range.length - 1].filename)?.title ?? 'item';
        _announceListSelectionStatus(
          `Selected ${range.length} items from ${startTitle} to ${endTitle}. ${count} item${count === 1 ? '' : 's'} selected.`
        );
      }
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      void moveDocSwimlaneByKeyboard(filename, docType, e.key === 'ArrowLeft' ? 'prev' : 'next');
      return;
    }

    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      void moveDocRankToEdgeByKeyboard(filename, docType, e.key === 'Home' ? 'first' : 'last');
      return;
    }

    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();

    const direction = e.key === 'ArrowUp' ? 'up' : 'down';
    const title = allDocs.find((d) => d.filename === filename)?.title ?? 'Item';
    const group = allDocs.filter((d) => d.docType === docType).sort(_rankSortFn);

    if (computeMoveTarget(group, filename, direction) === undefined) {
      _announceListReorderStatus(
        `${title} is already at the ${direction === 'up' ? 'top' : 'bottom'} of the list.`
      );
      return;
    }

    void moveDocRank(filename, docType, direction).then(() => {
      const newIdx =
        group.findIndex((d) => d.filename === filename) + (direction === 'up' ? -1 : 1);
      _announceListReorderStatus(
        `Moved ${title} ${direction}. Now position ${newIdx + 1} of ${group.length}.`
      );
      setTimeout(() => {
        document
          .querySelector<HTMLElement>(
            `.epic-item[data-filename="${CSS.escape(filename)}"] .drag-handle`
          )
          ?.focus();
      }, 200);
    });
  });

  list.addEventListener('mousedown', (e: MouseEvent) => {
    const handle = (e.target as HTMLElement).closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();
    const item = handle.closest('.epic-item') as HTMLElement | null;
    if (!item) return;

    state = {
      srcFilename: item.dataset.filename as string,
      srcDocType: item.dataset.doctype as string,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      ghost: null,
      currentTarget: null,
      currentSwimlane: null,
      isReranking: false,
      rerankInsertBefore: undefined,
    };
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!state) return;

    if (!state.started) {
      const dx = Math.abs(e.clientX - state.startX);
      const dy = Math.abs(e.clientY - state.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;

      state.started = true;
      _justDragged = true;

      const dragDocs = getDragDocs(state.srcFilename, state.srcDocType);
      const multiCount = dragDocs.length;

      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      if (multiCount > 1) {
        const countBadge = document.createElement('span');
        countBadge.className = 'drag-count-badge';
        countBadge.textContent = String(multiCount);
        ghost.appendChild(countBadge);
        ghost.appendChild(document.createTextNode(`${multiCount} items`));
      } else {
        const badge = document.createElement('span');
        badge.className = `type-badge ${state.srcDocType}`;
        badge.textContent = TYPE_LABEL[state.srcDocType] || state.srcDocType;
        ghost.appendChild(badge);
        ghost.appendChild(
          document.createTextNode(
            allDocs.find((d) => d.filename === state!.srcFilename)?.title || state.srcFilename
          )
        );
      }
      document.body.appendChild(ghost);
      state.ghost = ghost;

      if (multiCount > 1) {
        for (const d of dragDocs) {
          const el = list.querySelector(
            `[data-filename="${CSS.escape(d.filename)}"][data-doctype="${d.docType}"]`
          );
          if (el) el.classList.add('drag-source');
        }
      } else {
        const srcItem = list.querySelector(`[data-filename="${CSS.escape(state.srcFilename)}"]`);
        if (srcItem) srcItem.classList.add('drag-source');
      }
      list.classList.add('dragging-active');
      document.body.style.userSelect = 'none';
    }

    state.ghost!.style.left = `${e.clientX + 14}px`;
    state.ghost!.style.top = `${e.clientY + 10}px`;

    state.ghost!.style.visibility = 'hidden';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    state.ghost!.style.visibility = '';

    list
      .querySelectorAll('.drag-target-hover')
      .forEach((el) => el.classList.remove('drag-target-hover'));
    list
      .querySelectorAll('.swimlane-drop-target')
      .forEach((el) => el.classList.remove('swimlane-drop-target'));
    state.currentTarget = null;
    state.currentSwimlane = null;
    state.isReranking = false;
    state.rerankInsertBefore = undefined;

    // ── Zone detection ──────────────────────────────────────────
    const targetItem = elUnder?.closest('.epic-item') as HTMLElement | null;
    if (targetItem && targetItem.dataset.filename !== state.srcFilename) {
      const rect = targetItem.getBoundingClientRect();
      const relY = e.clientY - rect.top;

      if (isCenterDropZone(relY, rect.height)) {
        // Center of a valid target → highlight for action popup
        targetItem.classList.add('drag-target-hover');
        state.currentTarget = targetItem;
        hideInsertionMarker();
        return;
      }
    }

    // Not on a center-zone target → check swimlane or rerank
    const swimlaneSection = elUnder?.closest('.swimlane-section') as HTMLElement | null;
    if (swimlaneSection) {
      const srcDoc = allDocs.find((d) => d.filename === state!.srcFilename);
      const srcLane = getSwimlaneSection(srcDoc);
      if (swimlaneSection.dataset.section !== srcLane) {
        // Different swimlane → PI move
        swimlaneSection.classList.add('swimlane-drop-target');
        state.currentSwimlane = swimlaneSection;
        hideInsertionMarker();
      } else {
        // Same swimlane → rerank
        state.isReranking = true;
        state.rerankInsertBefore = computeInsertBefore(state.srcDocType, e.clientY);
        showInsertionMarker(e.clientY);
      }
    } else {
      hideInsertionMarker();
    }
  });

  document.addEventListener('mouseup', async (e: MouseEvent) => {
    if (!state) return;
    const snap = state;
    state = null;

    const { dropTarget, dropSwimlane } = resolveDropTargets(snap, e);

    if (snap.ghost) snap.ghost.remove();
    hideInsertionMarker();
    list.classList.remove('dragging-active');
    list.querySelectorAll('.drag-source, .drag-target-hover').forEach((el) => {
      el.classList.remove('drag-source', 'drag-target-hover');
    });
    list
      .querySelectorAll('.swimlane-drop-target')
      .forEach((el) => el.classList.remove('swimlane-drop-target'));
    document.body.style.userSelect = '';

    setTimeout(() => {
      _justDragged = false;
    }, 150);

    if (!snap.started) return;

    if (dropTarget)
      return showDropActionPopup(
        snap.srcFilename,
        snap.srcDocType,
        dropTarget,
        e.clientX,
        e.clientY
      );
    if (dropSwimlane) return executeMoveDrop(snap.srcFilename, snap.srcDocType, dropSwimlane);
    if (snap.isReranking)
      return executeRerankDrop(snap.srcFilename, snap.srcDocType, snap.rerankInsertBefore);
  });
}
