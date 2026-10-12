// ── Drag-and-drop: rank (priority) reordering ────────────────────────────────
// Split out of dragdrop.ts (#699): insertion marker, per-type/selection rank
// moves and the rerank drop, plus the shared aria-live announcers.
import { postJSON, showJiraToast, upsertDoc } from './state.js';
import {
  computeRerankedOrder,
  computeRerankedDocs,
  computeSelectionMove,
  computeMoveTarget,
  computeEdgeMoveTarget,
  buildSelectionMoveAnnouncement,
} from './dragdrop-core.js';
// No aria-live region existed for list reorder before this; adds one,
// visually hidden but announced to screen readers, following the same
// lazily-created/appended-to-body convention introduced for canvas link
// mode (#486 phase 4/N, refine-canvas.ts's _canvasLinkStatusRegion).
function _listReorderStatusRegion() {
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
export function _announceListReorderStatus(message) {
  _listReorderStatusRegion().textContent = message;
}
// Same lazily-created aria-live region as _announceListReorderStatus above,
// just named for its own call sites (Ctrl/Cmd+Enter toggle and Shift+Enter
// range-select below, #486) — the backlog list only needs one polite status
// region, no reason to create a second DOM node for it.
export function _announceListSelectionStatus(message) {
  _listReorderStatusRegion().textContent = message;
}
// ── Insertion marker (rerank visual indicator) ────────────────
let _insertionMarker = null;
export function getInsertionMarker() {
  if (!_insertionMarker) {
    _insertionMarker = document.createElement('div');
    _insertionMarker.className = 'rank-insert-line';
    document.body.appendChild(_insertionMarker);
  }
  return _insertionMarker;
}
export function showInsertionMarker(clientY) {
  const list = document.getElementById('epic-list');
  if (!list) return;
  const listRect = list.getBoundingClientRect();
  const marker = getInsertionMarker();
  marker.style.display = 'block';
  marker.style.top = `${clientY - 1}px`;
  marker.style.left = `${listRect.left + 4}px`;
  marker.style.width = `${listRect.width - 8}px`;
}
export function hideInsertionMarker() {
  if (_insertionMarker) _insertionMarker.style.display = 'none';
}
// Returns the filename of the item the cursor is ABOVE (insert before it),
// or null to insert at the end of the type group.
export function computeInsertBefore(srcDocType, clientY) {
  const items = [...document.querySelectorAll('#epic-list .epic-item')].filter(
    (el) => el.dataset.doctype === srcDocType && !el.classList.contains('drag-source')
  );
  for (const el of items) {
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return el.dataset.filename;
  }
  return null; // insert at end
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
export async function moveSelectionRank(selected, action) {
  const byType = new Map();
  for (const { filename, docType } of selected) {
    if (!byType.has(docType)) byType.set(docType, new Set());
    byType.get(docType).add(filename);
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
      showJiraToast('error', e.message);
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
          .querySelector(`.epic-item[data-filename="${CSS.escape(anchor)}"] .drag-handle`)
          ?.focus();
      }, 200);
    }
  } else if (!erroredAny) {
    const edge = action === 'up' || action === 'top' ? 'top' : 'bottom';
    _announceListReorderStatus(`Selection is already at the ${edge} of the list.`);
  }
}
// Single-item, per-type reorder shared by the roadmap epic/story context
// menus. Operates on the full `allDocs` group of the item's own docType — the
// same proven ordering the backlog multi-select move uses — instead of the
// on-screen card order. The roadmap previously derived adjacency from the
// visible `.rm-epic-card` / `.roadmap-card` list, which mixed feature, epic and
// the "__none__" bucket rows; when an edge/neighbour row was a different type
// its filename wasn't in the per-type group, findIndex returned -1, and "move
// to bottom" collapsed to index 0 (top) while up/down silently no-op'd. Going
// through computeSelectionMove on the per-type group removes that whole class
// of bug. Returns true when a move was persisted, false on a no-op edge.
export async function moveRankByType(filename, docType, action) {
  const group = allDocs.filter((d) => d.docType === docType);
  const orderedFilenames = computeSelectionMove(group, new Set([filename]), action);
  if (!orderedFilenames) return false;
  await postJSON('/api/docs/rerank', { type: docType, orderedFilenames });
  computeRerankedDocs(group, orderedFilenames).forEach((d) => upsertDoc(d));
  return true;
}
// Keyboard-operable alternative to the mouse-drag rerank above — swaps the
// focused item with its immediate rank-order neighbor of the same docType
// and persists it the same way a drag-and-drop rerank does. Purely additive:
// calls the same executeRerankDrop() the drag handler already uses, so the
// visual reorder happens the same way (via the debounced allDocs reload
// triggered by the server's rerank broadcast), and does not change or
// remove the existing mouse drag-and-drop behavior.
export async function moveDocRank(filename, docType, direction) {
  const group = allDocs.filter((d) => d.docType === docType);
  const insertBeforeFilename = computeMoveTarget(group, filename, direction);
  if (insertBeforeFilename === undefined) return;
  await executeRerankDrop(filename, docType, insertBeforeFilename);
}
// Home/End counterpart to moveDocRank: jumps the focused item straight to the
// top or bottom of its group instead of stepping one position at a time.
// Reuses the same executeRerankDrop() the drag and single-step keyboard paths
// already call, so all three cannot drift (#486).
export async function moveDocRankToEdge(filename, docType, edge) {
  const group = allDocs.filter((d) => d.docType === docType);
  const insertBeforeFilename = computeEdgeMoveTarget(group, filename, edge);
  if (insertBeforeFilename === undefined) return;
  await executeRerankDrop(filename, docType, insertBeforeFilename);
}
export async function executeRerankDrop(srcFilename, srcDocType, insertBeforeFilename) {
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
    showJiraToast('error', e.message);
  }
}
//# sourceMappingURL=dragdrop-rank.js.map
