// ── Roadmap: right-click context menus ──────────────────────────
// Three builders sharing the same popup mechanics: the epic (top panel),
// the story (bottom panel), and the "Add to Sprint" submenu used by both.
import { escHtml, postJSON, showJiraToast, patchJSON, getErrorMessage } from './state.js';
import type { PISettings, SprintConfig } from './state.js';
import { renderRoadmapBoard, updateEstPlacements } from './roadmap-render.js';
import { _rankSortFn } from './list-render.js';
import { openDoc } from './detail.js';
import { upsertDoc } from './store.js';
import { refreshRoadmapView } from './roadmap.js';
import type { RoadmapSprint } from './roadmap.js';
import { positionPopup } from './ui-helpers.js';
import { registerActions } from './actions.js';

// ── Context-menu action names ────────────────────────────────────────────
// Typed data-action registration (issue #461 migration — see actions.ts and
// CTX_ACTIONS in list-filters.ts for the established pattern). The menu HTML
// built below is generated dynamically and previously reached its handlers
// via `onclick="rmCtxMoveEpic(...)"`-style strings routed through main.ts's
// untyped `_dynGlobals` window bridge. It now instead emits
// `data-action="${RM_CTX_ACTIONS.x}"` (+ `data-*` argument attributes) and
// registers its own handlers below, so main.ts needs no case/import/
// _dynGlobals entry for any of these four actions.
export const RM_CTX_ACTIONS = {
  openEpic: 'rmCtxOpenEpicAction',
  moveEpic: 'rmCtxMoveEpicAction',
  moveStory: 'rmCtxMoveStoryAction',
  setSprint: 'rmCtxSetSprintAction',
  setEstSprint: 'rmCtxSetEstSprintAction',
} as const;

registerActions({
  [RM_CTX_ACTIONS.openEpic]: (el) => {
    rmCtxOpenEpic(el.dataset.filename ?? '', el.dataset.docType ?? '');
  },
  [RM_CTX_ACTIONS.moveEpic]: (el) => {
    void rmCtxMoveEpic(
      el.dataset.filename ?? '',
      el.dataset.docType ?? '',
      el.dataset.direction ?? ''
    );
  },
  [RM_CTX_ACTIONS.moveStory]: (el) => {
    void rmCtxMoveStory(
      el.dataset.filename ?? '',
      el.dataset.docType ?? '',
      el.dataset.direction ?? ''
    );
  },
  [RM_CTX_ACTIONS.setSprint]: (el) => {
    void rmCtxSetSprint(
      el.dataset.filename ?? '',
      el.dataset.docType ?? '',
      el.dataset.sprint ?? ''
    );
  },
  [RM_CTX_ACTIONS.setEstSprint]: (el) => {
    void rmCtxSetEstSprint(el.dataset.epic ?? '', el.dataset.from ?? '', el.dataset.sprint ?? '');
  },
});

function _closeRoadmapCtx(): void {
  const el = document.getElementById('rm-context-menu');
  if (el) el.remove();
  document.removeEventListener('mousedown', _rmCtxDismiss);
  document.removeEventListener('contextmenu', _rmCtxDismiss);
}

function _rmCtxDismiss(e: Event): void {
  const menu = document.getElementById('rm-context-menu');
  if (menu && !menu.contains(e.target as Node)) _closeRoadmapCtx();
}

function _showRoadmapCtx(x: number, y: number, html: string): void {
  _closeRoadmapCtx();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'rm-context-menu';
  menu.innerHTML = html;
  document.body.appendChild(menu);

  // Position — keep on-screen
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  positionPopup(menu, x, y);

  setTimeout(() => {
    document.addEventListener('mousedown', _rmCtxDismiss);
    document.addEventListener('contextmenu', _rmCtxDismiss);
  }, 0);
}

// ── Epic context menu (top panel) ────────────────────────────
export function handleEpicContextMenu(e: MouseEvent, filename: string, docType: string): void {
  e.preventDefault();
  e.stopPropagation();

  const doc = allDocs.find((d) => d.filename === filename);
  const title = doc?.title || filename;
  const shortTitle = title.length > 40 ? title.substring(0, 37) + '…' : title;

  const fnAttr = `data-filename="${escHtml(filename)}" data-doc-type="${escHtml(docType)}"`;
  const html = `
    <div class="ctx-header">${escHtml(shortTitle)}</div>
    <div class="ctx-separator"></div>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.openEpic}" ${fnAttr}>Open Epic</button>
    ${_buildSprintSubmenu(filename, docType)}
    <div class="ctx-separator"></div>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.moveEpic}" ${fnAttr} data-direction="up">Move up</button>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.moveEpic}" ${fnAttr} data-direction="down">Move down</button>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.moveEpic}" ${fnAttr} data-direction="top">Move to the top</button>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.moveEpic}" ${fnAttr} data-direction="bottom">Move to the bottom</button>
  `;
  _showRoadmapCtx(e.clientX, e.clientY, html);
}

export function rmCtxOpenEpic(filename: string, docType: string): void {
  _closeRoadmapCtx();
  openDoc(filename, docType);
}

export async function rmCtxMoveEpic(
  filename: string,
  docType: string,
  direction: string
): Promise<void> {
  _closeRoadmapCtx();

  // Get the visible epic cards in current order (respects search filter)
  const cards = [
    ...document.querySelectorAll<HTMLElement>('.rm-epic-card:not([style*="display: none"])'),
  ];
  const filenames = cards.map((c) => c.dataset['filename']).filter(Boolean) as string[];
  const idx = filenames.indexOf(filename);
  if (idx < 0) return;

  // Build the full ordered list of this docType for rerank
  const group = allDocs.filter((d) => d.docType === docType);
  const sorted = [...group].sort(_rankSortFn);
  const srcIdx = sorted.findIndex((d) => d.filename === filename);
  if (srcIdx < 0) return;

  const [item] = sorted.splice(srcIdx, 1);

  let targetIdx: number;
  if (direction === 'up') {
    // Move before the previous visible item in the full sorted list
    const prevFn = filenames[idx - 1];
    if (!prevFn) return;
    targetIdx = sorted.findIndex((d) => d.filename === prevFn);
    if (targetIdx < 0) return;
  } else if (direction === 'down') {
    const nextFn = filenames[idx + 1];
    if (!nextFn) return;
    targetIdx = sorted.findIndex((d) => d.filename === nextFn) + 1;
    if (targetIdx <= 0) return;
  } else if (direction === 'top') {
    // Move to the top position — before the first visible item
    const firstFn = filenames[0];
    targetIdx = firstFn ? sorted.findIndex((d) => d.filename === firstFn) : 0;
    if (targetIdx < 0) targetIdx = 0;
  } else {
    // bottom — after the last visible item
    const lastFn = filenames[filenames.length - 1];
    targetIdx = lastFn ? sorted.findIndex((d) => d.filename === lastFn) + 1 : sorted.length;
    if (targetIdx < 0) targetIdx = sorted.length;
  }

  sorted.splice(targetIdx, 0, item);

  try {
    await postJSON('/api/docs/rerank', {
      type: docType,
      orderedFilenames: sorted.map((d) => d.filename),
    });
    // The server assigns rank = index + 1 for every entry in orderedFilenames —
    // apply that same deterministic update locally instead of refetching the
    // full doc list.
    sorted.forEach((d, i) => upsertDoc({ ...d, rank: i + 1 }));
    refreshRoadmapView();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}

// ── Sprint submenu builder ───────────────────────────────────
// Pure string builder split out of the module-private wrapper below so it's
// testable without the `piSettings`/`sprintConfig` ambient globals — callers
// pass both explicitly, same signature-change extraction as
// roadmap-render.ts's buildRoadmapCardHtml(doc, parent) (#508) and
// documentation.ts's buildSuggestionRowHtml(s, index, selected, expanded)
// (#552).
export function buildSprintSubmenuHtml(
  filename: string,
  docType: string,
  piSettings: PISettings,
  sprintConfig: SprintConfig
): string {
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];
  const seen = new Set<string>();
  let items = '';

  const fnAttr = `data-filename="${escHtml(filename)}" data-doc-type="${escHtml(docType)}"`;
  for (const pi of pis) {
    for (const s of (sprintConfig[pi] as RoadmapSprint[] | undefined) || []) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      items += `<button class="ctx-item" data-action="${RM_CTX_ACTIONS.setSprint}" ${fnAttr} data-sprint="${escHtml(s.name)}">${escHtml(s.name)}</button>`;
    }
  }

  if (!items) return '';

  items += `<div class="ctx-separator"></div>`;
  items += `<button class="ctx-item ctx-danger" data-action="${RM_CTX_ACTIONS.setSprint}" ${fnAttr} data-sprint="">Remove from sprint</button>`;

  return `
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Add to Sprint ▸</button>
      <div class="ctx-submenu">${items}</div>
    </div>`;
}

function _buildSprintSubmenu(filename: string, docType: string): string {
  return buildSprintSubmenuHtml(filename, docType, piSettings, sprintConfig as SprintConfig);
}

// ── Story context menu (bottom panel) ────────────────────────
export function handleStoryContextMenu(e: MouseEvent, filename: string, docType: string): void {
  e.preventDefault();
  e.stopPropagation();

  const doc = allDocs.find((d) => d.filename === filename);
  const title = doc?.title || filename;
  const shortTitle = title.length > 40 ? title.substring(0, 37) + '…' : title;

  const fnAttr = `data-filename="${escHtml(filename)}" data-doc-type="${escHtml(docType)}"`;
  const html = `
    <div class="ctx-header">${escHtml(shortTitle)}</div>
    <div class="ctx-separator"></div>
    ${_buildSprintSubmenu(filename, docType)}
    <div class="ctx-separator"></div>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.moveStory}" ${fnAttr} data-direction="up">Move up</button>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.moveStory}" ${fnAttr} data-direction="down">Move down</button>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.moveStory}" ${fnAttr} data-direction="top">Move to the top</button>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.moveStory}" ${fnAttr} data-direction="bottom">Move to the bottom</button>
  `;
  _showRoadmapCtx(e.clientX, e.clientY, html);
}

export async function rmCtxMoveStory(
  filename: string,
  docType: string,
  direction: string
): Promise<void> {
  _closeRoadmapCtx();

  // Find the card and its sprint column
  const card = document.querySelector<HTMLElement>(
    `.roadmap-card[data-filename="${CSS.escape(filename)}"]`
  );
  if (!card) return;
  const column = card.closest('.roadmap-card-list');
  if (!column) return;

  // Get the ordered filenames in this column
  const cards = [...column.querySelectorAll<HTMLElement>('.roadmap-card')];
  const filenames = cards.map((c) => c.dataset['filename']);
  const idx = filenames.indexOf(filename);
  if (idx < 0) return;

  // Build the full sorted list for this docType
  const group = allDocs.filter((d) => d.docType === docType);
  const sorted = [...group].sort(_rankSortFn);
  const srcIdx = sorted.findIndex((d) => d.filename === filename);
  if (srcIdx < 0) return;

  const [item] = sorted.splice(srcIdx, 1);

  let targetIdx: number;
  if (direction === 'up') {
    const prevFn = filenames[idx - 1];
    if (!prevFn) return;
    targetIdx = sorted.findIndex((d) => d.filename === prevFn);
    if (targetIdx < 0) return;
  } else if (direction === 'down') {
    const nextFn = filenames[idx + 1];
    if (!nextFn) return;
    targetIdx = sorted.findIndex((d) => d.filename === nextFn) + 1;
    if (targetIdx <= 0) return;
  } else if (direction === 'top') {
    const firstFn = filenames[0];
    targetIdx = firstFn ? sorted.findIndex((d) => d.filename === firstFn) : 0;
    if (targetIdx < 0) targetIdx = 0;
  } else {
    const lastFn = filenames[filenames.length - 1];
    targetIdx = lastFn ? sorted.findIndex((d) => d.filename === lastFn) + 1 : sorted.length;
    if (targetIdx < 0) targetIdx = sorted.length;
  }

  sorted.splice(targetIdx, 0, item);

  try {
    await postJSON('/api/docs/rerank', {
      type: docType,
      orderedFilenames: sorted.map((d) => d.filename),
    });
    // The server assigns rank = index + 1 for every entry in orderedFilenames —
    // apply that same deterministic update locally instead of refetching the
    // full doc list.
    sorted.forEach((d, i) => upsertDoc({ ...d, rank: i + 1 }));
    refreshRoadmapView();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}

// ── Estimated-sprint placeholder card context menu ───────────
// Phantom cards from an epic's "Estimated Sprint Size" aren't real docs, so
// they get their own menu: open the epic + move the placeholder between sprints
// (which edits the epic's persisted estimatedSprints multiset). Rerank/move
// up-down don't apply — placeholders have no rank.
export function handleEstCardContextMenu(
  e: MouseEvent,
  epicFilename: string,
  fromSprint: string
): void {
  e.preventDefault();
  e.stopPropagation();

  const doc = allDocs.find((d) => d.filename === epicFilename);
  const title = doc?.title || epicFilename;
  const shortTitle = title.length > 36 ? title.substring(0, 33) + '…' : title;

  const html = `
    <div class="ctx-header">${escHtml(shortTitle)} · estimate</div>
    <div class="ctx-separator"></div>
    <button class="ctx-item" data-action="${RM_CTX_ACTIONS.openEpic}" data-filename="${escHtml(epicFilename)}" data-doc-type="epic">Open Epic</button>
    ${_buildEstSprintSubmenu(epicFilename, fromSprint)}
  `;
  _showRoadmapCtx(e.clientX, e.clientY, html);
}

function _buildEstSprintSubmenu(epicFilename: string, fromSprint: string): string {
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];
  const seen = new Set<string>();
  let items = '';

  const base = `data-epic="${escHtml(epicFilename)}" data-from="${escHtml(fromSprint)}"`;
  for (const pi of pis) {
    for (const s of ((sprintConfig as SprintConfig)[pi] as RoadmapSprint[] | undefined) || []) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      const mark = s.name === fromSprint ? ' ✓' : '';
      items += `<button class="ctx-item" data-action="${RM_CTX_ACTIONS.setEstSprint}" ${base} data-sprint="${escHtml(s.name)}">${escHtml(s.name)}${mark}</button>`;
    }
  }

  if (!items) return '';

  if (fromSprint) {
    items += `<div class="ctx-separator"></div>`;
    items += `<button class="ctx-item ctx-danger" data-action="${RM_CTX_ACTIONS.setEstSprint}" ${base} data-sprint="">Move to Unassigned</button>`;
  }

  return `
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Add to Sprint ▸</button>
      <div class="ctx-submenu">${items}</div>
    </div>`;
}

export async function rmCtxSetEstSprint(
  epicFilename: string,
  fromSprint: string,
  toSprint: string
): Promise<void> {
  _closeRoadmapCtx();

  const epic = allDocs.find((d) => d.filename === epicFilename && d.docType === 'epic');
  if (!epic) return;

  const placements = updateEstPlacements(
    epic.estimatedSprints || [],
    epic.estimatedSprintSize || 0,
    fromSprint || null,
    toSprint || null
  );

  try {
    await patchJSON(`/api/doc/epic/${encodeURIComponent(epicFilename)}`, {
      estimatedSprints: placements,
    });
    upsertDoc({ ...epic, estimatedSprints: placements });
    renderRoadmapBoard();
    showJiraToast(
      'success',
      toSprint ? `Estimate moved to ${toSprint}` : 'Estimate moved to Unassigned'
    );
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}

// ── Set sprint from context menu ────────────────────────────
export async function rmCtxSetSprint(
  filename: string,
  docType: string,
  sprintName: string
): Promise<void> {
  _closeRoadmapCtx();

  try {
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, {
      sprint: sprintName || null,
    });
    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    if (doc) upsertDoc({ ...doc, sprint: sprintName || null });
    renderRoadmapBoard();
    showJiraToast('success', sprintName ? `Moved to ${sprintName}` : 'Removed from sprint');
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}
