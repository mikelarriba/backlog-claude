// ── Refine canvas: layout computation, rendering, and persistence ─
import { escHtml, TYPE_LABEL, postJSON } from './state.js';
import { openRefinePanel, openManualRefine } from './refine.js';
import {
  _showEpicContextMenu,
  _showEmptyCellMenu,
  _showCardContextMenu,
  _showMultiCardContextMenu,
} from './refine-nodes.js';
import { _showEdgePopup, _showLinkPopup } from './refine-edges.js';

// Grid constants
const CELL_W = 240;
const CELL_H = 110;
const GUTTER_X = 60;
const GUTTER_Y = 36;
const TOP_OFFSET = 80;

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
  const positions = {};
  for (const c of ps.stories) positions[c.filename] = ps.layout[c.filename] || { col: 0, row: 0 };

  const usedCols = [...new Set(Object.values(positions).map((p) => p.col))].sort((a, b) => a - b);
  const usedRows = [...new Set(Object.values(positions).map((p) => p.row))].sort((a, b) => a - b);
  const colRemap = new Map(usedCols.map((c, i) => [c, i]));
  const rowRemap = new Map(usedRows.map((r, i) => [r, i]));
  for (const fn of Object.keys(positions)) {
    positions[fn] = {
      col: colRemap.get(positions[fn].col) ?? 0,
      row: rowRemap.get(positions[fn].row) ?? 0,
    };
  }

  const cols = usedCols.length || 1;
  const rows = usedRows.length || 1;
  const totalW = GUTTER_X + cols * (CELL_W + GUTTER_X);
  const totalH = GUTTER_Y + rows * (CELL_H + GUTTER_Y);

  const wrap = document.createElement('div');
  wrap.style.cssText = `position:relative;width:${totalW}px;min-height:${totalH}px`;

  const cellAt = (col, row) => ({
    x: GUTTER_X + col * (CELL_W + GUTTER_X),
    y: GUTTER_Y + row * (CELL_H + GUTTER_Y),
  });

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
      <div class="fp-card-title">${escHtml(c.title || c.filename)}</div>`;
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
      e.dataTransfer.setData('text/plain', c.filename);
    });
    wrap.appendChild(card);

    // Drop zone cells
    const cell = document.createElement('div');
    cell.className = 'canvas-swimlane-cell fp-drop-cell';
    cell.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${CELL_W}px;height:${CELL_H}px`;
    cell.dataset.col = p.col;
    cell.dataset.row = p.row;
    cell.addEventListener('dragover', (e) => {
      e.preventDefault();
      cell.classList.add('drag-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', async (e) => {
      e.preventDefault();
      cell.classList.remove('drag-over');
      const fn = e.dataTransfer.getData('text/plain');
      if (!fn || fn === c.filename) return;
      ps.layout[fn] = { col: p.col, row: p.row };
      await saveCanvasLayout(ps, epicFilename);
      _renderFpCanvas(epicFilename, ps, featureFilename);
    });
    wrap.insertBefore(cell, card);
  }

  container.appendChild(wrap);
}

// ── Graph construction ─────────────────────────────────────────
export async function buildCanvasGraph(filename, docType) {
  _canvasSelectedCards.clear();
  let children = [];
  let blocks = [];
  let parallel = [];

  try {
    const res = await fetch(`/api/links/${docType}/${encodeURIComponent(filename)}`);
    if (res.ok) {
      const data = await res.json();
      children = data.children || [];
      // eslint-disable-next-line no-unused-vars
      blocks = data.blocks || [];
      // eslint-disable-next-line no-unused-vars
      parallel = data.parallel || [];
    }
  } catch {
    /* render with just the epic node */
  }

  // Load saved layout
  let savedPositions = {};
  try {
    const res = await fetch(`/api/canvas/layout/${encodeURIComponent(filename)}`);
    if (res.ok) savedPositions = await res.json();
  } catch {
    /* no-op */
  }

  _activePanelState.stories = children;
  _activePanelState.parallel = [];
  _activePanelState.blocks = [];

  // Build blocks pairs from child blockedBy info
  const childFilenames = new Set(children.map((c) => c.filename));
  for (const child of children) {
    const doc = allDocs.find((d) => d.filename === child.filename);
    if (!doc) continue;
    for (const blockedFn of doc.blocks || []) {
      if (childFilenames.has(blockedFn)) {
        _activePanelState.blocks.push({ src: child.filename, tgt: blockedFn });
      }
    }
    for (const parallelFn of doc.parallel || []) {
      if (childFilenames.has(parallelFn)) {
        const pairKey = [child.filename, parallelFn].sort().join('|');
        if (!_activePanelState.parallel.find((p) => [p.a, p.b].sort().join('|') === pairKey)) {
          _activePanelState.parallel.push({ a: child.filename, b: parallelFn });
        }
      }
    }
  }

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
  const childFilenames = new Set(ps.stories.map((c) => c.filename));
  ps.blocks = [];
  ps.parallel = [];
  for (const child of ps.stories) {
    const doc = allDocs.find((d) => d.filename === child.filename);
    if (!doc) continue;
    for (const blockedFn of doc.blocks || []) {
      if (childFilenames.has(blockedFn)) {
        ps.blocks.push({ src: child.filename, tgt: blockedFn });
      }
    }
    for (const parallelFn of doc.parallel || []) {
      if (childFilenames.has(parallelFn)) {
        const pairKey = [child.filename, parallelFn].sort().join('|');
        if (!ps.parallel.find((p) => [p.a, p.b].sort().join('|') === pairKey)) {
          ps.parallel.push({ a: child.filename, b: parallelFn });
        }
      }
    }
  }
}

// ── Auto layout: topological BFS ──────────────────────────────
export function computeAutoLayout(children, blocks, _parallel) {
  const layout = {};
  if (!children.length) return layout;

  // Build adjacency: who blocks whom
  const blockedByMap = new Map(); // tgt → [src, ...] (who must come before tgt)
  for (const { src, tgt } of blocks) {
    if (!blockedByMap.has(tgt)) blockedByMap.set(tgt, []);
    blockedByMap.get(tgt).push(src);
  }

  // Phase 1 — seed BFS with true roots (stories with no blockers in this epic)
  const rowMap = new Map();
  const visited = new Set();
  const queue = [];
  for (const child of children) {
    if (!(blockedByMap.get(child.filename) || []).length) {
      rowMap.set(child.filename, 0);
      visited.add(child.filename);
      queue.push(child.filename);
    }
  }

  // Phase 2 — BFS: propagate rows through the blocks graph
  let head = 0;
  while (head < queue.length) {
    const fn = queue[head++];
    const currentRow = rowMap.get(fn) || 0;
    for (const { src, tgt } of blocks) {
      if (src !== fn) continue;
      const newRow = Math.max(rowMap.get(tgt) || 0, currentRow + 1);
      rowMap.set(tgt, newRow);
      if (!visited.has(tgt)) {
        visited.add(tgt);
        queue.push(tgt);
      }
    }
  }

  // Phase 3 — any story not reachable from a root (orphan or cycle) gets row 0
  for (const child of children) {
    if (!rowMap.has(child.filename)) rowMap.set(child.filename, 0);
  }

  // Assign columns:
  //   - Items connected by BLOCKS share a column (sequential workstream — stacked vertically)
  //   - Items connected by PARALLEL get separate columns (concurrent workstreams — side by side)
  //
  // Union-find groups items that must be in the same column.
  // Each independent component (workstream) gets its own column number.
  const colSets = new Map();
  for (const child of children) colSets.set(child.filename, child.filename);

  function findRoot(fn) {
    if (colSets.get(fn) === fn) return fn;
    const root = findRoot(colSets.get(fn));
    colSets.set(fn, root);
    return root;
  }
  function union(a, b) {
    const ra = findRoot(a),
      rb = findRoot(b);
    if (ra !== rb) colSets.set(ra, rb);
  }

  // Sequential chains (blocks) → same column
  for (const { src, tgt } of blocks) union(src, tgt);
  // Parallel items are intentionally NOT unioned — they go in separate columns

  // Assign one column per component, roots-first for stable ordering
  const componentCol = new Map();
  let nextCol = 0;
  const sortedByRow = [...children].sort(
    (a, b) => (rowMap.get(a.filename) || 0) - (rowMap.get(b.filename) || 0)
  );
  for (const child of sortedByRow) {
    const root = findRoot(child.filename);
    if (!componentCol.has(root)) componentCol.set(root, nextCol++);
  }

  // Build layout
  for (const child of children) {
    const col = componentCol.get(findRoot(child.filename)) ?? 0;
    const row = rowMap.get(child.filename) ?? 0;
    layout[child.filename] = { col, row };
  }

  return layout;
}

// ── Render canvas ──────────────────────────────────────────────
export function renderCanvas(epicFilename, docType) {
  const container = document.getElementById('refine-canvas');
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
  const usedCols = [...new Set(Object.values(_activePanelState.layout).map((p) => p.col))].sort(
    (a, b) => a - b
  );
  const usedRows = [...new Set(Object.values(_activePanelState.layout).map((p) => p.row))].sort(
    (a, b) => a - b
  );
  if (usedCols.length || usedRows.length) {
    const colRemap = new Map(usedCols.map((c, i) => [c, i]));
    const rowRemap = new Map(usedRows.map((r, i) => [r, i]));
    let changed = false;
    for (const fn of Object.keys(_activePanelState.layout)) {
      const newCol =
        colRemap.get(_activePanelState.layout[fn].col) ?? _activePanelState.layout[fn].col;
      const newRow =
        rowRemap.get(_activePanelState.layout[fn].row) ?? _activePanelState.layout[fn].row;
      if (
        newCol !== _activePanelState.layout[fn].col ||
        newRow !== _activePanelState.layout[fn].row
      )
        changed = true;
      _activePanelState.layout[fn] = { col: newCol, row: newRow };
    }
    if (changed) saveCanvasLayout(_activePanelState, epicFilename);
  }

  // Grid dimensions: occupied + 1 extra row/col for expansion
  const occupiedCols = usedCols.length || 1;
  const occupiedRows = usedRows.length || 1;
  const gridCols = occupiedCols + 1;
  const gridRows = occupiedRows + 1;

  const totalW = GUTTER_X + gridCols * (CELL_W + GUTTER_X);
  const totalH = effectiveTopOffset + gridRows * (CELL_H + GUTTER_Y) + GUTTER_Y;

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
  const cellAt = (col, row) => ({
    x: GUTTER_X + col * (CELL_W + GUTTER_X),
    y: effectiveTopOffset + row * (CELL_H + GUTTER_Y),
  });

  // Build set of occupied cell positions for empty-cell detection
  const _occupiedCells = new Set();
  for (const child of _activePanelState.stories) {
    const pos = _activePanelState.layout[child.filename] || { col: 0, row: 0 };
    _occupiedCells.add(`${pos.col},${pos.row}`);
  }

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const { x, y } = cellAt(col, row);
      const cell = document.createElement('div');
      cell.className = 'canvas-swimlane-cell';
      cell.dataset.col = col;
      cell.dataset.row = row;
      cell.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${CELL_W}px;height:${CELL_H}px`;

      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', async (e) => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        wrapper.classList.remove('drag-active');
        const fn = e.dataTransfer.getData('text/plain');
        if (!fn) return;
        const newCol = parseInt(cell.dataset.col);
        const newRow = parseInt(cell.dataset.row);
        const cur = _activePanelState.layout[fn] || {};
        if (cur.col === newCol && cur.row === newRow) return;
        _activePanelState.layout[fn] = { col: newCol, row: newRow };
        await saveCanvasLayout(_activePanelState, epicFilename);
        renderCanvas(epicFilename, docType);
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
    const pos = _activePanelState.layout[child.filename] || { col: 0, row: 0 };
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
      <div class="canvas-handle canvas-handle--top"    data-side="top"></div>
      <div class="canvas-handle canvas-handle--bottom" data-side="bottom"></div>
      <div class="canvas-handle canvas-handle--left"   data-side="left"></div>
      <div class="canvas-handle canvas-handle--right"  data-side="right"></div>`;

    // Click → open panel (plain) or toggle multi-select (Cmd/Ctrl)
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('canvas-handle')) return;
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
      e.dataTransfer.setData('text/plain', child.filename);
      e.dataTransfer.effectAllowed = 'move';
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

    // Handle mousedown for rubber-band link creation (Manage Links mode)
    card.querySelectorAll('.canvas-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        if (!_canvasManageLinks) return;
        e.stopPropagation();
        e.preventDefault();
        card.setAttribute('draggable', 'false');

        const rubberLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        rubberLine.setAttribute('stroke', 'var(--accent)');
        rubberLine.setAttribute('stroke-width', '2');
        rubberLine.setAttribute('stroke-dasharray', '5 3');
        rubberLine.setAttribute('pointer-events', 'none');
        const r0 = svg.getBoundingClientRect();
        rubberLine.setAttribute('x1', e.clientX - r0.left);
        rubberLine.setAttribute('y1', e.clientY - r0.top);
        rubberLine.setAttribute('x2', e.clientX - r0.left);
        rubberLine.setAttribute('y2', e.clientY - r0.top);
        svg.appendChild(rubberLine);

        function onMove(mv) {
          const r = svg.getBoundingClientRect();
          rubberLine.setAttribute('x2', mv.clientX - r.left);
          rubberLine.setAttribute('y2', mv.clientY - r.top);
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
                tgtDt
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

  // SEC arrows: cards sharing a column, consecutive rows
  const byCols = {};
  for (const [fn, pos] of Object.entries(_activePanelState.layout)) {
    if (!byCols[pos.col]) byCols[pos.col] = [];
    byCols[pos.col].push({ fn, row: pos.row });
  }
  for (const colItems of Object.values(byCols)) {
    colItems.sort((a, b) => a.row - b.row);
    for (let i = 0; i < colItems.length - 1; i++) {
      const src = cardPositions[colItems[i].fn];
      const tgt = cardPositions[colItems[i + 1].fn];
      if (!src || !tgt || src === tgt) continue;
      const hasBlocks = _activePanelState.blocks.some(
        (b) =>
          (b.src === colItems[i].fn && b.tgt === colItems[i + 1].fn) ||
          (b.src === colItems[i + 1].fn && b.tgt === colItems[i].fn)
      );
      if (hasBlocks) continue;

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
      label.setAttribute('x', x1 + 6);
      label.setAttribute('y', y1 + (y2 - y1) / 2);
      label.setAttribute('class', 'canvas-edge-label');
      label.textContent = 'SEC';
      svg.appendChild(label);
    }
  }

  // BLOCKS arrows (red) — clickable
  for (const { src, tgt } of _activePanelState.blocks) {
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
    label.setAttribute('x', (x1 + x2) / 2 + 4);
    label.setAttribute('y', (y1 + y2) / 2);
    label.setAttribute('class', 'canvas-edge-label canvas-edge-label--blocks');
    label.textContent = 'BLOCKS';
    svg.appendChild(label);

    addHitArea(svg, d, (e) => {
      e.stopPropagation();
      _showEdgePopup(e.clientX, e.clientY, 'blocks', src, srcDt, tgt, tgtDt);
    });
  }

  // PARALLEL brackets — clickable
  for (const { a, b } of _activePanelState.parallel) {
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
    label.setAttribute('x', (x1 + x2) / 2);
    label.setAttribute('y', y - 3);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'canvas-edge-label canvas-edge-label--parallel');
    label.textContent = 'PARALLEL';
    svg.appendChild(label);

    addHitArea(svg, d, (e) => {
      e.stopPropagation();
      _showEdgePopup(e.clientX, e.clientY, 'parallel', a, aDt, b, bDt);
    });
  }
}

export async function saveCanvasLayout(ps = _activePanelState, parentFilename) {
  const fn = parentFilename || _canvasEpicFilename;
  if (!fn) return;
  try {
    await fetch(`/api/canvas/layout/${encodeURIComponent(fn)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions: ps.layout }),
    });
  } catch {
    /* silent */
  }
  await syncCanvasRanks(ps);
}

// ── Sync canvas grid order → Rank frontmatter field ──────────
// Order: col-first (left→right), then row within each col (top→bottom)
async function syncCanvasRanks(ps = _activePanelState) {
  if (!ps.stories.length) return;
  const entries = ps.stories
    .filter((c) => ps.layout[c.filename])
    .map((c) => ({
      filename: c.filename,
      docType: c.docType || c.type || 'story',
      col: ps.layout[c.filename].col,
      row: ps.layout[c.filename].row,
    }))
    .sort((a, b) => (a.col !== b.col ? a.col - b.col : a.row - b.row));

  const items = entries.map((e, i) => ({
    filename: e.filename,
    docType: e.docType,
    rank: i + 1,
  }));

  if (!items.length) return;
  try {
    await postJSON('/api/docs/rerank-canvas', { items });
  } catch {
    /* silent — rank sync is best-effort */
  }
}

export async function resetCanvasLayout(epicFilename) {
  try {
    await fetch(`/api/canvas/layout/${encodeURIComponent(epicFilename)}`, { method: 'DELETE' });
  } catch {
    /* no-op */
  }
  _activePanelState.layout = computeAutoLayout(
    _activePanelState.stories,
    _activePanelState.blocks,
    _activePanelState.parallel
  );
  renderCanvas(epicFilename, _canvasDocType);
}
