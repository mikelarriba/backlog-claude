// ── Refine canvas: rendering and persistence ───────────────────
import { escHtml, TYPE_LABEL, postJSON, putJSON, fetchJSON, deleteJSON } from './state.js';
export { computeAutoLayout } from './canvasLayout.js';
import {
  computeAutoLayout,
  compactLayout,
  buildBlocksAndParallel,
  computeSecEdges,
  computeCanvasRanks,
} from './canvasLayout.js';
import { openRefinePanel, openManualRefine } from './refine.js';
import {
  _showEpicContextMenu,
  _showEmptyCellMenu,
  _showCardContextMenu,
  _showMultiCardContextMenu,
  _showFpCardContextMenu,
} from './refine-nodes.js';
import { _showEdgePopup, _showLinkPopup } from './refine-edges.js';
// Grid constants
const CELL_W = 240;
const CELL_H = 110;
const GUTTER_X = 60;
const GUTTER_Y = 36;
const TOP_OFFSET = 80;
// ── Keyboard-operable link creation (#486 phase 4/N) ────────────
// Mirrors the mouse rubber-band-line flow below (mousedown on a
// .canvas-handle → drag → mouseup over a target card → _showLinkPopup) with
// a "pick up source, then confirm target" keyboard alternative: Enter/Space
// on a handle starts link mode from that card, Tab moves focus to another
// card's handle, and Enter/Space there confirms it as the target and opens
// the same _showLinkPopup. Escape cancels. Purely additive — the mouse path
// is untouched.
let _canvasLinkModeSource = null;
let _canvasLinkModeEscListener = null;
// No aria-live region exists elsewhere in the app yet, so this adds one,
// visually hidden but announced to screen readers, following the same
// lazily-created/appended-to-body convention used by the mouse-flow popups
// in this file (#486 phase 4/N).
function _canvasLinkStatusRegion() {
  let el = document.getElementById('canvas-link-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'canvas-link-status';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    document.body.appendChild(el);
  }
  return el;
}
function _announceCanvasLinkStatus(message) {
  _canvasLinkStatusRegion().textContent = message;
}
// aria-live region for the keyboard-operable node-move alternatives below
// (both the main canvas grid and the feature multi-panel mini-canvas),
// generalizing the same lazily-created/appended-to-body announcement
// pattern used for canvas link mode above (#486 phase 4/N), backlog list
// rerank (#486 phase 6/N, dragdrop.ts's _listReorderStatusRegion), and
// roadmap card move (#486 phase 7/N, roadmap-drag.ts's
// _roadmapDragStatusRegion) to the last remaining drag interaction.
function _canvasMoveStatusRegion() {
  let el = document.getElementById('canvas-move-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'canvas-move-status';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    document.body.appendChild(el);
  }
  return el;
}
function _announceCanvasMoveStatus(message) {
  _canvasMoveStatusRegion().textContent = message;
}
const CANVAS_MOVE_BLOCKED_EDGE = {
  up: 'top',
  down: 'bottom',
  left: 'left edge',
  right: 'right edge',
};
// Ends keyboard link mode (on confirm, cancel, or Manage Links being turned
// off) — clears the tracked source, its visual highlight, and the Escape
// listener registered by _startCanvasLinkMode.
export function _endCanvasLinkMode(announce) {
  _canvasLinkModeSource = null;
  document
    .querySelectorAll('.canvas-card.canvas-link-source')
    .forEach((el) => el.classList.remove('canvas-link-source'));
  if (_canvasLinkModeEscListener) {
    document.removeEventListener('keydown', _canvasLinkModeEscListener);
    _canvasLinkModeEscListener = null;
  }
  if (announce) _announceCanvasLinkStatus(announce);
}
function _startCanvasLinkMode(card, filename, docType, title) {
  _canvasLinkModeSource = { filename, docType, title };
  card.classList.add('canvas-link-source');
  _announceCanvasLinkStatus(
    `Link mode: creating a link from ${title}. Tab to another card's link handle and press Enter or Space to confirm, or press Escape to cancel.`
  );
  _canvasLinkModeEscListener = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    _endCanvasLinkMode('Link creation cancelled.');
  };
  document.addEventListener('keydown', _canvasLinkModeEscListener);
}
// Pure grid-geometry math, extracted from renderCanvas so the pixel layout
// calculations are unit-testable without a DOM (#460). One extra row/col is
// always added beyond the occupied extent so there's always room to drop a
// card past the last populated cell.
export function computeCanvasGridDimensions(usedCols, usedRows, effectiveTopOffset) {
  const occupiedCols = usedCols.length || 1;
  const occupiedRows = usedRows.length || 1;
  const gridCols = occupiedCols + 1;
  const gridRows = occupiedRows + 1;
  const totalW = GUTTER_X + gridCols * (CELL_W + GUTTER_X);
  const totalH = effectiveTopOffset + gridRows * (CELL_H + GUTTER_Y) + GUTTER_Y;
  return { gridCols, gridRows, totalW, totalH };
}
// Pure: top-left pixel position of a grid cell, extracted from renderCanvas's
// `cellAt` closure so it's unit-testable without a DOM (#460).
export function cellPixelPosition(col, row, effectiveTopOffset) {
  return {
    x: GUTTER_X + col * (CELL_W + GUTTER_X),
    y: effectiveTopOffset + row * (CELL_H + GUTTER_Y),
  };
}
// Pure: given a card's current grid cell and an arrow-key direction, returns
// the target cell for the keyboard-operable move alternative below, or
// undefined for a no-op. Mirrors the grid's own growth model — the occupied
// extent always gets one extra row/col of expansion room (see
// computeCanvasGridDimensions), so 'down'/'right' are never blocked, while
// 'up'/'left' stop at row/col 0 since negative grid coordinates aren't a
// valid layout position (#486 phase 3/N). Bounds-free by design, so it's
// reused as-is by the feature multi-panel mini-canvas's own keyboard move
// below — that grid has no fixed extent either (#486 phase 5/N).
export function computeCanvasMoveTarget(col, row, direction) {
  switch (direction) {
    case 'up':
      return row > 0 ? { col, row: row - 1 } : undefined;
    case 'down':
      return { col, row: row + 1 };
    case 'left':
      return col > 0 ? { col: col - 1, row } : undefined;
    case 'right':
      return { col: col + 1, row };
  }
}
// Shared by the mouse fp-drop-cell drop handler in _renderFpCanvas below and
// the keyboard-operable move alternative attached to each fp-card's move
// handle — writes the new grid cell into the panel's layout, persists it,
// and re-renders. Mirrors applyCanvasCardMove's role for the main canvas so
// the mouse and keyboard paths cannot drift (#486 phase 5/N).
async function applyFpCardMove(epicFilename, ps, featureFilename, filename, newCol, newRow) {
  const layoutEntries = ps.layout;
  const cur = layoutEntries[filename] || {};
  if (cur.col === newCol && cur.row === newRow) return;
  layoutEntries[filename] = { col: newCol, row: newRow };
  await saveCanvasLayout(ps, epicFilename);
  _renderFpCanvas(epicFilename, ps, featureFilename);
}
// Focus is lost when _renderFpCanvas rebuilds the mini-canvas, since the old
// card/handle elements are discarded — restore it to the moved card's
// (re-rendered) move handle, matching refocusCanvasMoveHandle's role for the
// main canvas (#486 phase 5/N).
function refocusFpMoveHandle(filename) {
  setTimeout(() => {
    document
      .querySelector(`.fp-card[data-filename="${CSS.escape(filename)}"] .canvas-move-handle`)
      ?.focus();
  }, 50);
}
// Keyboard-operable alternative to the HTML5 fp-drop-cell drag reposition in
// _renderFpCanvas below — moves `filename` one grid cell in `direction`,
// reusing the same applyFpCardMove() the mouse drop handler uses, then
// restores focus to the moved card's re-rendered move handle. Purely
// additive: does not change or remove the existing drag-and-drop behavior
// (#486 phase 5/N).
async function moveFpCardByKeyboard(epicFilename, ps, featureFilename, filename, pos, direction) {
  const title = allDocs.find((d) => d.filename === filename)?.title ?? 'Item';
  const target = computeCanvasMoveTarget(pos.col, pos.row, direction);
  if (!target) {
    _announceCanvasMoveStatus(
      `${title} is already at the ${CANVAS_MOVE_BLOCKED_EDGE[direction]} of the canvas.`
    );
    return;
  }
  await applyFpCardMove(epicFilename, ps, featureFilename, filename, target.col, target.row);
  _announceCanvasMoveStatus(`Moved ${title} ${direction}.`);
  refocusFpMoveHandle(filename);
}
// ── Mini-canvas rendering for feature multi-panel view ────────
export function _renderFpCanvas(epicFilename, ps, featureFilename) {
  const container = document.getElementById(`fp-canvas-${epicFilename}`);
  if (!container) return;
  container.innerHTML = '';
  if (!ps.stories.length) {
    container.innerHTML = '<div class="fp-canvas-empty">No stories yet</div>';
    return;
  }
  const CELL_W = 200,
    CELL_H = 90,
    GUTTER_X = 14,
    GUTTER_Y = 14;
  const rawPositions = {};
  for (const c of ps.stories)
    rawPositions[c.filename] = ps.layout[c.filename] || {
      col: 0,
      row: 0,
    };
  const { positions, usedCols, usedRows } = compactLayout(rawPositions);
  const cols = usedCols.length || 1;
  const rows = usedRows.length || 1;
  const totalW = GUTTER_X + cols * (CELL_W + GUTTER_X);
  const totalH = GUTTER_Y + rows * (CELL_H + GUTTER_Y);
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:relative;width:${totalW}px;min-height:${totalH}px`;
  const cellAt = (col, row) => cellPixelPosition(col, row, GUTTER_Y);
  // SVG edges
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `position:absolute;top:0;left:0;width:${totalW}px;height:${totalH}px;pointer-events:none;overflow:visible;z-index:1`;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `<marker id="fp-arr-${epicFilename}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#ef4444"/></marker>`;
  svg.appendChild(defs);
  const cardPos = {};
  for (const c of ps.stories) {
    const p = positions[c.filename];
    const { x, y } = cellAt(p.col, p.row);
    cardPos[c.filename] = { cx: x + CELL_W / 2, cy: y + CELL_H / 2, x, y };
  }
  for (const { src, tgt } of ps.blocks) {
    const s = cardPos[src],
      t = cardPos[tgt];
    if (!s || !t) continue;
    const x1 = s.cx,
      y1 = s.y + CELL_H,
      x2 = t.cx,
      y2 = t.y;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} C${x1},${y1 + 10} ${x2},${y2 - 10} ${x2},${y2}`);
    path.setAttribute('stroke', '#ef4444');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', `url(#fp-arr-${epicFilename})`);
    svg.appendChild(path);
  }
  wrap.appendChild(svg);
  // Cards
  for (const c of ps.stories) {
    const p = positions[c.filename];
    const { x, y } = cellAt(p.col, p.row);
    const doc = allDocs.find((d) => d.filename === c.filename);
    const sp = doc?.storyPoints ? `${doc.storyPoints} SP` : '';
    const card = document.createElement('div');
    card.className = `fp-card${sp ? '' : ' no-estimate'}`;
    card.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${CELL_W}px;height:${CELL_H}px`;
    card.setAttribute('draggable', 'true');
    card.dataset.filename = c.filename;
    card.innerHTML = `
      <div class="fp-card-header">
        <span class="type-badge ${c.docType || 'story'}">${TYPE_LABEL[c.docType || 'story'] || c.docType}</span>
        ${sp ? `<span class="canvas-card-sp">${sp}</span>` : ''}
      </div>
      <div class="fp-card-title">${escHtml(c.title || c.filename)}</div>
      <div class="canvas-move-handle" role="button" tabindex="0"
           title="Use arrow keys to move this card one grid cell"
           aria-label="Move ${escHtml(c.title || c.filename)}. Arrow keys move it one cell within the grid."
           ><span></span><span></span><span></span><span></span><span></span><span></span></div>`;
    card.addEventListener('click', () => openRefinePanel(c.filename, c.docType || 'story'));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showFpCardContextMenu(
        e.clientX,
        e.clientY,
        c.filename,
        c.docType || 'story',
        epicFilename,
        featureFilename
      );
    });
    // Drag-drop to reposition within panel
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', c.filename);
    });
    // Keyboard-operable alternative to the HTML5 fp-drop-cell drag
    // reposition below — moves the focused card one grid cell per arrow key
    // press, reusing the same applyFpCardMove() the mouse drop handler uses.
    // Purely additive: does not change or remove the existing drag-and-drop
    // behavior (#486 phase 5/N).
    const moveHandle = card.querySelector('.canvas-move-handle');
    moveHandle?.addEventListener('click', (e) => e.stopPropagation());
    moveHandle?.addEventListener('keydown', (e) => {
      const directions = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const direction = directions[e.key];
      if (!direction) return;
      e.preventDefault();
      e.stopPropagation();
      void moveFpCardByKeyboard(epicFilename, ps, featureFilename, c.filename, p, direction);
    });
    wrap.appendChild(card);
    // Drop zone cells
    const cell = document.createElement('div');
    cell.className = 'canvas-swimlane-cell fp-drop-cell';
    cell.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${CELL_W}px;height:${CELL_H}px`;
    cell.dataset.col = String(p.col);
    cell.dataset.row = String(p.row);
    cell.addEventListener('dragover', (e) => {
      e.preventDefault();
      cell.classList.add('drag-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', async (e) => {
      e.preventDefault();
      cell.classList.remove('drag-over');
      const fn = e.dataTransfer?.getData('text/plain');
      if (!fn || fn === c.filename) return;
      await applyFpCardMove(epicFilename, ps, featureFilename, fn, p.col, p.row);
    });
    wrap.insertBefore(cell, card);
  }
  container.appendChild(wrap);
}
// ── Graph construction ─────────────────────────────────────────
export async function buildCanvasGraph(filename, docType) {
  _canvasSelectedCards.clear();
  let children = [];
  try {
    const data = await fetchJSON(`/api/links/${docType}/${encodeURIComponent(filename)}`);
    children = data.children || [];
  } catch {
    /* render with just the epic node */
  }
  // Load saved layout
  let savedPositions = {};
  try {
    savedPositions = await fetchJSON(`/api/canvas/layout/${encodeURIComponent(filename)}`);
  } catch {
    /* no-op */
  }
  _activePanelState.stories = children;
  const { blocks, parallel } = buildBlocksAndParallel(
    children.map((c) => c.filename),
    (fn) => allDocs.find((d) => d.filename === fn)
  );
  _activePanelState.blocks = blocks;
  _activePanelState.parallel = parallel;
  if (Object.keys(savedPositions).length > 0) {
    _activePanelState.layout = savedPositions;
  } else {
    _activePanelState.layout = computeAutoLayout(
      children,
      _activePanelState.blocks,
      _activePanelState.parallel
    );
    // Save auto-layout and sync ranks so dependency order propagates to list view
    if (Object.keys(_activePanelState.layout).length > 0) {
      saveCanvasLayout(_activePanelState, filename);
    }
  }
  renderCanvas(filename, docType);
}
// ── Lightweight edge rebuild (preserves card positions) ────────
export function rebuildCanvasEdges(ps = _activePanelState) {
  const { blocks, parallel } = buildBlocksAndParallel(
    ps.stories.map((c) => c.filename),
    (fn) => allDocs.find((d) => d.filename === fn)
  );
  ps.blocks = blocks;
  ps.parallel = parallel;
}
// Shared by the mouse cell-drop handler in renderCanvas below and the
// keyboard-operable move alternative attached to each card's move handle —
// writes the new grid cell into the layout, persists it, and re-renders.
// Keeping this as a single function means the mouse and keyboard paths
// cannot drift (#486 phase 3/N).
async function applyCanvasCardMove(epicFilename, docType, filename, newCol, newRow) {
  const layoutEntries = _activePanelState.layout;
  const cur = layoutEntries[filename] || {};
  if (cur.col === newCol && cur.row === newRow) return;
  layoutEntries[filename] = { col: newCol, row: newRow };
  await saveCanvasLayout(_activePanelState, epicFilename);
  renderCanvas(epicFilename, docType);
}
// Focus is lost when renderCanvas rebuilds the grid, since the old card/
// handle elements are discarded — restore it to the moved card's
// (re-rendered) move handle so repeated key presses keep working without
// re-tabbing, matching the same pattern used for backlog list rerank and
// roadmap card move.
function refocusCanvasMoveHandle(filename) {
  setTimeout(() => {
    document
      .querySelector(`.canvas-card[data-filename="${CSS.escape(filename)}"] .canvas-move-handle`)
      ?.focus();
  }, 50);
}
// Keyboard-operable alternative to the HTML5 cell-drag reposition in
// renderCanvas below — moves `filename` one grid cell in `direction`,
// reusing the same applyCanvasCardMove() the mouse cell-drop handler uses,
// then restores focus to the moved card's re-rendered move handle. Purely
// additive: does not change or remove the existing drag-and-drop behavior
// (#486 phase 3/N).
async function moveCanvasCardByKeyboard(epicFilename, docType, filename, pos, direction) {
  const title = allDocs.find((d) => d.filename === filename)?.title ?? 'Item';
  const target = computeCanvasMoveTarget(pos.col, pos.row, direction);
  if (!target) {
    _announceCanvasMoveStatus(
      `${title} is already at the ${CANVAS_MOVE_BLOCKED_EDGE[direction]} of the canvas.`
    );
    return;
  }
  await applyCanvasCardMove(epicFilename, docType, filename, target.col, target.row);
  _announceCanvasMoveStatus(`Moved ${title} ${direction}.`);
  refocusCanvasMoveHandle(filename);
}
// ── Render canvas ──────────────────────────────────────────────
export function renderCanvas(epicFilename, docType) {
  const container = document.getElementById('refine-canvas');
  if (!container) return;
  container.innerHTML = '';
  container.style.position = 'relative';
  container.style.overflow = 'auto';
  if (!_activePanelState.stories.length) {
    container.innerHTML =
      '<div class="canvas-empty">No stories linked to this epic yet. Use the buttons above to add some.</div>';
    return;
  }
  // Resolve feature parent banner (only when viewing an epic)
  let featureDoc = null;
  let bannerOffset = 0;
  if (docType === 'epic') {
    const epicEntry = allDocs.find((d) => d.filename === epicFilename && d.docType === 'epic');
    if (epicEntry?.parentFilename) {
      featureDoc = allDocs.find(
        (d) => d.filename === epicEntry.parentFilename && d.docType === 'feature'
      );
    }
  }
  if (featureDoc) bannerOffset = 44;
  // Effective top offset for grid (shifted down when banner is present)
  const effectiveTopOffset = TOP_OFFSET + bannerOffset;
  // Compact layout: remap col/row values to remove gaps
  const layoutEntries = _activePanelState.layout;
  const { positions: compacted, changed, usedCols, usedRows } = compactLayout(layoutEntries);
  if (usedCols.length || usedRows.length) {
    Object.assign(layoutEntries, compacted);
    if (changed) saveCanvasLayout(_activePanelState, epicFilename);
  }
  // Grid dimensions: occupied + 1 extra row/col for expansion
  const { gridCols, gridRows, totalW, totalH } = computeCanvasGridDimensions(
    usedCols,
    usedRows,
    effectiveTopOffset
  );
  // Wrapper sized to content (enables scrolling)
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `position:relative;width:${totalW}px;height:${totalH}px`;
  container.appendChild(wrapper);
  // SVG overlay (on top of everything, pointer-events:none)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `position:absolute;top:0;left:0;width:${totalW}px;height:${totalH}px;pointer-events:none;overflow:visible;z-index:3`;
  wrapper.appendChild(svg);
  // Feature parent banner (when viewing an epic with a Feature parent)
  if (featureDoc) {
    const banner = document.createElement('div');
    banner.className = 'canvas-feature-banner';
    banner.style.cssText = `position:absolute;left:${GUTTER_X}px;top:8px;right:${GUTTER_X}px;z-index:2`;
    banner.innerHTML = `
      <span class="type-badge feature">Feature</span>
      <span class="canvas-feature-title">${escHtml(featureDoc.title || featureDoc.filename)}</span>`;
    banner.style.cursor = 'pointer';
    banner.title = 'Open feature in refinement view';
    banner.addEventListener('click', () => openManualRefine(featureDoc.filename, 'feature'));
    wrapper.appendChild(banner);
  }
  // Epic title node at top center
  const epicDoc = allDocs.find((d) => d.filename === epicFilename && d.docType === docType);
  const epicNode = document.createElement('div');
  epicNode.className = 'canvas-epic-node';
  const epicCenterX = totalW / 2;
  epicNode.style.cssText = `position:absolute;left:${epicCenterX - 110}px;top:${14 + bannerOffset}px;width:220px;z-index:2`;
  epicNode.innerHTML = `
    <span class="type-badge ${docType}">${TYPE_LABEL[docType] || docType}</span>
    <span class="canvas-epic-title">${escHtml(epicDoc?.title || epicFilename)}</span>`;
  epicNode.style.cursor = 'pointer';
  epicNode.addEventListener('click', () => {
    document
      .querySelectorAll('.canvas-card.selected')
      .forEach((el) => el.classList.remove('selected'));
    openRefinePanel(epicFilename, docType);
  });
  if (docType === 'epic') {
    epicNode.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showEpicContextMenu(e.clientX, e.clientY, epicFilename, featureDoc?.filename || null);
    });
  }
  wrapper.appendChild(epicNode);
  // ── Swimlane grid cells (visible + drop targets) ──────────────
  // During a card drag, wrapper gets class 'drag-active' which sets
  // pointer-events:none on all cards, letting dragover fall through to cells.
  const cellAt = (col, row) => cellPixelPosition(col, row, effectiveTopOffset);
  // Build set of occupied cell positions for empty-cell detection
  const _occupiedCells = new Set();
  for (const child of _activePanelState.stories) {
    const pos = layoutEntries[child.filename] || { col: 0, row: 0 };
    _occupiedCells.add(`${pos.col},${pos.row}`);
  }
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const { x, y } = cellAt(col, row);
      const cell = document.createElement('div');
      cell.className = 'canvas-swimlane-cell';
      cell.dataset.col = String(col);
      cell.dataset.row = String(row);
      cell.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${CELL_W}px;height:${CELL_H}px`;
      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', async (e) => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        wrapper.classList.remove('drag-active');
        const fn = e.dataTransfer?.getData('text/plain');
        if (!fn) return;
        const newCol = parseInt(cell.dataset.col);
        const newRow = parseInt(cell.dataset.row);
        await applyCanvasCardMove(epicFilename, docType, fn, newCol, newRow);
      });
      // Right-click on empty cell → create new story/spike/bug
      if (!_occupiedCells.has(`${col},${row}`)) {
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          _showEmptyCellMenu(e.clientX, e.clientY, col, row, epicFilename, docType);
        });
      }
      wrapper.appendChild(cell);
    }
  }
  // ── Story cards ───────────────────────────────────────────────
  const cardPositions = {};
  for (const child of _activePanelState.stories) {
    const pos = layoutEntries[child.filename] || { col: 0, row: 0 };
    const { x, y } = cellAt(pos.col, pos.row);
    const cx = x + CELL_W / 2;
    const cy = y + CELL_H / 2;
    const doc = allDocs.find((d) => d.filename === child.filename);
    const sp = doc?.storyPoints ? `${doc.storyPoints} SP` : '';
    const card = document.createElement('div');
    card.className = `canvas-card${sp ? '' : ' no-estimate'}`;
    card.dataset.filename = child.filename;
    card.dataset.doctype = child.docType || docType;
    // Inset 4px inside the cell so the dashed cell border stays visible
    const INSET = 4;
    card.style.cssText = `position:absolute;left:${x + INSET}px;top:${y + INSET}px;width:${CELL_W - INSET * 2}px;height:${CELL_H - INSET * 2}px;z-index:2`;
    card.setAttribute('draggable', _canvasManageLinks ? 'false' : 'true');
    card.innerHTML = `
      <div class="canvas-card-header">
        <span class="type-badge ${child.docType || docType}">${TYPE_LABEL[child.docType || docType] || child.docType}</span>
        ${sp ? `<span class="canvas-card-sp">${sp}</span>` : ''}
      </div>
      <div class="canvas-card-title">${escHtml(child.title || child.filename)}</div>
      <div class="canvas-move-handle" role="button" tabindex="0"
           title="Use arrow keys to move this card one grid cell"
           aria-label="Move ${escHtml(child.title || child.filename)}. Arrow keys move it one cell within the grid."
           ><span></span><span></span><span></span><span></span><span></span><span></span></div>
      <div class="canvas-handle canvas-handle--top"    data-side="top"    tabindex="0" role="button"
           aria-label="Link handle (top) for ${escHtml(child.title || child.filename)}. Press Enter or Space to start creating a link, then Tab to another card's handle and press Enter or Space again to confirm, or Escape to cancel."></div>
      <div class="canvas-handle canvas-handle--bottom" data-side="bottom" tabindex="0" role="button"
           aria-label="Link handle (bottom) for ${escHtml(child.title || child.filename)}. Press Enter or Space to start creating a link, then Tab to another card's handle and press Enter or Space again to confirm, or Escape to cancel."></div>
      <div class="canvas-handle canvas-handle--left"   data-side="left"   tabindex="0" role="button"
           aria-label="Link handle (left) for ${escHtml(child.title || child.filename)}. Press Enter or Space to start creating a link, then Tab to another card's handle and press Enter or Space again to confirm, or Escape to cancel."></div>
      <div class="canvas-handle canvas-handle--right"  data-side="right"  tabindex="0" role="button"
           aria-label="Link handle (right) for ${escHtml(child.title || child.filename)}. Press Enter or Space to start creating a link, then Tab to another card's handle and press Enter or Space again to confirm, or Escape to cancel."></div>`;
    // Restore the link-mode source highlight across a re-render (e.g. after
    // another keyboard move) so it doesn't silently disappear mid-flow.
    if (_canvasLinkModeSource?.filename === child.filename) {
      card.classList.add('canvas-link-source');
    }
    // Keyboard-operable alternative to the HTML5 cell-drag reposition above —
    // moves the focused card one grid cell per arrow key press, reusing the
    // same applyCanvasCardMove() the mouse cell-drop handler uses. Purely
    // additive: does not change or remove the existing drag-and-drop
    // behavior (#486 phase 3/N).
    const moveHandle = card.querySelector('.canvas-move-handle');
    moveHandle?.addEventListener('click', (e) => e.stopPropagation());
    moveHandle?.addEventListener('keydown', (e) => {
      const directions = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const direction = directions[e.key];
      if (!direction) return;
      e.preventDefault();
      e.stopPropagation();
      void moveCanvasCardByKeyboard(epicFilename, docType, child.filename, pos, direction);
    });
    // Click → open panel (plain) or toggle multi-select (Cmd/Ctrl)
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('canvas-handle')) return;
      if (e.target.classList.contains('canvas-move-handle')) return;
      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+Click: toggle multi-select without opening panel
        if (_canvasSelectedCards.has(child.filename)) {
          _canvasSelectedCards.delete(child.filename);
          card.classList.remove('canvas-multi-selected');
        } else {
          _canvasSelectedCards.add(child.filename);
          card.classList.add('canvas-multi-selected');
        }
        return;
      }
      // Plain click: clear multi-select, select single card, open panel
      _canvasSelectedCards.clear();
      document
        .querySelectorAll('.canvas-card.canvas-multi-selected')
        .forEach((el) => el.classList.remove('canvas-multi-selected'));
      document
        .querySelectorAll('.canvas-card.selected')
        .forEach((el) => el.classList.remove('selected'));
      card.classList.add('selected');
      openRefinePanel(child.filename, child.docType || docType);
    });
    // Right-click → context menu (multi-select aware)
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // If right-clicking a card not in multi-selection, reset to single
      if (_canvasSelectedCards.size > 0 && !_canvasSelectedCards.has(child.filename)) {
        _canvasSelectedCards.clear();
        document
          .querySelectorAll('.canvas-card.canvas-multi-selected')
          .forEach((el) => el.classList.remove('canvas-multi-selected'));
      }
      // If no multi-selection, treat as single-card context menu
      if (_canvasSelectedCards.size <= 1) {
        _canvasSelectedCards.clear();
        document
          .querySelectorAll('.canvas-card.canvas-multi-selected')
          .forEach((el) => el.classList.remove('canvas-multi-selected'));
        _showCardContextMenu(e.clientX, e.clientY, child.filename, epicFilename, docType);
      } else {
        _showMultiCardContextMenu(e.clientX, e.clientY, epicFilename, docType);
      }
    });
    // HTML5 drag to reposition
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', child.filename);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      // Defer so the drag ghost renders before we hide the card
      setTimeout(() => {
        card.classList.add('dragging');
        // pointer-events:none on all cards lets dragover reach the cells beneath
        wrapper.classList.add('drag-active');
      }, 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      wrapper.classList.remove('drag-active');
    });
    // Keyboard-operable alternative to the mousedown rubber-band-line link
    // creation below — Enter/Space on a handle picks up this card as the
    // link source (or, if already in link mode, confirms this card as the
    // target and opens the same _showLinkPopup the mouse flow uses). Purely
    // additive: does not change or remove the existing mouse behavior
    // (#486 phase 4/N).
    card.querySelectorAll('.canvas-handle').forEach((handle) => {
      handle.addEventListener('keydown', (e) => {
        const ke = e;
        if (ke.key !== 'Enter' && ke.key !== ' ') return;
        if (!_canvasManageLinks) return;
        ke.preventDefault();
        ke.stopPropagation();
        const cardDocType = child.docType || docType;
        const cardTitle = child.title || child.filename;
        if (!_canvasLinkModeSource) {
          _startCanvasLinkMode(card, child.filename, cardDocType, cardTitle);
          return;
        }
        if (_canvasLinkModeSource.filename === child.filename) {
          _announceCanvasLinkStatus(
            `Already creating a link from ${cardTitle}. Tab to a different card's handle to link to it, or press Escape to cancel.`
          );
          return;
        }
        const src = _canvasLinkModeSource;
        const rect = handle.getBoundingClientRect();
        _endCanvasLinkMode();
        _showLinkPopup(rect.left, rect.top, src.filename, src.docType, child.filename, cardDocType);
        _announceCanvasLinkStatus(`Choose a dependency type to link ${src.title} to ${cardTitle}.`);
        setTimeout(() => {
          document.querySelector('.canvas-link-popup button')?.focus();
        }, 0);
      });
    });
    // Handle mousedown for rubber-band link creation (Manage Links mode)
    card.querySelectorAll('.canvas-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        const me = e;
        if (!_canvasManageLinks) return;
        me.stopPropagation();
        me.preventDefault();
        card.setAttribute('draggable', 'false');
        const rubberLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        rubberLine.setAttribute('stroke', 'var(--accent)');
        rubberLine.setAttribute('stroke-width', '2');
        rubberLine.setAttribute('stroke-dasharray', '5 3');
        rubberLine.setAttribute('pointer-events', 'none');
        const r0 = svg.getBoundingClientRect();
        rubberLine.setAttribute('x1', String(me.clientX - r0.left));
        rubberLine.setAttribute('y1', String(me.clientY - r0.top));
        rubberLine.setAttribute('x2', String(me.clientX - r0.left));
        rubberLine.setAttribute('y2', String(me.clientY - r0.top));
        svg.appendChild(rubberLine);
        function onMove(mv) {
          const r = svg.getBoundingClientRect();
          rubberLine.setAttribute('x2', String(mv.clientX - r.left));
          rubberLine.setAttribute('y2', String(mv.clientY - r.top));
        }
        function onUp(mu) {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          rubberLine.remove();
          if (!_canvasManageLinks) card.setAttribute('draggable', 'true');
          const els = document.elementsFromPoint(mu.clientX, mu.clientY);
          const tgtCard = els.find((el) => el.classList.contains('canvas-card') && el !== card);
          if (tgtCard) {
            const tgtFn = tgtCard.dataset.filename;
            const tgtDt = tgtCard.dataset.doctype;
            if (tgtFn && tgtFn !== child.filename) {
              _showLinkPopup(
                mu.clientX,
                mu.clientY,
                child.filename,
                child.docType || docType,
                tgtFn,
                tgtDt || ''
              );
            }
          }
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
    wrapper.appendChild(card);
    cardPositions[child.filename] = { cx, cy, x, y };
  }
  // Draw SVG edges on top
  drawCanvasEdges(svg, cardPositions, epicFilename, epicCenterX, totalW);
}
// ── Draw SVG edges ─────────────────────────────────────────────
function drawCanvasEdges(svg, cardPositions, _epicFilename, _epicCenterX, _totalW) {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="arrow-blocks" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#ef4444"/>
    </marker>
    <marker id="arrow-sec" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="var(--border)"/>
    </marker>`;
  svg.appendChild(defs);
  // Helper: make a path clickable with a wider transparent hit area
  function addHitArea(svg, d, onClick) {
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '14');
    hit.setAttribute('fill', 'none');
    hit.setAttribute('pointer-events', 'stroke');
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', onClick);
    svg.appendChild(hit);
  }
  // SEC arrows: cards sharing a column, consecutive rows (skipped where a
  // BLOCKS edge already connects the pair — BLOCKS takes precedence)
  const blocksList = _activePanelState.blocks;
  const parallelList = _activePanelState.parallel;
  const secEdges = computeSecEdges(_activePanelState.layout, blocksList);
  for (const { src: srcFn, tgt: tgtFn } of secEdges) {
    const src = cardPositions[srcFn];
    const tgt = cardPositions[tgtFn];
    if (!src || !tgt || src === tgt) continue;
    const x1 = src.cx,
      y1 = src.y + CELL_H;
    const x2 = tgt.cx,
      y2 = tgt.y;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} C${x1},${y1 + 20} ${x2},${y2 - 20} ${x2},${y2}`);
    path.setAttribute('stroke', 'var(--border)');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#arrow-sec)');
    svg.appendChild(path);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(x1 + 6));
    label.setAttribute('y', String(y1 + (y2 - y1) / 2));
    label.setAttribute('class', 'canvas-edge-label');
    label.textContent = 'SEC';
    svg.appendChild(label);
  }
  // BLOCKS arrows (red) — clickable
  for (const { src, tgt } of blocksList) {
    if (src === tgt) continue;
    const s = cardPositions[src];
    const t = cardPositions[tgt];
    if (!s || !t) continue;
    const srcDt =
      _activePanelState.stories.find((c) => c.filename === src)?.docType || _canvasDocType;
    const tgtDt =
      _activePanelState.stories.find((c) => c.filename === tgt)?.docType || _canvasDocType;
    const x1 = s.cx,
      y1 = s.y + CELL_H;
    const x2 = t.cx,
      y2 = t.y;
    const d = `M${x1},${y1} C${x1},${y1 + 24} ${x2},${y2 - 24} ${x2},${y2}`;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', '#ef4444');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#arrow-blocks)');
    svg.appendChild(path);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String((x1 + x2) / 2 + 4));
    label.setAttribute('y', String((y1 + y2) / 2));
    label.setAttribute('class', 'canvas-edge-label canvas-edge-label--blocks');
    label.textContent = 'BLOCKS';
    svg.appendChild(label);
    addHitArea(svg, d, (e) => {
      e.stopPropagation();
      _showEdgePopup(e.clientX, e.clientY, 'blocks', src, srcDt || '', tgt, tgtDt || '');
    });
  }
  // PARALLEL brackets — clickable
  for (const { a, b } of parallelList) {
    const pa = cardPositions[a];
    const pb = cardPositions[b];
    if (!pa || !pb) continue;
    const aDt = _activePanelState.stories.find((c) => c.filename === a)?.docType || _canvasDocType;
    const bDt = _activePanelState.stories.find((c) => c.filename === b)?.docType || _canvasDocType;
    const x1 = pa.x;
    const x2 = pb.x + CELL_W;
    const y = Math.min(pa.y, pb.y) - 14;
    const d = `M${x1},${pa.y - 4} V${y} H${x2} V${pb.y - 4}`;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'var(--type-story-color, #3b82f6)');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-dasharray', '5 3');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String((x1 + x2) / 2));
    label.setAttribute('y', String(y - 3));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'canvas-edge-label canvas-edge-label--parallel');
    label.textContent = 'PARALLEL';
    svg.appendChild(label);
    addHitArea(svg, d, (e) => {
      e.stopPropagation();
      _showEdgePopup(e.clientX, e.clientY, 'parallel', a, aDt || '', b, bDt || '');
    });
  }
}
export async function saveCanvasLayout(ps = _activePanelState, parentFilename) {
  const fn = parentFilename || _canvasEpicFilename;
  if (!fn) return;
  try {
    await putJSON(`/api/canvas/layout/${encodeURIComponent(fn)}`, { positions: ps.layout });
  } catch {
    /* silent */
  }
  await syncCanvasRanks(ps);
}
// ── Sync canvas grid order → Rank frontmatter field ──────────
async function syncCanvasRanks(ps = _activePanelState) {
  if (!ps.stories.length) return;
  const items = computeCanvasRanks(ps.stories, ps.layout);
  if (!items.length) return;
  try {
    await postJSON('/api/docs/rerank-canvas', { items });
  } catch {
    /* silent — rank sync is best-effort */
  }
}
export async function resetCanvasLayout(epicFilename) {
  try {
    await deleteJSON(`/api/canvas/layout/${encodeURIComponent(epicFilename)}`);
  } catch {
    /* no-op */
  }
  _activePanelState.layout = computeAutoLayout(
    _activePanelState.stories,
    _activePanelState.blocks,
    _activePanelState.parallel
  );
  renderCanvas(epicFilename, _canvasDocType || '');
}
//# sourceMappingURL=refine-canvas.js.map
