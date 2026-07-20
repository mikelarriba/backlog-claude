// ── Roadmap: right-click context menus ──────────────────────────
// Three builders sharing the same popup mechanics: the epic (top panel),
// the story (bottom panel), and the "Add to Sprint" submenu used by both.
import { escHtml, postJSON, showJiraToast, patchJSON, getErrorMessage } from './state.js';
import type { SprintConfig } from './state.js';
import { renderRoadmapBoard } from './roadmap-render.js';
import { _rankSortFn } from './list-render.js';
import { openDoc } from './detail.js';
import { upsertDoc } from './store.js';
import { refreshRoadmapView } from './roadmap.js';
import type { RoadmapSprint } from './roadmap.js';
import { positionPopup } from './ui-helpers.js';

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

  const html = `
    <div class="ctx-header">${escHtml(shortTitle)}</div>
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick="rmCtxOpenEpic('${escHtml(filename)}','${escHtml(docType)}')">Open Epic</button>
    ${_buildSprintSubmenu(filename, docType)}
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick="rmCtxMoveEpic('${escHtml(filename)}','${escHtml(docType)}','up')">Move up</button>
    <button class="ctx-item" onclick="rmCtxMoveEpic('${escHtml(filename)}','${escHtml(docType)}','down')">Move down</button>
    <button class="ctx-item" onclick="rmCtxMoveEpic('${escHtml(filename)}','${escHtml(docType)}','top')">Move to the top</button>
    <button class="ctx-item" onclick="rmCtxMoveEpic('${escHtml(filename)}','${escHtml(docType)}','bottom')">Move to the bottom</button>
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
function _buildSprintSubmenu(filename: string, docType: string): string {
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];
  const seen = new Set<string>();
  let items = '';

  for (const pi of pis) {
    for (const s of ((sprintConfig as SprintConfig)[pi] as RoadmapSprint[] | undefined) || []) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      items += `<button class="ctx-item" onclick="rmCtxSetSprint('${escHtml(filename)}','${escHtml(docType)}','${escHtml(s.name)}')">${escHtml(s.name)}</button>`;
    }
  }

  if (!items) return '';

  items += `<div class="ctx-separator"></div>`;
  items += `<button class="ctx-item ctx-danger" onclick="rmCtxSetSprint('${escHtml(filename)}','${escHtml(docType)}','')">Remove from sprint</button>`;

  return `
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Add to Sprint ▸</button>
      <div class="ctx-submenu">${items}</div>
    </div>`;
}

// ── Story context menu (bottom panel) ────────────────────────
export function handleStoryContextMenu(e: MouseEvent, filename: string, docType: string): void {
  e.preventDefault();
  e.stopPropagation();

  const doc = allDocs.find((d) => d.filename === filename);
  const title = doc?.title || filename;
  const shortTitle = title.length > 40 ? title.substring(0, 37) + '…' : title;

  const html = `
    <div class="ctx-header">${escHtml(shortTitle)}</div>
    <div class="ctx-separator"></div>
    ${_buildSprintSubmenu(filename, docType)}
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick="rmCtxMoveStory('${escHtml(filename)}','${escHtml(docType)}','up')">Move up</button>
    <button class="ctx-item" onclick="rmCtxMoveStory('${escHtml(filename)}','${escHtml(docType)}','down')">Move down</button>
    <button class="ctx-item" onclick="rmCtxMoveStory('${escHtml(filename)}','${escHtml(docType)}','top')">Move to the top</button>
    <button class="ctx-item" onclick="rmCtxMoveStory('${escHtml(filename)}','${escHtml(docType)}','bottom')">Move to the bottom</button>
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
