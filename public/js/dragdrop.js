// ── Drag-and-drop linking ──────────────────────────────────────
// Valid: epic→feature, story→epic, spike→epic. Everything else is a no-op.
// Uses mouse events (not HTML5 DnD) for reliable cross-browser behaviour.

function initDragDrop() {
  const list = document.getElementById('epic-list');
  let state = null; // { srcFilename, srcDocType, ghost, currentTarget, started, startX, startY }

  const DRAG_THRESHOLD = 6; // px movement before drag begins

  list.addEventListener('mousedown', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();

    const item = handle.closest('.epic-item');
    if (!item) return;

    state = {
      srcFilename: item.dataset.filename,
      srcDocType:  item.dataset.doctype,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      ghost: null,
      currentTarget: null,
    };
  });

  document.addEventListener('mousemove', e => {
    if (!state) return;

    if (!state.started) {
      const dx = Math.abs(e.clientX - state.startX);
      const dy = Math.abs(e.clientY - state.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;

      // Threshold crossed — begin drag
      state.started = true;
      _justDragged = true;

      // Build ghost
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      const badge = document.createElement('span');
      badge.className = `type-badge ${state.srcDocType}`;
      badge.textContent = TYPE_LABEL[state.srcDocType] || state.srcDocType;
      ghost.appendChild(badge);
      ghost.appendChild(document.createTextNode(
        allDocs.find(d => d.filename === state.srcFilename)?.title || state.srcFilename
      ));
      document.body.appendChild(ghost);
      state.ghost = ghost;

      const srcItem = list.querySelector(`[data-filename="${CSS.escape(state.srcFilename)}"]`);
      if (srcItem) srcItem.classList.add('drag-source');
      list.classList.add('dragging-active');
      document.body.style.userSelect = 'none';
    }

    // Move ghost
    state.ghost.style.left = `${e.clientX + 14}px`;
    state.ghost.style.top  = `${e.clientY + 10}px`;

    // Find item under cursor (hide ghost so it doesn't block elementFromPoint)
    state.ghost.style.visibility = 'hidden';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    state.ghost.style.visibility = '';

    const targetItem = elUnder?.closest('.epic-item');

    list.querySelectorAll('.drag-target-valid').forEach(el => el.classList.remove('drag-target-valid'));
    state.currentTarget = null;

    if (targetItem && targetItem.dataset.filename !== state.srcFilename) {
      const validTargets = DRAG_TARGETS[state.srcDocType] || [];
      if (validTargets.includes(targetItem.dataset.doctype)) {
        targetItem.classList.add('drag-target-valid');
        state.currentTarget = targetItem;
      }
    }
  });

  document.addEventListener('mouseup', async e => {
    if (!state) return;
    const snap = state;
    state = null;

    // Determine drop target at the exact moment of release
    // Hide ghost first so elementFromPoint sees what's underneath it.
    let dropTarget = null;
    if (snap.started && snap.ghost) {
      snap.ghost.style.visibility = 'hidden';
      const elUnder = document.elementFromPoint(e.clientX, e.clientY);
      snap.ghost.style.visibility = '';
      const itemUnder = elUnder?.closest('.epic-item');
      if (itemUnder && itemUnder.dataset.filename !== snap.srcFilename) {
        const valid = DRAG_TARGETS[snap.srcDocType] || [];
        if (valid.includes(itemUnder.dataset.doctype)) dropTarget = itemUnder;
      }
    }
    // Fall back to last highlighted item from mousemove
    if (!dropTarget) dropTarget = snap.currentTarget;

    // Cleanup DOM
    if (snap.ghost) snap.ghost.remove();
    list.classList.remove('dragging-active');
    list.querySelectorAll('.drag-source, .drag-target-valid').forEach(el => {
      el.classList.remove('drag-source', 'drag-target-valid');
    });
    document.body.style.userSelect = '';

    setTimeout(() => { _justDragged = false; }, 150);

    if (!snap.started || !dropTarget) return;

    const tgtFilename = dropTarget.dataset.filename;
    const tgtDocType  = dropTarget.dataset.doctype;
    const tgtTitle    = dropTarget.querySelector('.epic-title-text')?.textContent || tgtFilename;

    try {
      const res = await fetch('/api/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType:     snap.srcDocType,
          sourceFilename: snap.srcFilename,
          targetType:     tgtDocType,
          targetFilename: tgtFilename,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(getErrorMessage(data.error, 'Link failed'));

      showJiraToast('success', `🔗 Linked to "${tgtTitle}"`);
      await loadDocs();
      if (currentFilename === snap.srcFilename || currentFilename === tgtFilename) {
        loadHierarchy(currentFilename, currentDocType);
      }
    } catch (err) {
      showJiraToast('error', `❌ ${err.message}`);
    }
  });
}
