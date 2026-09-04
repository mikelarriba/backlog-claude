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
  openModal,
  closeModal,
} from './state.js';
import type { DocEntry } from './state.js';
import { closeDeleteDialog, executeDelete } from './detail.js';
import { loadDocs, contextSplitItem } from './list.js';
import { registerActions, registerInputActions, registerContextActions } from './actions.js';
import {
  renderSwimlanes,
  renderDocItem,
  attachDepHoverListenerFor,
  _invalidateDepElCache,
  LIST_ITEM_CTX_ACTIONS,
} from './list-render.js';
import type { SprintInfo } from './list-render.js';
import { sectionToFixVersion, moveSelectionRank } from './dragdrop.js';

// NOTE: `_lastClickedItem` is declared in global.d.ts as `string | null`, but
// at runtime (here and in dragdrop.js) it always holds either `null` or a
// `{ filename, docType }` object — never a bare string. The ambient
// declaration is out of date; casting locally rather than editing
// global.d.ts (out of scope for this migration pass).
interface LastClickedItem {
  filename: string;
  docType: string;
}

export function toggleItemCollapse(filename: string, e: MouseEvent): void {
  e.stopPropagation();
  if (_collapsedItems.has(filename)) {
    _collapsedItems.delete(filename);
  } else {
    _collapsedItems.add(filename);
  }
  applyFilters();
}

export function collapseAll(): void {
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

export function expandAll(): void {
  _collapsedItems.clear();
  applyFilters();
}

export function toggleSwimlane(sectionKey: 'currentPi' | 'nextPi' | 'backlog'): void {
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

export async function updatePiVersion(
  sectionKey: 'currentPi' | 'nextPi',
  versionName: string
): Promise<void> {
  const update = { ...piSettings };
  if (sectionKey === 'currentPi') update.currentPi = versionName || null;
  if (sectionKey === 'nextPi') update.nextPi = versionName || null;

  try {
    await putJSON('/api/settings/pi', update);
    piSettings = update;
    applyFilters();
  } catch (e) {
    console.error('Failed to save PI settings:', (e as Error).message);
  }
}

// ── Filters ───────────────────────────────────────────────────
export function setTypeFilter(type: string): void {
  activeTypeFilter = type;
  document.querySelectorAll<HTMLElement>('[data-type]').forEach((el) => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  applyFilters();
}

export function setStatusFilter(status: string): void {
  activeStatusFilter = status;
  document.querySelectorAll<HTMLElement>('[data-status]').forEach((el) => {
    el.classList.toggle('active', el.dataset.status === status);
  });
  applyFilters();
}

export function setTeamFilter(team: string): void {
  activeTeamFilter = team;
  document.querySelectorAll<HTMLElement>('[data-team]').forEach((el) => {
    el.classList.toggle('active', el.dataset.team === team);
  });
  applyFilters();
}

export function setWorkCatFilter(cat: string): void {
  activeWorkCatFilter = cat;
  document.querySelectorAll<HTMLElement>('[data-workcat]').forEach((el) => {
    el.classList.toggle('active', el.dataset.workcat === cat);
  });
  applyFilters();
}

function _currentSearchQuery(): string {
  return (document.getElementById('search') as HTMLInputElement | null)?.value.toLowerCase() ?? '';
}

export interface ListFilterState {
  type: string;
  status: string;
  team: string;
  workCat: string;
}

// Pure predicate extracted from _matchesFilters below so it takes the active
// filters as an explicit parameter instead of reading the module's
// activeTypeFilter/activeStatusFilter/activeTeamFilter/activeWorkCatFilter
// globals directly — same signature-change extraction already used for
// computeChildPoints() (detail-fields.ts) and buildSprintSubmenuHtml()
// (roadmap-context-menus.ts). Byte-for-byte behavior-preserving.
export function matchesListFilters(d: DocEntry, q: string, filters: ListFilterState): boolean {
  if (filters.type !== 'all' && d.docType !== filters.type) return false;
  if (filters.status !== 'all' && (d.status || 'Draft') !== filters.status) return false;
  if (filters.team !== 'all' && d.team !== filters.team) return false;
  if (filters.workCat !== 'all' && d.workCategory !== filters.workCat) return false;
  if (q && !(d.title.toLowerCase().includes(q) || d.filename.toLowerCase().includes(q)))
    return false;
  return true;
}

function _matchesFilters(d: DocEntry, q: string): boolean {
  return matchesListFilters(d, q, {
    type: activeTypeFilter,
    status: activeStatusFilter,
    team: activeTeamFilter,
    workCat: activeWorkCatFilter,
  });
}

// The rest parameter is unused at runtime (this function always re-derives
// from the `allDocs` global) but is accepted so callers — e.g. the
// `on('docs:changed', ...)` subscription in main.ts, and `debounce()` below —
// can pass arguments (such as the changed docs payload) without a type error.
export function applyFilters(..._args: unknown[]): void {
  const q = _currentSearchQuery();
  const filtered = allDocs.filter((d) => _matchesFilters(d, q));
  renderSwimlanes(filtered);
}

export const applyFiltersDebounced: (...args: unknown[]) => void = debounce(applyFilters, 200);

// ── Single-row patch path (perf) ─────────────────────────────────────────────
// Patches just one doc's existing DOM row instead of rebuilding the full
// swimlane tree — used for single-field edits (title, story points, sprint,
// team, ...) that don't change where the doc sits in the tree. Returns false
// when the fast path doesn't apply (row not currently rendered, or the doc no
// longer matches the active filters) so the caller can fall back to a full
// applyFilters() rebuild.
function _refreshSwimlaneCapacity(doc: DocEntry): void {
  const versionName = doc.fixVersion;
  if (!versionName) return;
  let sectionKey: string | null = null;
  if (piSettings.currentPi && versionName === piSettings.currentPi) sectionKey = 'currentPi';
  else if (piSettings.nextPi && versionName === piSettings.nextPi) sectionKey = 'nextPi';
  if (!sectionKey) return;

  const sprintConfigMap = sprintConfig as unknown as Record<string, SprintInfo[]>;
  const sprints = sprintConfigMap[versionName];
  if (!sprints || !sprints.length) return;

  const badge = document.querySelector<HTMLElement>(
    `.swimlane-section[data-section="${sectionKey}"] .swimlane-capacity`
  );
  if (!badge) return;

  const totalCapacity = sprints.reduce((sum, s) => sum + s.capacity, 0);
  const q = _currentSearchQuery();
  const assignedSP = allDocs
    .filter((d) => d.fixVersion === versionName && _matchesFilters(d, q))
    .reduce((sum, d) => sum + (Number(d.storyPoints) || 0), 0);
  const pct = totalCapacity > 0 ? Math.round((assignedSP / totalCapacity) * 100) : 0;
  badge.textContent = `${assignedSP} / ${totalCapacity} SP (${pct}%)`;
  badge.classList.toggle('over', pct > 100);
}

export function patchSingleDoc(filename: string): boolean {
  const doc = allDocs.find((d) => d.filename === filename);
  if (!doc) return false;
  if (!_matchesFilters(doc, _currentSearchQuery())) return false;

  const list = document.getElementById('epic-list');
  const existing = list?.querySelector<HTMLElement>(
    `.epic-item[data-filename="${CSS.escape(filename)}"]`
  );
  if (!existing) return false;

  const indent = Number(existing.dataset.indent || '0');
  const childrenMap = buildChildrenMap(allDocs);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderDocItem(doc, indent, childrenMap).trim();
  const newEl = wrapper.firstElementChild as HTMLElement | null;
  if (!newEl) return false;
  existing.replaceWith(newEl);

  _invalidateDepElCache();
  attachDepHoverListenerFor(newEl, doc);
  _refreshSwimlaneCapacity(doc);
  return true;
}

// ── Multi-select ─────────────────────────────────────────────
export function itemKey(filename: string, docType: string): string {
  return `${docType}:${filename}`;
}

interface VisibleItem {
  filename: string;
  docType: string;
  el: HTMLElement;
}

export function getVisibleItems(): VisibleItem[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.epic-item')).map((el) => ({
    filename: el.dataset.filename as string,
    docType: el.dataset.doctype as string,
    el,
  }));
}

export function clearSelection(): void {
  selectedItems.clear();
  _lastClickedItem = null;
  document
    .querySelectorAll('.epic-item.multi-selected')
    .forEach((el) => el.classList.remove('multi-selected'));
}

export function syncSelectionUI(): void {
  document.querySelectorAll<HTMLElement>('.epic-item').forEach((el) => {
    const key = itemKey(el.dataset.filename as string, el.dataset.doctype as string);
    el.classList.toggle('multi-selected', selectedItems.has(key));
  });
}

// Pure range computation extracted from handleItemClick's Shift+Click branch
// (was an inline loop here, lines duplicated the index-finding/slicing logic
// verbatim) so the same range math can also back the Shift+Enter keyboard
// path below (#460/#486) — mirroring roadmap-select.ts's own
// computeShiftRangeSelection() extraction, same shape and same
// "handle the shared math once, let each entry point supply its own
// event/keys" motivation. Unlike roadmap-select's version, this one matches
// on *both* filename and docType (not filename alone) and returns nothing
// when either endpoint isn't found — preserving this module's original
// inline behavior (no "just select the current item" fallback) rather than
// adopting roadmap's fallback, since that's what the code being extracted
// actually did. Byte-for-byte behavior-preserving.
export function computeListShiftRangeSelection(
  items: { filename: string; docType: string }[],
  lastFilename: string,
  lastDocType: string,
  curFilename: string,
  curDocType: string
): { filename: string; docType: string }[] {
  const lastIdx = items.findIndex((v) => v.filename === lastFilename && v.docType === lastDocType);
  const curIdx = items.findIndex((v) => v.filename === curFilename && v.docType === curDocType);
  if (lastIdx < 0 || curIdx < 0) return [];
  const start = Math.min(lastIdx, curIdx);
  const end = Math.max(lastIdx, curIdx);
  return items.slice(start, end + 1);
}

// Toggle/range-select shared between the mouse path (handleItemClick below)
// and the keyboard path (dragdrop.ts's list keydown handler, Ctrl/Cmd+Enter
// and Shift+Enter — #486) so both entry points call the exact same
// selection-mutation logic and can't drift apart. Returns whether the item
// ended up selected (true) or deselected (false), for the caller's own
// aria-live announcement.
export function toggleItemSelection(filename: string, docType: string): boolean {
  const key = itemKey(filename, docType);
  let nowSelected: boolean;
  if (selectedItems.has(key)) {
    selectedItems.delete(key);
    nowSelected = false;
  } else {
    selectedItems.add(key);
    nowSelected = true;
  }
  _lastClickedItem = { filename, docType } as unknown as string;
  syncSelectionUI();
  return nowSelected;
}

// Range-selects from `_lastClickedItem` (the anchor) through (filename,
// docType) using computeListShiftRangeSelection() above. No-ops (returns [])
// when there's no anchor yet. Returns the items just added to the selection
// (empty when neither endpoint could be resolved) so the caller can build
// its own announcement/feedback.
export function rangeSelectItems(
  filename: string,
  docType: string
): { filename: string; docType: string }[] {
  if (!_lastClickedItem) return [];
  const lastClicked = _lastClickedItem as unknown as LastClickedItem;
  const range = computeListShiftRangeSelection(
    getVisibleItems(),
    lastClicked.filename,
    lastClicked.docType,
    filename,
    docType
  );
  for (const item of range) {
    selectedItems.add(itemKey(item.filename, item.docType));
  }
  syncSelectionUI();
  return range;
}

export function handleItemClick(e: MouseEvent, filename: string, docType: string): void {
  if (_justDragged) return;

  // Clicks on collapse button are handled separately
  if ((e.target as HTMLElement).closest('.collapse-btn')) return;

  const isMeta = e.metaKey || e.ctrlKey;
  const isShift = e.shiftKey;

  if (isMeta) {
    // Cmd/Ctrl+Click: toggle individual item
    e.preventDefault();
    toggleItemSelection(filename, docType);
    return;
  }

  if (isShift && _lastClickedItem) {
    // Shift+Click: range select
    e.preventDefault();
    rangeSelectItems(filename, docType);
    return;
  }

  // Plain click: clear selection and open the doc
  if (selectedItems.size > 0) {
    clearSelection();
  }
  openDoc(filename, docType);
}

// ── Context menu ─────────────────────────────────────────────
export function handleItemContextMenu(e: MouseEvent, filename: string, docType: string): void {
  e.preventDefault();

  const key = itemKey(filename, docType);

  // If right-clicking an unselected item, add it to the current selection
  if (!selectedItems.has(key)) {
    selectedItems.add(key);
    _lastClickedItem = { filename, docType } as unknown as string;
    syncSelectionUI();
  }

  showContextMenu(e.clientX, e.clientY);
}

// ── Context-menu action names ────────────────────────────────────────────
// Proof-of-concept for the typed data-action registration pattern (see
// actions.ts for the mechanism). The menu HTML built below is generated
// dynamically (it never exists in index.html) and used to reach its
// handlers via `onclick="contextMoveToPI(...)"` strings routed through
// main.ts's untyped `_dynGlobals` window bridge. It now instead emits
// `data-action="${CTX_ACTIONS.x}"` (+ `data-*` argument attributes) and
// registers its own handlers below, so main.ts needs no case/import/
// _dynGlobals entry for any of these four actions.
export const CTX_ACTIONS = {
  moveToPi: 'ctxMoveToPi',
  assignField: 'ctxAssignField',
  deleteSelected: 'ctxDeleteSelected',
  splitItem: 'ctxSplitItem',
  moveRank: 'ctxMoveRank',
} as const;

registerActions({
  [CTX_ACTIONS.moveRank]: (el) => {
    void contextMoveRank(el.dataset.direction ?? '');
  },
  [CTX_ACTIONS.moveToPi]: (el) => {
    void contextMoveToPI(el.dataset.section ?? '');
  },
  [CTX_ACTIONS.assignField]: (el) => {
    void contextAssignField(el.dataset.field ?? '', el.dataset.value ?? '');
  },
  [CTX_ACTIONS.deleteSelected]: () => {
    void contextDeleteSelected();
  },
  [CTX_ACTIONS.splitItem]: () => {
    contextSplitItem();
  },
});

// Typed input-action registration (issue #461 migration — see actions.ts
// for the registerInputActions pattern, generalized from the click/change
// registries). Reuses the search box's existing data-input-action="..."
// string value (index.html) as the registered name, same convention the
// registerChangeActions migrations use for a single-site action.
registerInputActions({
  applyFiltersDebounced: () => {
    applyFiltersDebounced();
  },
});

// Typed context-action registration (issue #461 migration — see actions.ts's
// context-menu-event registry, spiked on this one site). Replaces
// oncontextmenu="handleItemContextMenu(event,'${filename}','${docType}')"
// (list-render.ts's row template) with a `data-context-action` string and
// this handler, reusing the row's existing `data-filename`/`data-doctype`
// attributes (already read by LIST_ITEM_ACTIONS.itemClick above) rather
// than adding duplicate ones.
registerContextActions({
  [LIST_ITEM_CTX_ACTIONS.itemContextMenu]: (el, e) => {
    handleItemContextMenu(e, el.dataset.filename ?? '', el.dataset.doctype ?? '');
  },
});

export function showContextMenu(x: number, y: number): void {
  closeContextMenu();
  const count = selectedItems.size;
  if (!count) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'list-context-menu';

  // "Move to PI" submenu
  const piOptions: { label: string; badge: string | null; section: string }[] = [];
  if (piSettings.currentPi)
    piOptions.push({ label: piSettings.currentPi, badge: 'Current', section: 'currentPi' });
  if (piSettings.nextPi)
    piOptions.push({ label: piSettings.nextPi, badge: 'Next', section: 'nextPi' });
  piOptions.push({ label: 'Backlog (clear version)', badge: null, section: 'backlog' });

  const piItems = piOptions
    .map((opt) => {
      const badge = opt.badge ? `<span class="ctx-badge">${escHtml(opt.badge)}</span>` : '';
      return `<button class="ctx-item" data-action="${CTX_ACTIONS.moveToPi}" data-section="${escHtml(opt.section)}">
      ${badge}${escHtml(opt.label)}
    </button>`;
    })
    .join('');

  // "Assign Sprint" submenu — collect sprints from all PIs
  const allSprints = new Map<string, string>();
  for (const [pi, sprints] of Object.entries(sprintConfig)) {
    for (const s of sprints as { name: string }[]) {
      if (!allSprints.has(s.name)) allSprints.set(s.name, pi);
    }
  }
  const sprintItems = Array.from(allSprints.entries())
    .map(
      ([name, _pi]) =>
        `<button class="ctx-item" data-action="${CTX_ACTIONS.assignField}" data-field="sprint" data-value="${escHtml(name)}">${escHtml(name)}</button>`
    )
    .join('');
  const sprintClear = `<button class="ctx-item" data-action="${CTX_ACTIONS.assignField}" data-field="sprint" data-value="">Clear sprint</button>`;

  // "Assign Team" submenu
  const teamItems = (_metaTeams || [])
    .map(
      (t) =>
        `<button class="ctx-item" data-action="${CTX_ACTIONS.assignField}" data-field="team" data-value="${escHtml(t)}">${escHtml(t)}</button>`
    )
    .join('');
  const teamClear = `<button class="ctx-item" data-action="${CTX_ACTIONS.assignField}" data-field="team" data-value="">Clear team</button>`;

  // "Assign Category" submenu
  const catItems = (_metaWorkCategories || [])
    .map(
      (c) =>
        `<button class="ctx-item" data-action="${CTX_ACTIONS.assignField}" data-field="workCategory" data-value="${escHtml(c)}">${escHtml(c)}</button>`
    )
    .join('');
  const catClear = `<button class="ctx-item" data-action="${CTX_ACTIONS.assignField}" data-field="workCategory" data-value="">Clear category</button>`;

  const splitOption =
    count === 1
      ? `
    <div class="ctx-separator"></div>
    <button class="ctx-item" data-action="${CTX_ACTIONS.splitItem}">✂ Split Issue</button>`
      : '';

  // "Move" (reorder priority) — reranks the selection within each type group.
  // Works for a single item or a whole multi-selection; children of a moved
  // parent follow it via the tree's visual nesting, so their rank is untouched.
  const moveItems = `
    <button class="ctx-item" data-action="${CTX_ACTIONS.moveRank}" data-direction="up">Move up</button>
    <button class="ctx-item" data-action="${CTX_ACTIONS.moveRank}" data-direction="down">Move down</button>
    <button class="ctx-item" data-action="${CTX_ACTIONS.moveRank}" data-direction="top">Move to the top</button>
    <button class="ctx-item" data-action="${CTX_ACTIONS.moveRank}" data-direction="bottom">Move to the bottom</button>`;

  menu.innerHTML = `
    <div class="ctx-header">${count} item${count > 1 ? 's' : ''} selected</div>
    <div class="ctx-separator"></div>
    ${moveItems}
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
    <button class="ctx-item ctx-danger" data-action="${CTX_ACTIONS.deleteSelected}">Delete</button>
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

function _closeContextMenuHandler(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest('#list-context-menu')) closeContextMenu();
}
function _closeContextMenuOnRightClick(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest('#list-context-menu')) closeContextMenu();
}

export function closeContextMenu(): void {
  const menu = document.getElementById('list-context-menu');
  if (menu) menu.remove();
  document.removeEventListener('mousedown', _closeContextMenuHandler);
  document.removeEventListener('contextmenu', _closeContextMenuOnRightClick);
}

export async function contextMoveRank(direction: string): Promise<void> {
  closeContextMenu();
  if (direction !== 'up' && direction !== 'down' && direction !== 'top' && direction !== 'bottom')
    return;
  const docs = getSelectedDocs();
  if (!docs.length) return;
  await moveSelectionRank(
    docs.map((d) => ({ filename: d.filename, docType: d.docType })),
    direction
  );
}

export async function contextMoveToPI(section: string): Promise<void> {
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
  const allToMove: DocEntry[] = [];
  const seen = new Set<string>();
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
    showJiraToast('error', (err as Error).message);
  }
}

interface BatchDeleteResponse {
  deleted: number;
  skipped?: { reason: string }[];
}

export async function contextDeleteSelected(): Promise<void> {
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
  openModal('delete-overlay');

  // Replace the delete handler temporarily for batch delete
  const btn = document.getElementById('confirm-delete-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      const data = (await postJSON('/api/docs/batch-delete', {
        docs: docs.map((d) => ({ type: d.docType, filename: d.filename })),
      })) as BatchDeleteResponse;
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
      showJiraToast('error', (err as Error).message);
    } finally {
      // Restore original handler
      btn.onclick = executeDelete;
    }
  };
}

export async function contextAssignField(field: string, value: string): Promise<void> {
  closeContextMenu();
  const docs = getSelectedDocs();
  if (!docs.length) return;

  const fieldLabels: Record<string, string> = {
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
    openModal('bulk-assign-overlay');

    const btn = document.getElementById('confirm-bulk-assign-btn') as HTMLButtonElement | null;
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

interface BatchFieldUpdateResponse {
  updated: number;
}

async function _executeBatchFieldUpdate(
  field: string,
  value: string,
  docs: DocEntry[],
  label: string,
  displayValue: string
): Promise<void> {
  try {
    const data = (await postJSON('/api/docs/batch-update-field', {
      field,
      value: value || null,
      docs: docs.map((d) => ({ type: d.docType, filename: d.filename })),
    })) as BatchFieldUpdateResponse;
    clearSelection();
    if (data.updated > 0) {
      showJiraToast('success', `${label} → "${displayValue}" applied to ${data.updated} item(s)`);
    } else {
      showJiraToast('error', 'No items updated');
    }
  } catch (err) {
    showJiraToast('error', (err as Error).message);
  }
}

export function closeBulkAssignDialog(): void {
  closeModal('bulk-assign-overlay');
}

export function getSelectedDocs(): DocEntry[] {
  const docs: DocEntry[] = [];
  for (const key of selectedItems) {
    const [docType, ...rest] = key.split(':');
    const filename = rest.join(':');
    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    if (doc) docs.push(doc);
  }
  return docs;
}
