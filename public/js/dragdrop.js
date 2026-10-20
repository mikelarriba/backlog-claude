// ── Drag-and-drop: linking + swimlane moves + priority reordering ────────────
// Three coexisting operations based on drop zone:
//   - Drop ON item center (middle 50% of height) → action popup (link or dep)
//   - Drop on item edge / between items          → RERANK (insertion line)
//   - Drop on a .swimlane-section (different)    → MOVE to that PI
//
// Uses mouse events (not HTML5 DnD) for reliable cross-browser behaviour.
import { _rankSortFn } from './list-render.js';
import {
  buildChildrenMap,
  getDescendants,
  postJSON,
  showJiraToast,
  TYPE_LABEL,
  SECTION_LABELS,
} from './state.js';
import { setJustDragged } from './state.js';
import {
  clearSelection,
  toggleItemSelection,
  rangeSelectItems,
  hasSelectionAnchor,
} from './list-filters.js';
import {
  computeRerankedOrder,
  computeRerankedDocs,
  computeMoveTarget,
  computeEdgeMoveTarget,
  computeSelectionMove,
  buildSelectionMoveAnnouncement,
  computeAdjacentSwimlane,
  buildSwimlaneMoveAnnouncement,
  buildEdgeMoveAnnouncement,
  isCenterDropZone,
  computeDropPopupPosition,
} from './dragdrop-core.js';
import {
  _announceListReorderStatus,
  _announceListSelectionStatus,
  getInsertionMarker,
  showInsertionMarker,
  hideInsertionMarker,
  computeInsertBefore,
  moveSelectionRank,
  moveRankByType,
  moveDocRank,
  moveDocRankToEdge,
  executeRerankDrop,
} from './dragdrop-rank.js';
import {
  computeDropActionOptions,
  showDropActionPopup,
  hideDropActionPopup,
  getDragDocs,
} from './dragdrop-popup.js';
export {
  getInsertionMarker,
  showInsertionMarker,
  hideInsertionMarker,
  moveSelectionRank,
  moveRankByType,
  moveDocRank,
  moveDocRankToEdge,
  executeRerankDrop,
  computeDropActionOptions,
  showDropActionPopup,
  hideDropActionPopup,
  computeRerankedOrder,
  computeRerankedDocs,
  computeMoveTarget,
  computeEdgeMoveTarget,
  computeSelectionMove,
  buildSelectionMoveAnnouncement,
  computeAdjacentSwimlane,
  buildSwimlaneMoveAnnouncement,
  buildEdgeMoveAnnouncement,
  isCenterDropZone,
  computeDropPopupPosition,
};
export function getSwimlaneSection(doc) {
  if (!doc) return 'backlog';
  if (doc.fixVersion && piSettings.currentPi && doc.fixVersion === piSettings.currentPi)
    return 'currentPi';
  if (doc.fixVersion && piSettings.nextPi && doc.fixVersion === piSettings.nextPi) return 'nextPi';
  return 'backlog';
}
export function sectionToFixVersion(section) {
  if (section === 'currentPi') return piSettings.currentPi;
  if (section === 'nextPi') return piSettings.nextPi;
  return null; // backlog = clear version
}
// check (#486).
async function executeMoveDrop(srcFilename, srcDocType, dropSwimlane) {
  const targetSection = dropSwimlane.dataset.section;
  const newFixVersion = sectionToFixVersion(targetSection);
  if (targetSection !== 'backlog' && !newFixVersion) {
    showJiraToast('error', `Set a version for ${SECTION_LABELS[targetSection]} first`);
    return false;
  }
  const dragDocs = getDragDocs(srcFilename, srcDocType);
  const childrenMap = buildChildrenMap(allDocs);
  const allToMove = [];
  const seen = new Set();
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
    showJiraToast('error', err.message);
    return false;
  }
}
// Keyboard-operable alternative to the mouse drag-to-swimlane-section move
// (the drop-on-a-.swimlane-section case documented at the top of this file)
// — moves the focused item to the previous/next swimlane section (Current
// PI / Next PI / Backlog, the same order they're rendered in), reusing the
// same executeMoveDrop() the mouse drop handler already calls so the two
// paths cannot drift. Purely additive: does not change or remove the
// existing mouse drag-and-drop behavior (#486).
async function moveDocSwimlaneByKeyboard(filename, docType, direction) {
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
  const targetEl = document.querySelector(`.swimlane-section[data-section="${targetSection}"]`);
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
      .querySelector(`.epic-item[data-filename="${CSS.escape(filename)}"] .drag-handle`)
      ?.focus();
  }, 200);
}
// Home/End keyboard path: jumps the focused item to the top or bottom of its
// group in one press, instead of holding an arrow key through the whole list.
// Mirrors moveDocSwimlaneByKeyboard's structure — announce-and-stop when the
// move is a no-op, otherwise persist, announce, and restore focus to the
// re-rendered handle (#486).
async function moveDocRankToEdgeByKeyboard(filename, docType, edge) {
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
      .querySelector(`.epic-item[data-filename="${CSS.escape(filename)}"] .drag-handle`)
      ?.focus();
  }, 200);
}
function resolveDropTargets(snap, e) {
  let dropTarget = null,
    dropSwimlane = null;
  if (snap.started && snap.ghost) {
    snap.ghost.style.visibility = 'hidden';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    snap.ghost.style.visibility = '';
    const itemUnder = elUnder?.closest('.epic-item');
    if (itemUnder && itemUnder.dataset.filename !== snap.srcFilename) {
      const rect = itemUnder.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      if (isCenterDropZone(relY, rect.height)) dropTarget = itemUnder;
    }
    if (!dropTarget) {
      const sectionUnder = elUnder?.closest('.swimlane-section');
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
export function initDragDrop() {
  const list = document.getElementById('epic-list');
  if (!list) return;
  let state = null;
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
  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.epic-item');
    if (!item) return;
    const filename = item.dataset.filename;
    const docType = item.dataset.doctype;
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
      if (!hasSelectionAnchor()) {
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
          .querySelector(`.epic-item[data-filename="${CSS.escape(filename)}"] .drag-handle`)
          ?.focus();
      }, 200);
    });
  });
  list.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();
    const item = handle.closest('.epic-item');
    if (!item) return;
    state = {
      srcFilename: item.dataset.filename,
      srcDocType: item.dataset.doctype,
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
  document.addEventListener('mousemove', (e) => {
    if (!state) return;
    if (!state.started) {
      const dx = Math.abs(e.clientX - state.startX);
      const dy = Math.abs(e.clientY - state.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      state.started = true;
      setJustDragged(true);
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
            allDocs.find((d) => d.filename === state.srcFilename)?.title || state.srcFilename
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
    state.ghost.style.left = `${e.clientX + 14}px`;
    state.ghost.style.top = `${e.clientY + 10}px`;
    state.ghost.style.visibility = 'hidden';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    state.ghost.style.visibility = '';
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
    const targetItem = elUnder?.closest('.epic-item');
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
    const swimlaneSection = elUnder?.closest('.swimlane-section');
    if (swimlaneSection) {
      const srcDoc = allDocs.find((d) => d.filename === state.srcFilename);
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
  document.addEventListener('mouseup', async (e) => {
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
      setJustDragged(false);
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
//# sourceMappingURL=dragdrop.js.map
