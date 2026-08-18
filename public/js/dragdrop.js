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
} from './state.js';
import { loadHierarchy } from './detail-links.js';
import { clearSelection, itemKey, getSelectedDocs, applyFilters } from './list-filters.js';
import { _rankSortFn } from './list-render.js';
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
function _announceListReorderStatus(message) {
  _listReorderStatusRegion().textContent = message;
}
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
let _dropPopup = null;
let _pendingDropSrc = null;
let _pendingDropTgt = null;
let _escListener = null;
export function showDropActionPopup(srcFilename, srcDocType, targetEl, cursorX, cursorY) {
  hideDropActionPopup();
  const tgtFilename = targetEl.dataset.filename;
  const tgtDocType = targetEl.dataset.doctype;
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
  _escListener = (e) => {
    if (e.key === 'Escape') hideDropActionPopup();
  };
  document.addEventListener('keydown', _escListener);
}
export function hideDropActionPopup() {
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
async function executeDropLink() {
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
      loadHierarchy(currentFilename, currentDocType);
    }
  } catch (err) {
    showJiraToast('error', err.message);
  }
}
async function executeDropDep() {
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
    showJiraToast('error', err.message);
  }
}
// Returns whether the move actually happened (false on a missing-PI-version
// precondition failure or a request error) — used by the keyboard-operable
// alternative below so it only announces "Moved" via aria-live when the move
// really succeeded, instead of duplicating this function's own precondition
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
// Returns the docs being dragged — either the multi-selection or just the single item
function getDragDocs(srcFilename, srcDocType) {
  const key = itemKey(srcFilename, srcDocType);
  if (selectedItems.size > 1 && selectedItems.has(key)) {
    return getSelectedDocs();
  }
  const doc = allDocs.find((d) => d.filename === srcFilename && d.docType === srcDocType);
  return doc ? [doc] : [];
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
function computeInsertBefore(srcDocType, clientY) {
  const items = [...document.querySelectorAll('#epic-list .epic-item')].filter(
    (el) => el.dataset.doctype === srcDocType && !el.classList.contains('drag-source')
  );
  for (const el of items) {
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return el.dataset.filename;
  }
  return null; // insert at end
}
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
export async function executeRerankDrop(srcFilename, srcDocType, insertBeforeFilename) {
  const group = allDocs.filter((d) => d.docType === srcDocType);
  const orderedFilenames = computeRerankedOrder(group, srcFilename, insertBeforeFilename);
  if (!orderedFilenames) return;
  try {
    await postJSON('/api/docs/rerank', {
      type: srcDocType,
      orderedFilenames,
    });
  } catch (e) {
    showJiraToast('error', e.message);
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
  const moved = await executeMoveDrop(filename, docType, targetEl);
  if (!moved) return;
  _announceListReorderStatus(`Moved ${title} to ${SECTION_LABELS[targetSection]}.`);
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
      const inCenter = relY > rect.height * 0.25 && relY < rect.height * 0.75;
      const tgtType = itemUnder.dataset.doctype;
      const canLink = (DRAG_TARGETS[snap.srcDocType] || []).includes(tgtType);
      const canDep = !canLink;
      if (inCenter && (canLink || canDep)) dropTarget = itemUnder;
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
  // announcement pattern introduced for canvas link mode).
  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.epic-item');
    if (!item) return;
    const filename = item.dataset.filename;
    const docType = item.dataset.doctype;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      void moveDocSwimlaneByKeyboard(filename, docType, e.key === 'ArrowLeft' ? 'prev' : 'next');
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
      const inCenter = relY > rect.height * 0.25 && relY < rect.height * 0.75;
      const tgtType = targetItem.dataset.doctype;
      const canLink = (DRAG_TARGETS[state.srcDocType] || []).includes(tgtType);
      const canDep = !canLink;
      if (inCenter && (canLink || canDep)) {
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
//# sourceMappingURL=dragdrop.js.map
