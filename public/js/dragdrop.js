// ── Drag-and-drop: linking + swimlane moves ──────────────────
// Two coexisting operations based on DOM drop target:
//   - Drop on an .epic-item → LINK (epic→feature, story→epic, etc.)
//   - Drop on a .swimlane-section header/body (not on an item) → MOVE to that PI
//
// Uses mouse events (not HTML5 DnD) for reliable cross-browser behaviour.

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

async function executeLinkDrop(srcFilename, srcDocType, dropTarget) {
  const tgtFilename = dropTarget.dataset.filename;
  const tgtDocType  = dropTarget.dataset.doctype;
  const tgtTitle    = dropTarget.querySelector('.epic-title-text')?.textContent || tgtFilename;

  // If multi-selected, link all selected items
  const dragDocs = getDragDocs(srcFilename, srcDocType);

  try {
    let linked = 0;
    for (const d of dragDocs) {
      const valid = DRAG_TARGETS[d.docType] || [];
      if (!valid.includes(tgtDocType)) continue;
      const res = await fetch('/api/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: d.docType, sourceFilename: d.filename,
          targetType: tgtDocType, targetFilename: tgtFilename,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(getErrorMessage(data.error, 'Link failed'));
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

  // Collect all items to move (multi-select aware + descendants)
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
    const res = await fetch('/api/docs/batch-fix-version', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fixVersion: newFixVersion,
        docs: allToMove.map(d => ({ type: d.docType, filename: d.filename })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(getErrorMessage(data.error, 'Move failed'));

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

function resolveDropTargets(snap, e) {
  let dropTarget = null, dropSwimlane = null;

  if (snap.started && snap.ghost) {
    snap.ghost.style.visibility = 'hidden';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    snap.ghost.style.visibility = '';

    const itemUnder = elUnder?.closest('.epic-item');
    if (itemUnder && itemUnder.dataset.filename !== snap.srcFilename) {
      const valid = DRAG_TARGETS[snap.srcDocType] || [];
      if (valid.includes(itemUnder.dataset.doctype)) dropTarget = itemUnder;
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

      const dragDocs = getDragDocs(state.srcFilename, state.srcDocType);
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

      // Mark all dragged items as drag-source
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

    list.querySelectorAll('.drag-target-valid').forEach(el => el.classList.remove('drag-target-valid'));
    list.querySelectorAll('.swimlane-drop-target').forEach(el => el.classList.remove('swimlane-drop-target'));
    state.currentTarget   = null;
    state.currentSwimlane = null;

    const targetItem = elUnder?.closest('.epic-item');
    if (targetItem && targetItem.dataset.filename !== state.srcFilename) {
      const validTargets = DRAG_TARGETS[state.srcDocType] || [];
      if (validTargets.includes(targetItem.dataset.doctype)) {
        targetItem.classList.add('drag-target-valid');
        state.currentTarget = targetItem;
        return;
      }
    }

    const swimlaneSection = elUnder?.closest('.swimlane-section');
    if (swimlaneSection) {
      const srcDoc  = allDocs.find(d => d.filename === state.srcFilename);
      const srcLane = getSwimlaneSection(srcDoc);
      if (swimlaneSection.dataset.section !== srcLane) {
        swimlaneSection.classList.add('swimlane-drop-target');
        state.currentSwimlane = swimlaneSection;
      }
    }
  });

  document.addEventListener('mouseup', async e => {
    if (!state) return;
    const snap = state;
    state = null;

    const { dropTarget, dropSwimlane } = resolveDropTargets(snap, e);

    if (snap.ghost) snap.ghost.remove();
    list.classList.remove('dragging-active');
    list.querySelectorAll('.drag-source, .drag-target-valid').forEach(el => {
      el.classList.remove('drag-source', 'drag-target-valid');
    });
    list.querySelectorAll('.swimlane-drop-target').forEach(el => el.classList.remove('swimlane-drop-target'));
    document.body.style.userSelect = '';

    setTimeout(() => { _justDragged = false; }, 150);

    if (!snap.started) return;

    if (dropTarget) return executeLinkDrop(snap.srcFilename, snap.srcDocType, dropTarget);
    if (dropSwimlane) return executeMoveDrop(snap.srcFilename, snap.srcDocType, dropSwimlane);
  });
}
