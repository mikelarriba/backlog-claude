// ── List filters, collapse, multi-select, and context menu ───────

function toggleItemCollapse(filename, e) {
  e.stopPropagation();
  if (_collapsedItems.has(filename)) {
    _collapsedItems.delete(filename);
  } else {
    _collapsedItems.add(filename);
  }
  applyFilters();
}

function collapseAll() {
  const childrenMap = buildChildrenMap(allDocs);
  for (const d of allDocs) {
    if ((d.docType === 'feature' || d.docType === 'epic') && (childrenMap.get(d.filename) || []).length > 0) {
      _collapsedItems.add(d.filename);
    }
  }
  applyFilters();
}

function expandAll() {
  _collapsedItems.clear();
  applyFilters();
}

function toggleSwimlane(sectionKey) {
  _swimlanesCollapsed[sectionKey] = !_swimlanesCollapsed[sectionKey];
  const section = document.querySelector(`.swimlane-section[data-section="${sectionKey}"]`);
  if (!section) return;
  const body    = section.querySelector('.swimlane-body');
  const chevron = section.querySelector('.swimlane-chevron');
  if (_swimlanesCollapsed[sectionKey]) {
    body.classList.add('collapsed');
    chevron.textContent = '▶';
  } else {
    body.classList.remove('collapsed');
    chevron.textContent = '▼';
  }
}

async function updatePiVersion(sectionKey, versionName) {
  const update = { ...piSettings };
  if (sectionKey === 'currentPi') update.currentPi = versionName || null;
  if (sectionKey === 'nextPi')    update.nextPi    = versionName || null;

  try {
    await putJSON('/api/settings/pi', update);
    piSettings = update;
    applyFilters();
  } catch (e) {
    console.error('Failed to save PI settings:', e.message);
  }
}

// ── Filters ───────────────────────────────────────────────────
function setTypeFilter(type) {
  activeTypeFilter = type;
  document.querySelectorAll('[data-type]').forEach(el => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  applyFilters();
}

function setStatusFilter(status) {
  activeStatusFilter = status;
  document.querySelectorAll('[data-status]').forEach(el => {
    el.classList.toggle('active', el.dataset.status === status);
  });
  applyFilters();
}

function setTeamFilter(team) {
  activeTeamFilter = team;
  document.querySelectorAll('[data-team]').forEach(el => {
    el.classList.toggle('active', el.dataset.team === team);
  });
  applyFilters();
}

function setWorkCatFilter(cat) {
  activeWorkCatFilter = cat;
  document.querySelectorAll('[data-workcat]').forEach(el => {
    el.classList.toggle('active', el.dataset.workcat === cat);
  });
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById('search').value.toLowerCase();
  let filtered = allDocs;
  if (activeTypeFilter !== 'all')    filtered = filtered.filter(d => d.docType === activeTypeFilter);
  if (activeStatusFilter !== 'all')  filtered = filtered.filter(d => (d.status || 'Draft') === activeStatusFilter);
  if (activeTeamFilter !== 'all')    filtered = filtered.filter(d => d.team === activeTeamFilter);
  if (activeWorkCatFilter !== 'all') filtered = filtered.filter(d => d.workCategory === activeWorkCatFilter);
  if (q) filtered = filtered.filter(d => d.title.toLowerCase().includes(q) || d.filename.toLowerCase().includes(q));
  renderSwimlanes(filtered);
}

var applyFiltersDebounced = debounce(applyFilters, 200);

// ── Multi-select ─────────────────────────────────────────────
function itemKey(filename, docType) { return `${docType}:${filename}`; }

function getVisibleItems() {
  return Array.from(document.querySelectorAll('.epic-item')).map(el => ({
    filename: el.dataset.filename,
    docType:  el.dataset.doctype,
    el,
  }));
}

function clearSelection() {
  selectedItems.clear();
  _lastClickedItem = null;
  document.querySelectorAll('.epic-item.multi-selected').forEach(el => el.classList.remove('multi-selected'));
}

function syncSelectionUI() {
  document.querySelectorAll('.epic-item').forEach(el => {
    const key = itemKey(el.dataset.filename, el.dataset.doctype);
    el.classList.toggle('multi-selected', selectedItems.has(key));
  });
}

function handleItemClick(e, filename, docType) {
  if (_justDragged) return;

  // Clicks on collapse button are handled separately
  if (e.target.closest('.collapse-btn')) return;

  const key = itemKey(filename, docType);
  const isMeta = e.metaKey || e.ctrlKey;
  const isShift = e.shiftKey;

  if (isMeta) {
    // Cmd/Ctrl+Click: toggle individual item
    e.preventDefault();
    if (selectedItems.has(key)) {
      selectedItems.delete(key);
    } else {
      selectedItems.add(key);
    }
    _lastClickedItem = { filename, docType };
    syncSelectionUI();
    return;
  }

  if (isShift && _lastClickedItem) {
    // Shift+Click: range select
    e.preventDefault();
    const visible = getVisibleItems();
    const lastIdx = visible.findIndex(v => v.filename === _lastClickedItem.filename && v.docType === _lastClickedItem.docType);
    const curIdx  = visible.findIndex(v => v.filename === filename && v.docType === docType);
    if (lastIdx >= 0 && curIdx >= 0) {
      const start = Math.min(lastIdx, curIdx);
      const end   = Math.max(lastIdx, curIdx);
      for (let i = start; i <= end; i++) {
        selectedItems.add(itemKey(visible[i].filename, visible[i].docType));
      }
    }
    syncSelectionUI();
    return;
  }

  // Plain click: clear selection and open the doc
  if (selectedItems.size > 0) {
    clearSelection();
  }
  openDoc(filename, docType);
}

// ── Context menu ─────────────────────────────────────────────
function handleItemContextMenu(e, filename, docType) {
  e.preventDefault();

  const key = itemKey(filename, docType);

  // If right-clicking an unselected item, add it to the current selection
  if (!selectedItems.has(key)) {
    selectedItems.add(key);
    _lastClickedItem = { filename, docType };
    syncSelectionUI();
  }

  showContextMenu(e.clientX, e.clientY);
}

function showContextMenu(x, y) {
  closeContextMenu();
  const count = selectedItems.size;
  if (!count) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'list-context-menu';

  // "Move to PI" submenu
  const piOptions = [];
  if (piSettings.currentPi) piOptions.push({ label: piSettings.currentPi, badge: 'Current', section: 'currentPi' });
  if (piSettings.nextPi)    piOptions.push({ label: piSettings.nextPi,    badge: 'Next',    section: 'nextPi' });
  piOptions.push({ label: 'Backlog (clear version)', badge: null, section: 'backlog' });

  const piItems = piOptions.map(opt => {
    const badge = opt.badge ? `<span class="ctx-badge">${escHtml(opt.badge)}</span>` : '';
    return `<button class="ctx-item" onclick="contextMoveToPI('${opt.section}')">
      ${badge}${escHtml(opt.label)}
    </button>`;
  }).join('');

  const splitOption = count === 1 ? `
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick="contextSplitItem()">✂ Split Issue</button>` : '';

  menu.innerHTML = `
    <div class="ctx-header">${count} item${count > 1 ? 's' : ''} selected</div>
    <div class="ctx-separator"></div>
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Move to PI →</button>
      <div class="ctx-submenu">${piItems}</div>
    </div>
    ${splitOption}
    <div class="ctx-separator"></div>
    <button class="ctx-item ctx-danger" onclick="contextDeleteSelected()">Delete</button>
  `;

  document.body.appendChild(menu);

  // Position: ensure it stays within viewport
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth)  x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;

  // Close on outside click (next tick)
  setTimeout(() => {
    document.addEventListener('mousedown', _closeContextMenuHandler);
    document.addEventListener('contextmenu', _closeContextMenuOnRightClick);
  }, 0);
}

function _closeContextMenuHandler(e) {
  if (!e.target.closest('#list-context-menu')) closeContextMenu();
}
function _closeContextMenuOnRightClick(e) {
  if (!e.target.closest('#list-context-menu')) closeContextMenu();
}

function closeContextMenu() {
  const menu = document.getElementById('list-context-menu');
  if (menu) menu.remove();
  document.removeEventListener('mousedown', _closeContextMenuHandler);
  document.removeEventListener('contextmenu', _closeContextMenuOnRightClick);
}

async function contextMoveToPI(section) {
  closeContextMenu();
  const newFixVersion = sectionToFixVersion(section);
  if (section !== 'backlog' && !newFixVersion) {
    showJiraToast('error', `Set a version for ${SECTION_LABELS[section]} first`);
    return;
  }

  const docs = getSelectedDocs();
  if (!docs.length) return;

  // Include descendants for parent items
  const childrenMap = buildChildrenMap(allDocs);
  const allToMove = [];
  const seen = new Set();
  for (const d of docs) {
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
    showJiraToast('success', `Moved ${allToMove.length} item(s) to ${SECTION_LABELS[section]}`);
    clearSelection();
  } catch (err) {
    showJiraToast('error', err.message);
  }
}

async function contextDeleteSelected() {
  closeContextMenu();
  const docs = getSelectedDocs();
  if (!docs.length) return;

  const count = docs.length;
  const msg = count === 1
    ? `Delete "${docs[0].title}"? This cannot be undone.`
    : `Delete ${count} selected items? This cannot be undone.`;

  document.getElementById('delete-msg').textContent = msg;
  document.getElementById('delete-overlay').classList.add('show');

  // Replace the delete handler temporarily for batch delete
  const btn = document.getElementById('confirm-delete-btn');
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      const data = await postJSON('/api/docs/batch-delete', {
        docs: docs.map(d => ({ type: d.docType, filename: d.filename })),
      });
      closeDeleteDialog();
      clearSelection();
      if (data.deleted === 0) {
        const reasons = (data.skipped || []).map(s => s.reason).join('; ');
        showJiraToast('error', `Nothing deleted${reasons ? ': ' + reasons : ''}`);
      } else {
        showJiraToast('success', `Deleted ${data.deleted} item(s)`);
        if (data.skipped && data.skipped.length) {
          showJiraToast('error', `${data.skipped.length} item(s) could not be deleted`);
        }
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Delete';
      showJiraToast('error', err.message);
    } finally {
      // Restore original handler
      btn.onclick = executeDelete;
    }
  };
}

function getSelectedDocs() {
  const docs = [];
  for (const key of selectedItems) {
    const [docType, ...rest] = key.split(':');
    const filename = rest.join(':');
    const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
    if (doc) docs.push(doc);
  }
  return docs;
}
