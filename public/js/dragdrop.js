// ── Drag-and-drop: linking + swimlane moves + priority reordering ────────────
// Three coexisting operations based on drop zone:
//   - Drop ON item center (middle 50% of height) → action popup (link or dep)
//   - Drop on item edge / between items          → RERANK (insertion line)
//   - Drop on a .swimlane-section (different)    → MOVE to that PI
//
// Uses mouse events (not HTML5 DnD) for reliable cross-browser behaviour.

const LEAF_TYPES = new Set(['story', 'spike', 'bug']);

function getSwimlaneSection(doc) {
  if (!doc) return 'backlog';
  if (doc.fixVersion && piSettings.currentPi && doc.fixVersion === piSettings.currentPi) return 'currentPi';
  if (doc.fixVersion && piSettings.nextPi && doc.fixVersion === piSettings.nextPi) return 'nextPi';
  return 'backlog';
}

function sectionToFixVersion(section) {
  if (section === 'currentPi') return piSettings.currentPi;
  if (section === 'nextPi')    return piSettings.nextPi;
  return null; // backlog = clear version
}

const SECTION_LABELS = { currentPi: 'Current PI', nextPi: 'Next PI', backlog: 'Backlog' };

// ── Drop action popup ─────────────────────────────────────────
let _dropPopup    = null;
let _pendingDropSrc = null; // { filename, docType }
let _pendingDropTgt = null; // { filename, docType }
let _escListener  = null;

function showDropActionPopup(srcFilename, srcDocType, targetEl, cursorX, cursorY) {
  hideDropActionPopup();

  const tgtFilename = targetEl.dataset.filename;
  const tgtDocType  = targetEl.dataset.doctype;
  const tgtTitle    = targetEl.querySelector('.epic-title-text')?.textContent
                   || targetEl.querySelector('.roadmap-card-title')?.textContent
                   || tgtFilename;

  const canLink = (DRAG_TARGETS[srcDocType] || []).includes(tgtDocType);
  const canDep  = LEAF_TYPES.has(srcDocType) && LEAF_TYPES.has(tgtDocType);

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
    btn.addEventListener('click', e => { e.stopPropagation(); executeDropLink(); });
    popup.appendChild(btn);
  }

  if (canDep) {
    const btn = document.createElement('button');
    btn.className = 'drop-action-btn drop-dep-btn';
    btn.innerHTML = '<span class="drop-action-btn-icon">🔒</span><span>Add dependency</span>';
    btn.addEventListener('click', e => { e.stopPropagation(); executeDropDep(); });
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
  _dropPopup = popup;

  // Position near cursor, clamped to viewport
  const pw = popup.offsetWidth  || 220;
  const ph = popup.offsetHeight || 90;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(cursorX + 12, vw - pw - 12);
  const top  = Math.min(cursorY - 10, vh - ph - 12);
  popup.style.left = `${Math.max(8, left)}px`;
  popup.style.top  = `${Math.max(8, top)}px`;

  // Dismiss on outside click
  setTimeout(() => {
    document.addEventListener('click', hideDropActionPopup, { once: true });
  }, 0);

  // Dismiss on Escape
  _escListener = e => { if (e.key === 'Escape') hideDropActionPopup(); };
  document.addEventListener('keydown', _escListener);
}

function hideDropActionPopup() {
  if (_dropPopup) { _dropPopup.remove(); _dropPopup = null; }
  if (_escListener) { document.removeEventListener('keydown', _escListener); _escListener = null; }
  _pendingDropSrc = null;
  _pendingDropTgt = null;
}

async function executeDropLink() {
  if (!_pendingDropSrc || !_pendingDropTgt) return;
  const src = _pendingDropSrc;
  const tgt = _pendingDropTgt;
  hideDropActionPopup();

  const tgtEl    = document.querySelector(`#epic-list [data-filename="${CSS.escape(tgt.filename)}"]`);
  const tgtTitle = tgtEl?.querySelector('.epic-title-text')?.textContent || tgt.filename;
  const dragDocs = getDragDocs(src.filename, src.docType);

  try {
    let linked = 0;
    for (const d of dragDocs) {
      const valid = DRAG_TARGETS[d.docType] || [];
      if (!valid.includes(tgt.docType)) continue;
      await postJSON('/api/link', {
        sourceType: d.docType, sourceFilename: d.filename,
        targetType: tgt.docType, targetFilename: tgt.filename,
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

  const tgtEl    = document.querySelector(`#epic-list [data-filename="${CSS.escape(tgt.filename)}"]`);
  const tgtTitle = tgtEl?.querySelector('.epic-title-text')?.textContent || tgt.filename;

  try {
    await postJSON('/api/link', {
      linkType: 'blocks',
      sourceType: src.docType, sourceFilename: src.filename,
      targetType: tgt.docType, targetFilename: tgt.filename,
    });
    // Update allDocs entries optimistically
    const srcDoc = allDocs.find(d => d.filename === src.filename);
    if (srcDoc) { srcDoc.blocks = srcDoc.blocks || []; if (!srcDoc.blocks.includes(tgt.filename)) srcDoc.blocks.push(tgt.filename); }
    const tgtDoc = allDocs.find(d => d.filename === tgt.filename);
    if (tgtDoc) { tgtDoc.blockedBy = tgtDoc.blockedBy || []; if (!tgtDoc.blockedBy.includes(src.filename)) tgtDoc.blockedBy.push(src.filename); }
    applyFilters();
    showJiraToast('success', `"${allDocs.find(d=>d.filename===src.filename)?.title||src.filename}" now blocks "${tgtTitle}"`);
  } catch (err) {
    showJiraToast('error', err.message);
  }
}

// ── Existing drop actions ─────────────────────────────────────
async function executeLinkDrop(srcFilename, srcDocType, dropTarget) {
  const tgtFilename = dropTarget.dataset.filename;
  const tgtDocType  = dropTarget.dataset.doctype;
  const tgtTitle    = dropTarget.querySelector('.epic-title-text')?.textContent || tgtFilename;

  const dragDocs = getDragDocs(srcFilename, srcDocType);

  try {
    let linked = 0;
    for (const d of dragDocs) {
      const valid = DRAG_TARGETS[d.docType] || [];
      if (!valid.includes(tgtDocType)) continue;
      await postJSON('/api/link', {
        sourceType: d.docType, sourceFilename: d.filename,
        targetType: tgtDocType, targetFilename: tgtFilename,
      });
      linked++;
    }

    const msg = linked > 1 ? `Linked ${linked} items to "${tgtTitle}"` : `Linked to "${tgtTitle}"`;
    showJiraToast('success', msg);
    clearSelection();
    if (currentFilename === srcFilename || currentFilename === tgtFilename) {
      loadHierarchy(currentFilename, currentDocType);
    }
  } catch (err) {
    showJiraToast('error', err.message);
  }
}

async function executeMoveDrop(srcFilename, srcDocType, dropSwimlane) {
  const targetSection = dropSwimlane.dataset.section;
  const newFixVersion = sectionToFixVersion(targetSection);

  if (targetSection !== 'backlog' && !newFixVersion) {
    showJiraToast('error', `Set a version for ${SECTION_LABELS[targetSection]} first`);
    return;
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
      docs: allToMove.map(d => ({ type: d.docType, filename: d.filename })),
    });

    const label    = SECTION_LABELS[targetSection];
    const countMsg = allToMove.length > 1 ? ` (${allToMove.length} items)` : '';
    showJiraToast('success', `Moved to ${label}${countMsg}`);
    clearSelection();
  } catch (err) {
    showJiraToast('error', err.message);
  }
}

// Returns the docs being dragged — either the multi-selection or just the single item
function getDragDocs(srcFilename, srcDocType) {
  const key = itemKey(srcFilename, srcDocType);
  if (selectedItems.size > 1 && selectedItems.has(key)) {
    return getSelectedDocs();
  }
  const doc = allDocs.find(d => d.filename === srcFilename && d.docType === srcDocType);
  return doc ? [doc] : [];
}

// ── Insertion marker (rerank visual indicator) ────────────────
let _insertionMarker = null;

function getInsertionMarker() {
  if (!_insertionMarker) {
    _insertionMarker = document.createElement('div');
    _insertionMarker.className = 'rank-insert-line';
    document.body.appendChild(_insertionMarker);
  }
  return _insertionMarker;
}

function showInsertionMarker(clientY) {
  const list = document.getElementById('epic-list');
  if (!list) return;
  const listRect = list.getBoundingClientRect();
  const marker   = getInsertionMarker();
  marker.style.display = 'block';
  marker.style.top     = `${clientY - 1}px`;
  marker.style.left    = `${listRect.left + 4}px`;
  marker.style.width   = `${listRect.width - 8}px`;
}

function hideInsertionMarker() {
  if (_insertionMarker) _insertionMarker.style.display = 'none';
}

// Returns the filename of the item the cursor is ABOVE (insert before it),
// or null to insert at the end of the type group.
function computeInsertBefore(srcDocType, clientY) {
  const items = [...document.querySelectorAll('#epic-list .epic-item')]
    .filter(el => el.dataset.doctype === srcDocType && !el.classList.contains('drag-source'));

  for (const el of items) {
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return el.dataset.filename;
  }
  return null; // insert at end
}

async function executeRerankDrop(srcFilename, srcDocType, insertBeforeFilename) {
  const group  = allDocs.filter(d => d.docType === srcDocType);
  const sorted = [...group].sort(_rankSortFn);

  const draggedIdx = sorted.findIndex(d => d.filename === srcFilename);
  if (draggedIdx < 0) return;

  const [dragged] = sorted.splice(draggedIdx, 1);

  let insertIdx = sorted.length; // default: end
  if (insertBeforeFilename) {
    const targetIdx = sorted.findIndex(d => d.filename === insertBeforeFilename);
    if (targetIdx >= 0) insertIdx = targetIdx;
  }
  sorted.splice(insertIdx, 0, dragged);

  try {
    await postJSON('/api/docs/rerank', { type: srcDocType, orderedFilenames: sorted.map(d => d.filename) });
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

function resolveDropTargets(snap, e) {
  let dropTarget = null, dropSwimlane = null;

  if (snap.started && snap.ghost) {
    snap.ghost.style.visibility = 'hidden';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    snap.ghost.style.visibility = '';

    const itemUnder = elUnder?.closest('.epic-item');
    if (itemUnder && itemUnder.dataset.filename !== snap.srcFilename) {
      const rect     = itemUnder.getBoundingClientRect();
      const relY     = e.clientY - rect.top;
      const inCenter = relY > rect.height * 0.25 && relY < rect.height * 0.75;
      const tgtType  = itemUnder.dataset.doctype;
      const canLink  = (DRAG_TARGETS[snap.srcDocType] || []).includes(tgtType);
      const canDep   = LEAF_TYPES.has(snap.srcDocType) && LEAF_TYPES.has(tgtType);
      if (inCenter && (canLink || canDep)) dropTarget = itemUnder;
    }

    if (!dropTarget) {
      const sectionUnder = elUnder?.closest('.swimlane-section');
      if (sectionUnder) {
        const srcDoc  = allDocs.find(d => d.filename === snap.srcFilename);
        const srcLane = getSwimlaneSection(srcDoc);
        if (sectionUnder.dataset.section !== srcLane) dropSwimlane = sectionUnder;
      }
    }
  }

  return {
    dropTarget:   dropTarget   || snap.currentTarget,
    dropSwimlane: dropSwimlane || snap.currentSwimlane,
  };
}

function initDragDrop() {
  const list = document.getElementById('epic-list');
  let state = null;
  const DRAG_THRESHOLD = 6;

  list.addEventListener('mousedown', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();
    const item = handle.closest('.epic-item');
    if (!item) return;

    state = {
      srcFilename: item.dataset.filename, srcDocType: item.dataset.doctype,
      startX: e.clientX, startY: e.clientY,
      started: false, ghost: null, currentTarget: null, currentSwimlane: null,
      isReranking: false, rerankInsertBefore: undefined,
    };
  });

  document.addEventListener('mousemove', e => {
    if (!state) return;

    if (!state.started) {
      const dx = Math.abs(e.clientX - state.startX);
      const dy = Math.abs(e.clientY - state.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;

      state.started = true;
      _justDragged = true;

      const dragDocs   = getDragDocs(state.srcFilename, state.srcDocType);
      const multiCount = dragDocs.length;

      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      if (multiCount > 1) {
        const countBadge = document.createElement('span');
        countBadge.className = 'drag-count-badge';
        countBadge.textContent = multiCount;
        ghost.appendChild(countBadge);
        ghost.appendChild(document.createTextNode(`${multiCount} items`));
      } else {
        const badge = document.createElement('span');
        badge.className = `type-badge ${state.srcDocType}`;
        badge.textContent = TYPE_LABEL[state.srcDocType] || state.srcDocType;
        ghost.appendChild(badge);
        ghost.appendChild(document.createTextNode(
          allDocs.find(d => d.filename === state.srcFilename)?.title || state.srcFilename
        ));
      }
      document.body.appendChild(ghost);
      state.ghost = ghost;

      if (multiCount > 1) {
        for (const d of dragDocs) {
          const el = list.querySelector(`[data-filename="${CSS.escape(d.filename)}"][data-doctype="${d.docType}"]`);
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
    state.ghost.style.top  = `${e.clientY + 10}px`;

    state.ghost.style.visibility = 'hidden';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    state.ghost.style.visibility = '';

    list.querySelectorAll('.drag-target-hover').forEach(el => el.classList.remove('drag-target-hover'));
    list.querySelectorAll('.swimlane-drop-target').forEach(el => el.classList.remove('swimlane-drop-target'));
    state.currentTarget      = null;
    state.currentSwimlane    = null;
    state.isReranking        = false;
    state.rerankInsertBefore = undefined;

    // ── Zone detection ──────────────────────────────────────────
    const targetItem = elUnder?.closest('.epic-item');
    if (targetItem && targetItem.dataset.filename !== state.srcFilename) {
      const rect     = targetItem.getBoundingClientRect();
      const relY     = e.clientY - rect.top;
      const inCenter = relY > rect.height * 0.25 && relY < rect.height * 0.75;
      const tgtType  = targetItem.dataset.doctype;
      const canLink  = (DRAG_TARGETS[state.srcDocType] || []).includes(tgtType);
      const canDep   = LEAF_TYPES.has(state.srcDocType) && LEAF_TYPES.has(tgtType);

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
      const srcDoc  = allDocs.find(d => d.filename === state.srcFilename);
      const srcLane = getSwimlaneSection(srcDoc);
      if (swimlaneSection.dataset.section !== srcLane) {
        // Different swimlane → PI move
        swimlaneSection.classList.add('swimlane-drop-target');
        state.currentSwimlane = swimlaneSection;
        hideInsertionMarker();
      } else {
        // Same swimlane → rerank
        state.isReranking        = true;
        state.rerankInsertBefore = computeInsertBefore(state.srcDocType, e.clientY);
        showInsertionMarker(e.clientY);
      }
    } else {
      hideInsertionMarker();
    }
  });

  document.addEventListener('mouseup', async e => {
    if (!state) return;
    const snap = state;
    state = null;

    const { dropTarget, dropSwimlane } = resolveDropTargets(snap, e);

    if (snap.ghost) snap.ghost.remove();
    hideInsertionMarker();
    list.classList.remove('dragging-active');
    list.querySelectorAll('.drag-source, .drag-target-hover').forEach(el => {
      el.classList.remove('drag-source', 'drag-target-hover');
    });
    list.querySelectorAll('.swimlane-drop-target').forEach(el => el.classList.remove('swimlane-drop-target'));
    document.body.style.userSelect = '';

    setTimeout(() => { _justDragged = false; }, 150);

    if (!snap.started) return;

    if (dropTarget)       return showDropActionPopup(snap.srcFilename, snap.srcDocType, dropTarget, e.clientX, e.clientY);
    if (dropSwimlane)     return executeMoveDrop(snap.srcFilename, snap.srcDocType, dropSwimlane);
    if (snap.isReranking) return executeRerankDrop(snap.srcFilename, snap.srcDocType, snap.rerankInsertBefore);
  });
}
