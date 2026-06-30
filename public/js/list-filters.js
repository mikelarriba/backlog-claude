// ── List filters, collapse, multi-select, and context menu ───────
import {
  buildChildrenMap,
  getDescendants,
  debounce,
  escHtml,
  putJSON,
  postJSON,
  showJiraToast,
  SECTION_LABELS,
} from './state.js';
import { closeDeleteDialog, executeDelete } from './detail.js';
import { loadDocs } from './list.js';
import { renderSwimlanes } from './list-render.js';
import { sectionToFixVersion } from './dragdrop.js';
export function toggleItemCollapse(filename, e) {
  e.stopPropagation();
  if (_collapsedItems.has(filename)) {
    _collapsedItems.delete(filename);
  } else {
    _collapsedItems.add(filename);
  }
  applyFilters();
}
export function collapseAll() {
  const childrenMap = buildChildrenMap(allDocs);
  for (const d of allDocs) {
    if (
      (d.docType === 'feature' || d.docType === 'epic') &&
      (childrenMap.get(d.filename) || []).length > 0
    ) {
      _collapsedItems.add(d.filename);
    }
  }
  applyFilters();
}
export function expandAll() {
  _collapsedItems.clear();
  applyFilters();
}
export function toggleSwimlane(sectionKey) {
  _swimlanesCollapsed[sectionKey] = !_swimlanesCollapsed[sectionKey];
  const section = document.querySelector(`.swimlane-section[data-section="${sectionKey}"]`);
  if (!section) return;
  const body = section.querySelector('.swimlane-body');
  const chevron = section.querySelector('.swimlane-chevron');
  if (!body || !chevron) return;
  if (_swimlanesCollapsed[sectionKey]) {
    body.classList.add('collapsed');
    chevron.textContent = '▶';
  } else {
    body.classList.remove('collapsed');
    chevron.textContent = '▼';
  }
}
export async function updatePiVersion(sectionKey, versionName) {
  const update = { ...piSettings };
  if (sectionKey === 'currentPi') update.currentPi = versionName || null;
  if (sectionKey === 'nextPi') update.nextPi = versionName || null;
  try {
    await putJSON('/api/settings/pi', update);
    piSettings = update;
    applyFilters();
  } catch (e) {
    console.error('Failed to save PI settings:', e.message);
  }
}
// ── Filters ───────────────────────────────────────────────────
export function setTypeFilter(type) {
  activeTypeFilter = type;
  document.querySelectorAll('[data-type]').forEach((el) => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  applyFilters();
}
export function setStatusFilter(status) {
  activeStatusFilter = status;
  document.querySelectorAll('[data-status]').forEach((el) => {
    el.classList.toggle('active', el.dataset.status === status);
  });
  applyFilters();
}
export function setTeamFilter(team) {
  activeTeamFilter = team;
  document.querySelectorAll('[data-team]').forEach((el) => {
    el.classList.toggle('active', el.dataset.team === team);
  });
  applyFilters();
}
export function setWorkCatFilter(cat) {
  activeWorkCatFilter = cat;
  document.querySelectorAll('[data-workcat]').forEach((el) => {
    el.classList.toggle('active', el.dataset.workcat === cat);
  });
  applyFilters();
}
// The rest parameter is unused at runtime (this function always re-derives
// from the `allDocs` global) but is accepted so callers — e.g. the
// `on('docs:changed', ...)` subscription in main.ts, and `debounce()` below —
// can pass arguments (such as the changed docs payload) without a type error.
export function applyFilters(..._args) {
  const q = document.getElementById('search')?.value.toLowerCase() ?? '';
  let filtered = allDocs;
  if (activeTypeFilter !== 'all') filtered = filtered.filter((d) => d.docType === activeTypeFilter);
  if (activeStatusFilter !== 'all')
    filtered = filtered.filter((d) => (d.status || 'Draft') === activeStatusFilter);
  if (activeTeamFilter !== 'all') filtered = filtered.filter((d) => d.team === activeTeamFilter);
  if (activeWorkCatFilter !== 'all')
    filtered = filtered.filter((d) => d.workCategory === activeWorkCatFilter);
  if (q)
    filtered = filtered.filter(
      (d) => d.title.toLowerCase().includes(q) || d.filename.toLowerCase().includes(q)
    );
  renderSwimlanes(filtered);
}
export const applyFiltersDebounced = debounce(applyFilters, 200);
// ── Multi-select ─────────────────────────────────────────────
export function itemKey(filename, docType) {
  return `${docType}:${filename}`;
}
export function getVisibleItems() {
  return Array.from(document.querySelectorAll('.epic-item')).map((el) => ({
    filename: el.dataset.filename,
    docType: el.dataset.doctype,
    el,
  }));
}
export function clearSelection() {
  selectedItems.clear();
  _lastClickedItem = null;
  document
    .querySelectorAll('.epic-item.multi-selected')
    .forEach((el) => el.classList.remove('multi-selected'));
}
export function syncSelectionUI() {
  document.querySelectorAll('.epic-item').forEach((el) => {
    const key = itemKey(el.dataset.filename, el.dataset.doctype);
    el.classList.toggle('multi-selected', selectedItems.has(key));
  });
}
export function handleItemClick(e, filename, docType) {
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
    const lastClicked = _lastClickedItem;
    const visible = getVisibleItems();
    const lastIdx = visible.findIndex(
      (v) => v.filename === lastClicked.filename && v.docType === lastClicked.docType
    );
    const curIdx = visible.findIndex((v) => v.filename === filename && v.docType === docType);
    if (lastIdx >= 0 && curIdx >= 0) {
      const start = Math.min(lastIdx, curIdx);
      const end = Math.max(lastIdx, curIdx);
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
export function handleItemContextMenu(e, filename, docType) {
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
export function showContextMenu(x, y) {
  closeContextMenu();
  const count = selectedItems.size;
  if (!count) return;
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'list-context-menu';
  // "Move to PI" submenu
  const piOptions = [];
  if (piSettings.currentPi)
    piOptions.push({ label: piSettings.currentPi, badge: 'Current', section: 'currentPi' });
  if (piSettings.nextPi)
    piOptions.push({ label: piSettings.nextPi, badge: 'Next', section: 'nextPi' });
  piOptions.push({ label: 'Backlog (clear version)', badge: null, section: 'backlog' });
  const piItems = piOptions
    .map((opt) => {
      const badge = opt.badge ? `<span class="ctx-badge">${escHtml(opt.badge)}</span>` : '';
      return `<button class="ctx-item" onclick="contextMoveToPI('${opt.section}')">
      ${badge}${escHtml(opt.label)}
    </button>`;
    })
    .join('');
  // "Assign Sprint" submenu — collect sprints from all PIs
  const allSprints = new Map();
  for (const [pi, sprints] of Object.entries(sprintConfig)) {
    for (const s of sprints) {
      if (!allSprints.has(s.name)) allSprints.set(s.name, pi);
    }
  }
  const sprintItems = Array.from(allSprints.entries())
    .map(
      ([name, _pi]) =>
        `<button class="ctx-item" onclick="contextAssignField('sprint','${escHtml(name)}')">${escHtml(name)}</button>`
    )
    .join('');
  const sprintClear = `<button class="ctx-item" onclick="contextAssignField('sprint','')">Clear sprint</button>`;
  // "Assign Team" submenu
  const teamItems = (_metaTeams || [])
    .map(
      (t) =>
        `<button class="ctx-item" onclick="contextAssignField('team','${escHtml(t)}')">${escHtml(t)}</button>`
    )
    .join('');
  const teamClear = `<button class="ctx-item" onclick="contextAssignField('team','')">Clear team</button>`;
  // "Assign Category" submenu
  const catItems = (_metaWorkCategories || [])
    .map(
      (c) =>
        `<button class="ctx-item" onclick="contextAssignField('workCategory','${escHtml(c)}')">${escHtml(c)}</button>`
    )
    .join('');
  const catClear = `<button class="ctx-item" onclick="contextAssignField('workCategory','')">Clear category</button>`;
  const splitOption =
    count === 1
      ? `
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick="contextSplitItem()">✂ Split Issue</button>`
      : '';
  menu.innerHTML = `
    <div class="ctx-header">${count} item${count > 1 ? 's' : ''} selected</div>
    <div class="ctx-separator"></div>
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Move to PI →</button>
      <div class="ctx-submenu">${piItems}</div>
    </div>
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Assign Sprint →</button>
      <div class="ctx-submenu">${sprintItems}${sprintItems ? '<div class="ctx-separator"></div>' : ''}${sprintClear}</div>
    </div>
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Assign Team →</button>
      <div class="ctx-submenu">${teamItems}<div class="ctx-separator"></div>${teamClear}</div>
    </div>
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Assign Category →</button>
      <div class="ctx-submenu">${catItems}<div class="ctx-separator"></div>${catClear}</div>
    </div>
    ${splitOption}
    <div class="ctx-separator"></div>
    <button class="ctx-item ctx-danger" onclick="contextDeleteSelected()">Delete</button>
  `;
  document.body.appendChild(menu);
  // Position: ensure it stays within viewport
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
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
export function closeContextMenu() {
  const menu = document.getElementById('list-context-menu');
  if (menu) menu.remove();
  document.removeEventListener('mousedown', _closeContextMenuHandler);
  document.removeEventListener('contextmenu', _closeContextMenuOnRightClick);
}
export async function contextMoveToPI(section) {
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
      docs: allToMove.map((d) => ({ type: d.docType, filename: d.filename })),
    });
    showJiraToast('success', `Moved ${allToMove.length} item(s) to ${SECTION_LABELS[section]}`);
    clearSelection();
  } catch (err) {
    showJiraToast('error', err.message);
  }
}
export async function contextDeleteSelected() {
  closeContextMenu();
  const docs = getSelectedDocs();
  if (!docs.length) return;
  const count = docs.length;
  const msg =
    count === 1
      ? `Delete "${docs[0].title}"? This cannot be undone.`
      : `Delete ${count} selected items? This cannot be undone.`;
  const msgEl = document.getElementById('delete-msg');
  if (msgEl) msgEl.textContent = msg;
  document.getElementById('delete-overlay')?.classList.add('show');
  // Replace the delete handler temporarily for batch delete
  const btn = document.getElementById('confirm-delete-btn');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      const data = await postJSON('/api/docs/batch-delete', {
        docs: docs.map((d) => ({ type: d.docType, filename: d.filename })),
      });
      closeDeleteDialog();
      clearSelection();
      // Always reload to purge stale entries from the list
      await loadDocs();
      if (data.deleted === 0) {
        const reasons = (data.skipped || []).map((s) => s.reason).join('; ');
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
export async function contextAssignField(field, value) {
  closeContextMenu();
  const docs = getSelectedDocs();
  if (!docs.length) return;
  const fieldLabels = {
    sprint: 'Sprint',
    team: 'Team',
    workCategory: 'Category',
  };
  const label = fieldLabels[field] || field;
  const displayValue = value || '(clear)';
  if (docs.length > 1) {
    // Show confirmation dialog for multi-select
    const msg = `Assign ${label} "${displayValue}" to ${docs.length} selected items?`;
    const msgEl = document.getElementById('bulk-assign-msg');
    if (msgEl) msgEl.textContent = msg;
    document.getElementById('bulk-assign-overlay')?.classList.add('show');
    const btn = document.getElementById('confirm-bulk-assign-btn');
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = 'Apply';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Applying…';
      try {
        await _executeBatchFieldUpdate(field, value, docs, label, displayValue);
      } finally {
        closeBulkAssignDialog();
      }
    };
    return;
  }
  // Single item — apply directly
  await _executeBatchFieldUpdate(field, value, docs, label, displayValue);
}
async function _executeBatchFieldUpdate(field, value, docs, label, displayValue) {
  try {
    const data = await postJSON('/api/docs/batch-update-field', {
      field,
      value: value || null,
      docs: docs.map((d) => ({ type: d.docType, filename: d.filename })),
    });
    clearSelection();
    if (data.updated > 0) {
      showJiraToast('success', `${label} → "${displayValue}" applied to ${data.updated} item(s)`);
    } else {
      showJiraToast('error', 'No items updated');
    }
  } catch (err) {
    showJiraToast('error', err.message);
  }
}
export function closeBulkAssignDialog() {
  document.getElementById('bulk-assign-overlay')?.classList.remove('show');
}
export function getSelectedDocs() {
  const docs = [];
  for (const key of selectedItems) {
    const [docType, ...rest] = key.split(':');
    const filename = rest.join(':');
    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    if (doc) docs.push(doc);
  }
  return docs;
}
//# sourceMappingURL=list-filters.js.map
