// ── Manual Refinement View ─────────────────────────────────────
// Visual hierarchy editor for Epics. Uses a custom vanilla JS + SVG
// grid canvas for automatic top-down node placement with swim-lane columns.
//
// Scope: Feature → Epic → [Stories, Spikes, Bugs]
// Clicking a card opens a slide-in panel with full markdown content,
// an upgrade (AI rewrite) panel, and a delete action.
// "+ Story / + Spike / + Bug" buttons in the header open a creation
// form that generates the doc and links it in one flow.

// ── Canvas state ───────────────────────────────────────────────
let _canvasEpicFilename  = null;
let _canvasDocType       = null;
let _canvasManageLinks   = false; // "Manage Links" mode
let _canvasSelectedCards = new Set(); // multi-select (filenames)

// PanelState shape: { stories, layout, blocks, parallel }
// Single-epic mode uses _activePanelState; multi-panel mode adds to _panelStates.
let _activePanelState = { stories: [], layout: {}, blocks: [], parallel: [] };
const _panelStates = new Map(); // epicFilename → PanelState (multi-panel)

// Grid constants
const CELL_W    = 240;
const CELL_H    = 110;
const GUTTER_X  = 60;
const GUTTER_Y  = 36;
const TOP_OFFSET = 80;

// ── Card search / filter ──────────────────────────────────────
function onCanvasSearch(query) {
  const cards = document.querySelectorAll('#refine-canvas .canvas-card');
  const q = (query || '').trim().toLowerCase();

  if (q.length < 3) {
    // Clear all filter classes
    cards.forEach(c => { c.classList.remove('search-dimmed', 'search-match'); });
    return;
  }

  cards.forEach(card => {
    const title = (card.querySelector('.canvas-card-title')?.textContent || '').toLowerCase();
    if (title.includes(q)) {
      card.classList.add('search-match');
      card.classList.remove('search-dimmed');
    } else {
      card.classList.add('search-dimmed');
      card.classList.remove('search-match');
    }
  });
}

// ── Entry / Exit ───────────────────────────────────────────────
async function openManualRefine(filename, docType) {
  if (!filename) return;
  docType = docType || 'epic';
  _canvasEpicFilename = filename;
  _canvasDocType      = docType;
  // Refine view needs the full right panel — suspend split mode while open
  document.querySelector('.right').classList.remove('split-mode');

  const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
  document.getElementById('refine-epic-title').textContent = doc?.title || filename;

  // Switch views
  document.getElementById('list-view').style.display  = 'none';
  document.getElementById('detail-view').classList.remove('show');
  document.getElementById('refine-view').classList.add('show');

  // Clear search
  const searchInput = document.getElementById('refine-search');
  if (searchInput) searchInput.value = '';

  // Render the correct "+ Create" buttons for this doc type
  _canvasManageLinks = false;
  const addBtns = document.getElementById('refine-add-btns');
  if (docType === 'feature') {
    addBtns.innerHTML = `<button class="btn-xs" onclick="openCreatePanel('epic')">＋ Epic</button>`;
  } else {
    addBtns.innerHTML = `
      <button class="btn-xs green" onclick="openCreatePanel('story')">＋ Story</button>
      <button class="btn-xs" onclick="openCreatePanel('spike')">＋ Spike</button>
      <button class="btn-xs red" onclick="openCreatePanel('bug')">＋ Bug</button>
      <button class="btn-xs" id="manage-links-btn" onclick="toggleManageLinks()">⛓ Manage Links</button>`;
  }

  closeRefinePanel();
  if (docType === 'feature') {
    await renderFeatureMultiPanel(filename);
  } else {
    await buildCanvasGraph(filename, docType);
  }
  document.addEventListener('keydown', _onCanvasKeydown);
}

function _onCanvasKeydown(e) {
  if (e.key === 'Escape' && _canvasSelectedCards.size > 0) {
    _canvasSelectedCards.clear();
    document.querySelectorAll('.canvas-card.canvas-multi-selected').forEach(el => el.classList.remove('canvas-multi-selected'));
  }
}

function closeRefineView() {
  document.getElementById('refine-view').classList.remove('show');
  document.removeEventListener('keydown', _onCanvasKeydown);
  updateSplitMode();

  // Clear canvas state
  _canvasEpicFilename = null;
  _canvasDocType      = null;
  _activePanelState.layout       = {};
  _activePanelState.stories      = [];
  _activePanelState.parallel     = [];
  _activePanelState.blocks       = [];
  _canvasManageLinks  = false;
  _canvasSelectedCards.clear();
  const canvas = document.getElementById('refine-canvas');
  if (canvas) canvas.classList.remove('manage-links-active');

  if (currentFilename && currentDocType) {
    document.getElementById('detail-view').classList.add('show');
  } else {
    document.getElementById('list-view').style.display = 'flex';
  }
}

// ── Feature multi-panel view ───────────────────────────────────
const _FP_COLLAPSED_KEY = fn => `fp:collapsed:${fn}`;

async function renderFeatureMultiPanel(featureFilename) {
  const container = document.getElementById('refine-canvas');
  container.innerHTML = '<div class="canvas-empty">Loading feature…</div>';
  _panelStates.clear();

  let data;
  try {
    const res = await fetch(`/api/links/feature/${encodeURIComponent(featureFilename)}/deep`);
    if (!res.ok) throw new Error('Failed to load feature hierarchy');
    data = await res.json();
  } catch (e) {
    container.innerHTML = `<div class="canvas-empty">Error: ${escHtml(e.message)}</div>`;
    return;
  }

  const collapsedSet = _fpLoadCollapsed(featureFilename);
  const wrapper = document.createElement('div');
  wrapper.className = 'feature-panels-container';

  for (const epic of data.epics) {
    const children = epic.children || [];
    const ps = { stories: children, layout: {}, blocks: epic.blocks || [], parallel: epic.parallel || [] };
    _panelStates.set(epic.filename, ps);

    // Load or compute layout for this epic's panel
    try {
      const lr = await fetch(`/api/canvas/layout/${encodeURIComponent(epic.filename)}`);
      if (lr.ok) {
        const saved = await lr.json();
        if (Object.keys(saved).length) ps.layout = saved;
      }
    } catch {}
    if (!Object.keys(ps.layout).length && children.length) {
      ps.layout = computeAutoLayout(children, ps.blocks, ps.parallel);
    }

    const isCollapsed = collapsedSet.has(epic.filename);
    wrapper.appendChild(_renderEpicPanel(epic, ps, featureFilename, isCollapsed));
  }

  if (!data.epics.length) {
    wrapper.innerHTML = '<div class="canvas-empty">No epics linked to this feature yet.</div>';
  }

  container.innerHTML = '';
  container.appendChild(wrapper);

  // Render mini-canvases now that panels are in the DOM
  for (const epic of data.epics) {
    const ps = _panelStates.get(epic.filename);
    if (ps) _renderFpCanvas(epic.filename, ps, featureFilename);
  }
}

function _fpLoadCollapsed(featureFilename) {
  try { return new Set(JSON.parse(localStorage.getItem(_FP_COLLAPSED_KEY(featureFilename)) || '[]')); }
  catch { return new Set(); }
}

function _fpSaveCollapsed(featureFilename) {
  const collapsed = [];
  document.querySelectorAll('.feature-panel.fp-collapsed').forEach(p => collapsed.push(p.dataset.epicFilename));
  try { localStorage.setItem(_FP_COLLAPSED_KEY(featureFilename), JSON.stringify(collapsed)); } catch {}
}

function _toggleEpicPanel(epicFilename, featureFilename) {
  const panel = document.querySelector(`.feature-panel[data-epic-filename="${CSS.escape(epicFilename)}"]`);
  if (!panel) return;
  panel.classList.toggle('fp-collapsed');
  const chevron = panel.querySelector('.fp-chevron');
  if (chevron) chevron.textContent = panel.classList.contains('fp-collapsed') ? '▶' : '▼';
  _fpSaveCollapsed(featureFilename);
}

function _renderEpicPanel(epic, ps, featureFilename, isCollapsed) {
  const totalSP = ps.stories.reduce((s, c) => s + (allDocs.find(d => d.filename === c.filename)?.storyPoints || 0), 0);
  const count   = ps.stories.length;
  const ef = escHtml(epic.filename);
  const ff = escHtml(featureFilename);

  const panel = document.createElement('div');
  panel.className = 'feature-panel' + (isCollapsed ? ' fp-collapsed' : '');
  panel.dataset.epicFilename = epic.filename;

  panel.innerHTML = `
    <div class="fp-header" onclick="_toggleEpicPanel('${ef}','${ff}')">
      <span class="fp-chevron">${isCollapsed ? '▶' : '▼'}</span>
      <span class="type-badge epic">Epic</span>
      <span class="fp-title">${escHtml(epic.title || epic.filename)}</span>
      <span class="fp-meta">${count} item${count !== 1 ? 's' : ''}${totalSP ? ` · ${totalSP} SP` : ''}</span>
    </div>
    <div class="fp-body">
      <div class="fp-toolbar">
        <button class="btn-xs green" onclick="_fpCreateChild('story','${ef}','${ff}')">＋ Story</button>
        <button class="btn-xs" onclick="_fpCreateChild('spike','${ef}','${ff}')">＋ Spike</button>
        <button class="btn-xs red" onclick="_fpCreateChild('bug','${ef}','${ff}')">＋ Bug</button>
        <button class="btn-xs" onclick="openManualRefine('${ef}','epic')">↗ Open Epic</button>
      </div>
      <div class="fp-canvas" id="fp-canvas-${ef}"></div>
    </div>`;

  // Right-click on epic header → context menu with Split Epic
  const header = panel.querySelector('.fp-header');
  header.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    _showEpicContextMenu(e.clientX, e.clientY, epic.filename, featureFilename);
  });

  // Canvas rendering is deferred — called from renderFeatureMultiPanel
  // after the panel is actually inserted into the DOM.
  return panel;
}

function _renderFpCanvas(epicFilename, ps, featureFilename) {
  const container = document.getElementById(`fp-canvas-${epicFilename}`);
  if (!container) return;
  container.innerHTML = '';

  if (!ps.stories.length) {
    container.innerHTML = '<div class="fp-canvas-empty">No stories yet</div>';
    return;
  }

  const CELL_W = 200, CELL_H = 90, GUTTER_X = 14, GUTTER_Y = 14;
  const positions = {};
  for (const c of ps.stories) positions[c.filename] = ps.layout[c.filename] || { col: 0, row: 0 };

  const usedCols = [...new Set(Object.values(positions).map(p => p.col))].sort((a, b) => a - b);
  const usedRows = [...new Set(Object.values(positions).map(p => p.row))].sort((a, b) => a - b);
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
    const s = cardPos[src], t = cardPos[tgt];
    if (!s || !t) continue;
    const x1 = s.cx, y1 = s.y + CELL_H, x2 = t.cx, y2 = t.y;
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
    const doc = allDocs.find(d => d.filename === c.filename);
    const sp = doc?.storyPoints ? `${doc.storyPoints} SP` : '';
    const card = document.createElement('div');
    card.className = 'fp-card';
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
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      _showFpCardContextMenu(e.clientX, e.clientY, c.filename, c.docType || 'story', epicFilename, featureFilename);
    });
    // Drag-drop to reposition within panel
    card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', c.filename); });
    wrap.appendChild(card);

    // Drop zone cells
    const cell = document.createElement('div');
    cell.className = 'canvas-swimlane-cell fp-drop-cell';
    cell.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${CELL_W}px;height:${CELL_H}px`;
    cell.dataset.col = p.col;
    cell.dataset.row = p.row;
    cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', async e => {
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

async function _fpCreateChild(type, epicFilename, featureFilename) {
  const title = prompt(`Title for new ${type}:`);
  if (!title) return;
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: title, type, parentEpic: epicFilename }),
    });
    if (!res.ok) throw new Error('Generate failed');
    const data = await res.json();
    if (data.filename) {
      await fetch('/api/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: type, sourceFilename: data.filename, targetType: 'epic', targetFilename: epicFilename }),
      });
      showJiraToast('ok', `Created ${data.filename}`);
      await renderFeatureMultiPanel(featureFilename);
    }
  } catch (e) {
    showJiraToast('error', `Failed: ${e.message}`);
  }
}

// ── Graph construction ─────────────────────────────────────────
async function buildCanvasGraph(filename, docType) {
  _canvasSelectedCards.clear();
  let children = [];
  let blocks    = [];
  let parallel  = [];

  try {
    const res = await fetch(`/api/links/${docType}/${encodeURIComponent(filename)}`);
    if (res.ok) {
      const data = await res.json();
      children = data.children || [];
      blocks   = data.blocks   || [];
      parallel = data.parallel || [];
    }
  } catch { /* render with just the epic node */ }

  // Load saved layout
  let savedPositions = {};
  try {
    const res = await fetch(`/api/canvas/layout/${encodeURIComponent(filename)}`);
    if (res.ok) savedPositions = await res.json();
  } catch {}

  _activePanelState.stories  = children;
  _activePanelState.parallel = [];
  _activePanelState.blocks   = [];

  // Build blocks pairs from child blockedBy info
  const childFilenames = new Set(children.map(c => c.filename));
  for (const child of children) {
    const doc = allDocs.find(d => d.filename === child.filename);
    if (!doc) continue;
    for (const blockedFn of (doc.blocks || [])) {
      if (childFilenames.has(blockedFn)) {
        _activePanelState.blocks.push({ src: child.filename, tgt: blockedFn });
      }
    }
    for (const parallelFn of (doc.parallel || [])) {
      if (childFilenames.has(parallelFn)) {
        const pairKey = [child.filename, parallelFn].sort().join('|');
        if (!_activePanelState.parallel.find(p => [p.a, p.b].sort().join('|') === pairKey)) {
          _activePanelState.parallel.push({ a: child.filename, b: parallelFn });
        }
      }
    }
  }

  if (Object.keys(savedPositions).length > 0) {
    _activePanelState.layout = savedPositions;
  } else {
    _activePanelState.layout = computeAutoLayout(children, _activePanelState.blocks, _activePanelState.parallel);
    // Save auto-layout and sync ranks so dependency order propagates to list view
    if (Object.keys(_activePanelState.layout).length > 0) {
      saveCanvasLayout(_activePanelState, filename);
    }
  }

  renderCanvas(filename, docType);
}

// ── Lightweight edge rebuild (preserves card positions) ────────
function rebuildCanvasEdges(ps = _activePanelState) {
  const childFilenames = new Set(ps.stories.map(c => c.filename));
  ps.blocks   = [];
  ps.parallel = [];
  for (const child of ps.stories) {
    const doc = allDocs.find(d => d.filename === child.filename);
    if (!doc) continue;
    for (const blockedFn of (doc.blocks || [])) {
      if (childFilenames.has(blockedFn)) {
        ps.blocks.push({ src: child.filename, tgt: blockedFn });
      }
    }
    for (const parallelFn of (doc.parallel || [])) {
      if (childFilenames.has(parallelFn)) {
        const pairKey = [child.filename, parallelFn].sort().join('|');
        if (!ps.parallel.find(p => [p.a, p.b].sort().join('|') === pairKey)) {
          ps.parallel.push({ a: child.filename, b: parallelFn });
        }
      }
    }
  }
}

// ── Auto layout: topological BFS ──────────────────────────────
function computeAutoLayout(children, blocks, parallel) {
  const layout = {};
  if (!children.length) return layout;

  // Build adjacency: who blocks whom
  const blockedByMap = new Map(); // tgt → [src, ...] (who must come before tgt)
  for (const { src, tgt } of blocks) {
    if (!blockedByMap.has(tgt)) blockedByMap.set(tgt, []);
    blockedByMap.get(tgt).push(src);
  }

  // Phase 1 — seed BFS with true roots (stories with no blockers in this epic)
  const rowMap  = new Map();
  const visited = new Set();
  const queue   = [];
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
    const ra = findRoot(a), rb = findRoot(b);
    if (ra !== rb) colSets.set(ra, rb);
  }

  // Sequential chains (blocks) → same column
  for (const { src, tgt } of blocks) union(src, tgt);
  // Parallel items are intentionally NOT unioned — they go in separate columns

  // Assign one column per component, roots-first for stable ordering
  const componentCol = new Map();
  let nextCol = 0;
  const sortedByRow = [...children].sort((a, b) => (rowMap.get(a.filename) || 0) - (rowMap.get(b.filename) || 0));
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
function renderCanvas(epicFilename, docType) {
  const container = document.getElementById('refine-canvas');
  container.innerHTML = '';
  container.style.position = 'relative';
  container.style.overflow = 'auto';

  if (!_activePanelState.stories.length) {
    container.innerHTML = '<div class="canvas-empty">No stories linked to this epic yet. Use the buttons above to add some.</div>';
    return;
  }

  // Resolve feature parent banner (only when viewing an epic)
  let featureDoc = null;
  let bannerOffset = 0;
  if (docType === 'epic') {
    const epicEntry = allDocs.find(d => d.filename === epicFilename && d.docType === 'epic');
    if (epicEntry?.parentFilename) {
      featureDoc = allDocs.find(d => d.filename === epicEntry.parentFilename && d.docType === 'feature');
    }
  }
  if (featureDoc) bannerOffset = 44;

  // Effective top offset for grid (shifted down when banner is present)
  const effectiveTopOffset = TOP_OFFSET + bannerOffset;

  // Compact layout: remap col/row values to remove gaps
  const usedCols = [...new Set(Object.values(_activePanelState.layout).map(p => p.col))].sort((a, b) => a - b);
  const usedRows = [...new Set(Object.values(_activePanelState.layout).map(p => p.row))].sort((a, b) => a - b);
  if (usedCols.length || usedRows.length) {
    const colRemap = new Map(usedCols.map((c, i) => [c, i]));
    const rowRemap = new Map(usedRows.map((r, i) => [r, i]));
    let changed = false;
    for (const fn of Object.keys(_activePanelState.layout)) {
      const newCol = colRemap.get(_activePanelState.layout[fn].col) ?? _activePanelState.layout[fn].col;
      const newRow = rowRemap.get(_activePanelState.layout[fn].row) ?? _activePanelState.layout[fn].row;
      if (newCol !== _activePanelState.layout[fn].col || newRow !== _activePanelState.layout[fn].row) changed = true;
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
  const epicDoc = allDocs.find(d => d.filename === epicFilename && d.docType === docType);
  const epicNode = document.createElement('div');
  epicNode.className = 'canvas-epic-node';
  const epicCenterX = totalW / 2;
  epicNode.style.cssText = `position:absolute;left:${epicCenterX - 110}px;top:${14 + bannerOffset}px;width:220px;z-index:2`;
  epicNode.innerHTML = `
    <span class="type-badge ${docType}">${TYPE_LABEL[docType] || docType}</span>
    <span class="canvas-epic-title">${escHtml(epicDoc?.title || epicFilename)}</span>`;
  epicNode.style.cursor = 'pointer';
  epicNode.addEventListener('click', () => {
    document.querySelectorAll('.canvas-card.selected').forEach(el => el.classList.remove('selected'));
    openRefinePanel(epicFilename, docType);
  });
  if (docType === 'epic') {
    epicNode.addEventListener('contextmenu', e => {
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

      cell.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', async e => {
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
        cell.addEventListener('contextmenu', e => {
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

    const doc = allDocs.find(d => d.filename === child.filename);
    const sp  = doc?.storyPoints ? `${doc.storyPoints} SP` : '';

    const card = document.createElement('div');
    card.className = 'canvas-card';
    card.dataset.filename = child.filename;
    card.dataset.doctype  = child.docType || docType;
    // Inset 4px inside the cell so the dashed cell border stays visible
    const INSET = 4;
    card.style.cssText = `position:absolute;left:${x+INSET}px;top:${y+INSET}px;width:${CELL_W-INSET*2}px;height:${CELL_H-INSET*2}px;z-index:2`;
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
    card.addEventListener('click', e => {
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
      document.querySelectorAll('.canvas-card.canvas-multi-selected').forEach(el => el.classList.remove('canvas-multi-selected'));
      document.querySelectorAll('.canvas-card.selected').forEach(el => el.classList.remove('selected'));
      card.classList.add('selected');
      openRefinePanel(child.filename, child.docType || docType);
    });

    // Right-click → context menu (multi-select aware)
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      // If right-clicking a card not in multi-selection, reset to single
      if (_canvasSelectedCards.size > 0 && !_canvasSelectedCards.has(child.filename)) {
        _canvasSelectedCards.clear();
        document.querySelectorAll('.canvas-card.canvas-multi-selected').forEach(el => el.classList.remove('canvas-multi-selected'));
      }
      // If no multi-selection, treat as single-card context menu
      if (_canvasSelectedCards.size <= 1) {
        _canvasSelectedCards.clear();
        document.querySelectorAll('.canvas-card.canvas-multi-selected').forEach(el => el.classList.remove('canvas-multi-selected'));
        _showCardContextMenu(e.clientX, e.clientY, child.filename, epicFilename, docType);
      } else {
        _showMultiCardContextMenu(e.clientX, e.clientY, epicFilename, docType);
      }
    });

    // HTML5 drag to reposition
    card.addEventListener('dragstart', e => {
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
    card.querySelectorAll('.canvas-handle').forEach(handle => {
      handle.addEventListener('mousedown', e => {
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
          const tgtCard = els.find(el => el.classList.contains('canvas-card') && el !== card);
          if (tgtCard) {
            const tgtFn = tgtCard.dataset.filename;
            const tgtDt = tgtCard.dataset.doctype;
            if (tgtFn && tgtFn !== child.filename) {
              _showLinkPopup(mu.clientX, mu.clientY, child.filename, child.docType || docType, tgtFn, tgtDt);
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
function drawCanvasEdges(svg, cardPositions, epicFilename, epicCenterX, totalW) {
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
      const hasBlocks = _activePanelState.blocks.some(b =>
        (b.src === colItems[i].fn && b.tgt === colItems[i + 1].fn) ||
        (b.src === colItems[i + 1].fn && b.tgt === colItems[i].fn)
      );
      if (hasBlocks) continue;

      const x1 = src.cx, y1 = src.y + CELL_H;
      const x2 = tgt.cx, y2 = tgt.y;
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

    const srcDt = _activePanelState.stories.find(c => c.filename === src)?.docType || _canvasDocType;
    const tgtDt = _activePanelState.stories.find(c => c.filename === tgt)?.docType || _canvasDocType;

    const x1 = s.cx, y1 = s.y + CELL_H;
    const x2 = t.cx, y2 = t.y;
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

    addHitArea(svg, d, e => {
      e.stopPropagation();
      _showEdgePopup(e.clientX, e.clientY, 'blocks', src, srcDt, tgt, tgtDt);
    });
  }

  // PARALLEL brackets — clickable
  for (const { a, b } of _activePanelState.parallel) {
    const pa = cardPositions[a];
    const pb = cardPositions[b];
    if (!pa || !pb) continue;

    const aDt = _activePanelState.stories.find(c => c.filename === a)?.docType || _canvasDocType;
    const bDt = _activePanelState.stories.find(c => c.filename === b)?.docType || _canvasDocType;

    const x1 = pa.x;
    const x2 = pb.x + CELL_W;
    const y  = Math.min(pa.y, pb.y) - 14;
    const d  = `M${x1},${pa.y - 4} V${y} H${x2} V${pb.y - 4}`;

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

    addHitArea(svg, d, e => {
      e.stopPropagation();
      _showEdgePopup(e.clientX, e.clientY, 'parallel', a, aDt, b, bDt);
    });
  }
}

// ── Edge click popup ───────────────────────────────────────────
function _showEdgePopup(x, y, linkType, srcFn, srcDt, tgtFn, tgtDt) {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top  = `${y}px`;

  const altType  = linkType === 'blocks' ? 'parallel' : 'blocks';
  const altLabel = linkType === 'blocks' ? 'Change to PARALLEL' : 'Change to BLOCKS';

  popup.innerHTML = `
    <div class="canvas-link-popup-title">${linkType.toUpperCase()} dependency</div>
    <button class="canvas-link-popup-danger" id="_edge-delete-btn">Delete dependency</button>
    <button id="_edge-change-btn">${altLabel}</button>
    <button id="_edge-cancel-btn">Cancel</button>`;
  document.body.appendChild(popup);

  popup.querySelector('#_edge-delete-btn').addEventListener('click', () =>
    _deleteCanvasLink(linkType, srcFn, srcDt, tgtFn, tgtDt));
  popup.querySelector('#_edge-change-btn').addEventListener('click', () =>
    _changeCanvasLinkType(linkType, altType, srcFn, srcDt, tgtFn, tgtDt));
  popup.querySelector('#_edge-cancel-btn').addEventListener('click', _closeLinkPopup);

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

async function _deleteCanvasLink(linkType, srcFn, srcDt, tgtFn, tgtDt) {
  _closeLinkPopup();
  try {
    const res = await fetch('/api/link', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ linkType, sourceType: srcDt, sourceFilename: srcFn, targetType: tgtDt, targetFilename: tgtFn }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error?.message || 'Delete failed'); }
    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename, _canvasDocType);
    _restoreManageLinksState();
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

async function _changeCanvasLinkType(oldType, newType, srcFn, srcDt, tgtFn, tgtDt) {
  _closeLinkPopup();
  try {
    const delRes = await fetch('/api/link', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ linkType: oldType, sourceType: srcDt, sourceFilename: srcFn, targetType: tgtDt, targetFilename: tgtFn }),
    });
    if (!delRes.ok) throw new Error('Delete failed');

    const addRes = await fetch('/api/link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ linkType: newType, sourceType: srcDt, sourceFilename: srcFn, targetType: tgtDt, targetFilename: tgtFn }),
    });
    if (!addRes.ok) { const d = await addRes.json(); throw new Error(d.error?.message || 'Create failed'); }
    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename, _canvasDocType);
    _restoreManageLinksState();
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

function _restoreManageLinksState() {
  if (!_canvasManageLinks) return;
  const btn = document.getElementById('manage-links-btn');
  if (btn) btn.classList.add('active');
  const canvas = document.getElementById('refine-canvas');
  if (canvas) canvas.classList.add('manage-links-active');
  document.querySelectorAll('.canvas-card').forEach(c => c.setAttribute('draggable', 'false'));
}


async function saveCanvasLayout(ps = _activePanelState, parentFilename) {
  const fn = parentFilename || _canvasEpicFilename;
  if (!fn) return;
  try {
    await fetch(`/api/canvas/layout/${encodeURIComponent(fn)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ positions: ps.layout }),
    });
  } catch { /* silent */ }
  await syncCanvasRanks(ps);
}

// ── Sync canvas grid order → Rank frontmatter field ──────────
// Order: col-first (left→right), then row within each col (top→bottom)
async function syncCanvasRanks(ps = _activePanelState) {
  if (!ps.stories.length) return;
  const entries = ps.stories
    .filter(c => ps.layout[c.filename])
    .map(c => ({
      filename: c.filename,
      docType:  c.docType || c.type || 'story',
      col:      ps.layout[c.filename].col,
      row:      ps.layout[c.filename].row,
    }))
    .sort((a, b) => a.col !== b.col ? a.col - b.col : a.row - b.row);

  const items = entries.map((e, i) => ({
    filename: e.filename,
    docType:  e.docType,
    rank:     i + 1,
  }));

  if (!items.length) return;
  try {
    await postJSON('/api/docs/rerank-canvas', { items });
  } catch { /* silent — rank sync is best-effort */ }
}

// ── Manage Links mode ──────────────────────────────────────────
function toggleManageLinks() {
  _canvasManageLinks = !_canvasManageLinks;
  const btn = document.getElementById('manage-links-btn');
  if (btn) btn.classList.toggle('active', _canvasManageLinks);
  // CSS controls handle visibility via this class
  const canvas = document.getElementById('refine-canvas');
  if (canvas) canvas.classList.toggle('manage-links-active', _canvasManageLinks);
  // Disable card drag while in manage-links mode so handles don't compete with HTML5 drag
  document.querySelectorAll('.canvas-card').forEach(c => {
    c.setAttribute('draggable', _canvasManageLinks ? 'false' : 'true');
  });
}

function _closeLinkPopup() {
  document.querySelectorAll('.canvas-link-popup').forEach(el => el.remove());
}

// ── Card context menu (right-click → move to edge / split) ──
function _showCardContextMenu(x, y, filename, epicFilename, docType) {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top  = `${y}px`;
  popup.innerHTML = `
    <div class="canvas-link-popup-title">Move card</div>
    <button id="_ctx-left">← Move to Left</button>
    <button id="_ctx-right">Move to Right →</button>
    <button id="_ctx-top">↑ Move to Top</button>
    <button id="_ctx-bottom">Move to Bottom ↓</button>
    <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">
    <button id="_ctx-split">✂ Split Issue</button>`;
  document.body.appendChild(popup);

  popup.querySelector('#_ctx-left').addEventListener('click', () =>
    _moveCardToEdge(filename, 'left', epicFilename, docType));
  popup.querySelector('#_ctx-right').addEventListener('click', () =>
    _moveCardToEdge(filename, 'right', epicFilename, docType));
  popup.querySelector('#_ctx-top').addEventListener('click', () =>
    _moveCardToEdge(filename, 'top', epicFilename, docType));
  popup.querySelector('#_ctx-bottom').addEventListener('click', () =>
    _moveCardToEdge(filename, 'bottom', epicFilename, docType));
  popup.querySelector('#_ctx-split').addEventListener('click', () => {
    _closeLinkPopup();
    _openCanvasSplit(filename, docType, epicFilename, _canvasDocType);
  });

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

// ── Feature multi-panel card context menu ─────────────────────
function _showFpCardContextMenu(x, y, filename, docType, currentEpicFilename, featureFilename) {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top  = `${y}px`;

  // Build "Move to Epic" submenu items from _panelStates
  const epicItems = [..._panelStates.keys()].map(ef => {
    const isCurrent = ef === currentEpicFilename;
    const epicDoc = allDocs.find(d => d.filename === ef && d.docType === 'epic');
    const label = epicDoc?.title || ef;
    return `<button class="fp-ctx-epic-btn${isCurrent ? ' fp-ctx-epic-current' : ''}"
      ${isCurrent ? 'disabled' : ''}
      data-epic="${escHtml(ef)}">
      ${escHtml(label)}${isCurrent ? ' (current)' : ''}
    </button>`;
  }).join('');

  popup.innerHTML = `
    <div class="canvas-link-popup-title">Move to Epic</div>
    ${epicItems || '<div style="font-size:0.75rem;color:var(--muted);padding:4px 8px">No other epics</div>'}
    <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">
    <button id="_fp-ctx-open">↗ Open in panel</button>
    <button id="_fp-ctx-split">✂ Split Issue</button>`;
  document.body.appendChild(popup);

  popup.querySelectorAll('.fp-ctx-epic-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', async () => {
      _closeLinkPopup();
      await _fpMoveToEpic(filename, docType, currentEpicFilename, btn.dataset.epic, featureFilename);
    });
  });
  popup.querySelector('#_fp-ctx-open')?.addEventListener('click', () => {
    _closeLinkPopup();
    openRefinePanel(filename, docType);
  });
  popup.querySelector('#_fp-ctx-split')?.addEventListener('click', () => {
    _closeLinkPopup();
    _openCanvasSplit(filename, docType, currentEpicFilename, 'epic');
  });

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

async function _fpMoveToEpic(filename, docType, fromEpic, toEpic, featureFilename) {
  try {
    const res = await fetch('/api/link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sourceType: docType, sourceFilename: filename, targetType: 'epic', targetFilename: toEpic }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error?.message || 'Move failed'); }
    await loadDocs();
    showJiraToast('ok', `Moved to ${allDocs.find(d => d.filename === toEpic)?.title || toEpic}`);
    await renderFeatureMultiPanel(featureFilename);
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

// ── Epic context menu (right-click on epic header) ──────────
function _showEpicContextMenu(x, y, epicFilename, featureFilename) {
  _closeLinkPopup();
  const epicDoc = allDocs.find(d => d.filename === epicFilename && d.docType === 'epic');
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top  = `${y}px`;
  popup.innerHTML = `
    <div class="canvas-link-popup-title">${escHtml(epicDoc?.title || epicFilename)}</div>
    <button id="_epic-ctx-split">✂ Split Epic</button>
    <button id="_epic-ctx-open">↗ Open in panel</button>`;
  document.body.appendChild(popup);

  popup.querySelector('#_epic-ctx-split').addEventListener('click', () => {
    _closeLinkPopup();
    _openCanvasSplit(epicFilename, 'epic', featureFilename || epicFilename, featureFilename ? 'feature' : 'epic');
  });
  popup.querySelector('#_epic-ctx-open').addEventListener('click', () => {
    _closeLinkPopup();
    openRefinePanel(epicFilename, 'epic');
  });

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

// ── Empty cell context menu (create new story/spike/bug) ─────
function _showEmptyCellMenu(x, y, col, row, epicFilename, epicDocType) {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top  = `${y}px`;
  popup.innerHTML = `
    <div class="canvas-link-popup-title">Create new</div>
    <button id="_cell-story" class="green">＋ Story</button>
    <button id="_cell-spike">＋ Spike</button>
    <button id="_cell-bug" style="color:var(--danger,#ef4444)">＋ Bug</button>`;
  document.body.appendChild(popup);

  const handleCreate = (type) => {
    _closeLinkPopup();
    _openCellCreateForm(type, col, row, epicFilename, epicDocType);
  };
  popup.querySelector('#_cell-story').addEventListener('click', () => handleCreate('story'));
  popup.querySelector('#_cell-spike').addEventListener('click', () => handleCreate('spike'));
  popup.querySelector('#_cell-bug').addEventListener('click', () => handleCreate('bug'));

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

function _openCellCreateForm(type, col, row, epicFilename, epicDocType) {
  const typeName = TYPE_LABEL[type] || type;
  const panel = document.getElementById('refine-panel');
  panel.classList.add('open');
  document.querySelectorAll('.canvas-card.selected').forEach(el => el.classList.remove('selected'));

  panel.innerHTML = `
    <div class="rp-header">
      <div class="rp-meta">
        <span class="type-badge ${type}">${typeName}</span>
        <span class="rp-title">New ${typeName}</span>
      </div>
      <button class="rp-close" onclick="closeRefinePanel()" title="Close">✕</button>
    </div>
    <div class="rp-create-form">
      <div class="rp-field">
        <label class="rp-label">Describe the ${typeName.toLowerCase()}…</label>
        <textarea class="rp-textarea rp-textarea-tall" id="rp-cell-idea"
          placeholder="What should this ${typeName.toLowerCase()} cover?"></textarea>
      </div>
      <div class="rp-btn-row">
        <button class="btn-xs green" id="rp-cell-create-btn">Generate &amp; Link</button>
        <button class="btn-xs" onclick="closeRefinePanel()">Cancel</button>
      </div>
      <div class="rp-stream" id="rp-cell-stream" style="display:none"></div>
    </div>`;

  document.getElementById('rp-cell-create-btn').addEventListener('click', () =>
    _executeEmptyCellCreate(type, col, row, epicFilename, epicDocType));
  document.getElementById('rp-cell-idea').focus();
}

async function _executeEmptyCellCreate(type, col, row, epicFilename, epicDocType) {
  const idea = document.getElementById('rp-cell-idea')?.value.trim();
  if (!idea) { document.getElementById('rp-cell-idea')?.focus(); return; }

  const btn    = document.getElementById('rp-cell-create-btn');
  const stream = document.getElementById('rp-cell-stream');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '⚙ Generating…';
  stream.style.display = 'block';

  try {
    const parentDoc = allDocs.find(d => d.filename === epicFilename);
    const genBody = { idea, type, priority: 'Medium' };
    if (parentDoc?.fixVersion) genBody.fixVersion = parentDoc.fixVersion;
    if (parentDoc?.pi && parentDoc.pi !== 'TBD') genBody.pi = parentDoc.pi;
    if (epicDocType === 'epic') genBody.parentEpic = epicFilename;
    if (epicDocType === 'feature') genBody.parentFeature = epicFilename;

    const genRes = await fetch('/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(genBody),
    });
    if (!genRes.ok) throw new Error((await genRes.json()).error?.message || 'Generate failed');
    const { filename: newFilename } = await genRes.json();

    stream.textContent = `✓ Created ${newFilename}\n⚙ Linking…`;

    const linkRes = await fetch('/api/link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        sourceType:     type,
        sourceFilename: newFilename,
        targetType:     epicDocType,
        targetFilename: epicFilename,
      }),
    });
    if (!linkRes.ok) throw new Error('Link failed');

    stream.textContent += '\n✓ Linked successfully.';
    showJiraToast('ok', `Created ${newFilename}`);

    await loadDocs();

    // Place the new card at the clicked cell position
    _activePanelState.layout[newFilename] = { col, row };
    await saveCanvasLayout(_activePanelState, epicFilename);
    await buildCanvasGraph(epicFilename, epicDocType);

    setTimeout(() => {
      const card = document.querySelector(`.canvas-card[data-filename="${CSS.escape(newFilename)}"]`);
      if (card) {
        card.classList.add('selected');
        openRefinePanel(newFilename, type);
      }
    }, 100);
  } catch (e) {
    stream.textContent += `\n\n❌ ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Generate & Link';
  }
}

// ── Multi-card context menu (batch operations) ───────────────
function _showMultiCardContextMenu(x, y, epicFilename, docType) {
  _closeLinkPopup();
  const count = _canvasSelectedCards.size;
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top  = `${y}px`;
  popup.innerHTML = `
    <div class="canvas-link-popup-title">${count} cards selected</div>
    <button id="_ctx-m-left">← Move all Left</button>
    <button id="_ctx-m-right">Move all Right →</button>
    <button id="_ctx-m-top">↑ Move all Top</button>
    <button id="_ctx-m-bottom">Move all Bottom ↓</button>
    <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">
    <button id="_ctx-m-delete" style="color:var(--danger,#ef4444)">🗑 Delete ${count} cards</button>`;
  document.body.appendChild(popup);

  popup.querySelector('#_ctx-m-left').addEventListener('click', () =>
    _moveCardsToEdge([..._canvasSelectedCards], 'left', epicFilename, docType));
  popup.querySelector('#_ctx-m-right').addEventListener('click', () =>
    _moveCardsToEdge([..._canvasSelectedCards], 'right', epicFilename, docType));
  popup.querySelector('#_ctx-m-top').addEventListener('click', () =>
    _moveCardsToEdge([..._canvasSelectedCards], 'top', epicFilename, docType));
  popup.querySelector('#_ctx-m-bottom').addEventListener('click', () =>
    _moveCardsToEdge([..._canvasSelectedCards], 'bottom', epicFilename, docType));
  popup.querySelector('#_ctx-m-delete').addEventListener('click', async () => {
    _closeLinkPopup();
    if (!confirm(`Delete ${count} selected items? This cannot be undone.`)) return;
    for (const fn of _canvasSelectedCards) {
      const doc = allDocs.find(d => d.filename === fn);
      if (!doc) continue;
      await fetch(`/api/doc/${doc.docType}/${encodeURIComponent(fn)}`, { method: 'DELETE' });
    }
    _canvasSelectedCards.clear();
    await loadDocs();
    await buildCanvasGraph(epicFilename, docType);
  });

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

async function _moveCardsToEdge(filenames, direction, epicFilename, docType) {
  _closeLinkPopup();
  const positions = Object.values(_activePanelState.layout);
  for (const fn of filenames) {
    const cur = _activePanelState.layout[fn];
    if (!cur) continue;
    let newCol = cur.col;
    let newRow = cur.row;
    switch (direction) {
      case 'left':   newCol = 0; break;
      case 'right':  newCol = Math.max(...positions.map(p => p.col)) + 1; break;
      case 'top':    newRow = 0; break;
      case 'bottom': newRow = Math.max(...positions.map(p => p.row)) + 1; break;
    }
    _activePanelState.layout[fn] = { col: newCol, row: newRow };
  }
  _canvasSelectedCards.clear();
  await saveCanvasLayout(_activePanelState, epicFilename);
  renderCanvas(epicFilename, docType);
}

function _openCanvasSplit(filename, childDocType, epicFilename, epicDocType) {
  const doc = allDocs.find(d => d.filename === filename);
  const typeName = TYPE_LABEL[childDocType] || childDocType;
  const panel = document.getElementById('refine-panel');
  panel.classList.add('open');
  document.querySelectorAll('.canvas-card.selected').forEach(el => el.classList.remove('selected'));

  panel.innerHTML = `
    <div class="rp-header">
      <div class="rp-meta">
        <span class="type-badge ${childDocType}">${typeName}</span>
        <span class="rp-title">Split: ${escHtml(doc?.title || filename)}</span>
      </div>
      <button class="rp-close" onclick="closeRefinePanel()" title="Close">✕</button>
    </div>
    <div class="rp-create-form">
      <div class="rp-field">
        <label class="rp-label">Describe what to extract into the new ${typeName}…</label>
        <textarea class="rp-textarea rp-textarea-tall" id="rp-split-idea"
          placeholder="What should the new ${typeName.toLowerCase()} cover?"></textarea>
      </div>
      <div class="rp-btn-row">
        <button class="btn-xs green" id="rp-split-btn"
          onclick="_executeCanvasSplit('${escHtml(filename)}','${escHtml(childDocType)}','${escHtml(epicFilename)}','${escHtml(epicDocType)}')">Generate &amp; Link</button>
        <button class="btn-xs" onclick="closeRefinePanel()">Cancel</button>
      </div>
      <div class="rp-stream" id="rp-split-stream" style="display:none"></div>
    </div>`;

  document.getElementById('rp-split-idea').focus();
}

async function _executeCanvasSplit(originalFilename, childDocType, epicFilename, epicDocType) {
  const idea = document.getElementById('rp-split-idea')?.value.trim();
  if (!idea) { document.getElementById('rp-split-idea')?.focus(); return; }

  const btn    = document.getElementById('rp-split-btn');
  const stream = document.getElementById('rp-split-stream');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '⚙ Generating…';
  stream.style.display = 'block';

  try {
    // Epic splitting uses the composite /api/split-epic endpoint
    if (childDocType === 'epic') {
      stream.textContent = '⚙ Splitting epic…';
      const splitRes = await fetch('/api/split-epic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epicFilename: originalFilename, description: idea }),
      });
      if (!splitRes.ok) throw new Error((await splitRes.json()).error?.message || 'Split failed');
      const result = await splitRes.json();

      stream.textContent = `✓ Created ${result.newEpicFilename}`;
      if (result.featureCreated) {
        stream.textContent += `\n✓ Auto-created feature: ${result.featureTitle}`;
        showJiraToast('ok', `Created feature "${result.featureTitle}" and new epic`);
      } else {
        showJiraToast('ok', `Created ${result.newEpicFilename}`);
      }

      await loadDocs();
      // Always switch to feature multi-panel so both epics are visible
      // side by side and stories can be moved between them
      closeRefinePanel();
      await openManualRefine(result.featureFilename, 'feature');
      return;
    }

    // Non-epic splitting: existing generate + link flow
    const origRes = await fetch(`/api/doc/${childDocType}/${encodeURIComponent(originalFilename)}`);
    if (!origRes.ok) throw new Error('Could not load original issue');
    const { content: origContent } = await origRes.json();
    const origDoc = allDocs.find(d => d.filename === originalFilename);

    stream.textContent = '⚙ Generating new issue…';

    const genBody = {
      idea: `${idea}\n\n---\nContext from original issue:\n${origContent}`,
      type: childDocType,
      priority: origDoc?.priority || 'Medium',
    };
    if (origDoc?.fixVersion) genBody.fixVersion = origDoc.fixVersion;
    if (origDoc?.pi && origDoc.pi !== 'TBD') genBody.pi = origDoc.pi;
    if (epicDocType === 'epic') genBody.parentEpic = epicFilename;
    if (epicDocType === 'feature') genBody.parentFeature = epicFilename;

    const genRes = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(genBody),
    });
    if (!genRes.ok) throw new Error((await genRes.json()).error?.message || 'Generate failed');
    const { filename: newFilename } = await genRes.json();

    stream.textContent = `✓ Created ${newFilename}\n⚙ Linking…`;

    const linkRes = await fetch('/api/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: childDocType,
        sourceFilename: newFilename,
        targetType: epicDocType,
        targetFilename: epicFilename,
      }),
    });
    if (!linkRes.ok) throw new Error('Link failed');

    stream.textContent += '\n✓ Linked successfully.';
    showJiraToast('ok', `Created ${newFilename}`);

    await loadDocs();
    await buildCanvasGraph(epicFilename, epicDocType);

    setTimeout(() => {
      const card = document.querySelector(`.canvas-card[data-filename="${CSS.escape(newFilename)}"]`);
      if (card) {
        card.classList.add('selected');
        openRefinePanel(newFilename, childDocType);
      }
    }, 100);
  } catch (e) {
    stream.textContent += `\n\n❌ ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Generate & Link';
  }
}

async function _moveCardToEdge(filename, direction, epicFilename, docType) {
  _closeLinkPopup();
  const cur = _activePanelState.layout[filename];
  if (!cur) return;

  const positions = Object.values(_activePanelState.layout);
  let newCol = cur.col;
  let newRow = cur.row;

  switch (direction) {
    case 'left':
      newCol = 0;
      break;
    case 'right':
      newCol = Math.max(...positions.map(p => p.col)) + 1;
      break;
    case 'top':
      newRow = 0;
      break;
    case 'bottom':
      newRow = Math.max(...positions.map(p => p.row)) + 1;
      break;
  }

  if (newCol === cur.col && newRow === cur.row) return;

  _activePanelState.layout[filename] = { col: newCol, row: newRow };
  await saveCanvasLayout(_activePanelState, epicFilename);
  renderCanvas(epicFilename, docType);
}

function _showLinkPopup(x, y, srcFilename, srcDocType, tgtFilename, tgtDocType) {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top  = `${y}px`;
  popup.innerHTML = `
    <button onclick="_createCanvasLink('blocks','${escHtml(srcFilename)}','${escHtml(srcDocType)}','${escHtml(tgtFilename)}','${escHtml(tgtDocType)}')">Add BLOCKS link</button>
    <button onclick="_createCanvasLink('parallel','${escHtml(srcFilename)}','${escHtml(srcDocType)}','${escHtml(tgtFilename)}','${escHtml(tgtDocType)}')">Add PARALLEL link</button>
    <button onclick="_closeLinkPopup()">Cancel</button>`;
  document.body.appendChild(popup);
  // Close on outside click
  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

async function _createCanvasLink(linkType, srcFilename, srcDocType, tgtFilename, tgtDocType) {
  _closeLinkPopup();
  // Reject epic node links
  if (!['story', 'spike', 'bug'].includes(tgtDocType)) {
    showJiraToast('error', 'Only leaf stories can be linked');
    return;
  }
  try {
    const res = await fetch('/api/link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ linkType, sourceType: srcDocType, sourceFilename: srcFilename, targetType: tgtDocType, targetFilename: tgtFilename }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Link failed');

    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename, _canvasDocType);
    _restoreManageLinksState();
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

async function resetCanvasLayout(epicFilename) {
  try {
    await fetch(`/api/canvas/layout/${encodeURIComponent(epicFilename)}`, { method: 'DELETE' });
  } catch {}
  _activePanelState.layout = computeAutoLayout(_activePanelState.stories, _activePanelState.blocks, _activePanelState.parallel);
  renderCanvas(epicFilename, _canvasDocType);
}

// ── Refine Panel ───────────────────────────────────────────────
function closeRefinePanel() {
  const panel = document.getElementById('refine-panel');
  panel.classList.remove('open');
  setTimeout(() => { if (!panel.classList.contains('open')) panel.innerHTML = ''; }, 230);
  document.querySelectorAll('.canvas-card.selected').forEach(el => el.classList.remove('selected'));
}

async function openRefinePanel(filename, docType) {
  const panel = document.getElementById('refine-panel');
  panel.innerHTML = '<div class="rp-loading">Loading…</div>';
  panel.classList.add('open');

  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('Not found');
    const { content } = await res.json();
    const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
    const title = doc?.title || filename;

    const ef = escHtml(filename);
    const et = escHtml(docType);

    const sp = doc?.storyPoints != null ? doc.storyPoints : '';
    const pri = doc?.priority || 'Medium';
    const isLeaf = ['story', 'spike', 'bug'].includes(docType);

    panel.innerHTML = `
      <div class="rp-header">
        <div class="rp-meta">
          <span class="type-badge ${docType}">${TYPE_LABEL[docType] || docType}</span>
          <button class="rp-close" onclick="closeRefinePanel()" title="Close">✕</button>
        </div>
        <input class="rp-title-input" id="rp-title-input" type="text"
          value="${escHtml(title)}" data-original="${escHtml(title)}"
          data-filename="${ef}" data-doctype="${et}"
          onblur="saveRpTitle()" onkeydown="if(event.key==='Enter'){this.blur()} if(event.key==='Escape'){cancelRpTitleEdit()}" />
        <div class="rp-edit-row">
          ${isLeaf ? `<div class="rp-edit-field">
            <label class="rp-edit-label">SP</label>
            <input class="rp-sp-input" id="rp-sp-input" type="number" min="0" max="999"
              value="${sp}" data-original="${sp}"
              placeholder="—"
              onblur="saveRpStoryPoints('${ef}','${et}')"
              onkeydown="if(event.key==='Enter'){this.blur()} if(event.key==='Escape'){this.blur()}" />
          </div>` : ''}
          <div class="rp-edit-field">
            <label class="rp-edit-label">Priority</label>
            <select class="rp-priority-select" id="rp-priority-select"
              onchange="saveRpPriority('${ef}','${et}')">
              <option value="Critical"${pri === 'Critical' ? ' selected' : ''}>Critical</option>
              <option value="High"${pri === 'High' ? ' selected' : ''}>High</option>
              <option value="Medium"${pri === 'Medium' ? ' selected' : ''}>Medium</option>
              <option value="Low"${pri === 'Low' ? ' selected' : ''}>Low</option>
            </select>
          </div>
        </div>
      </div>
      <div class="rp-toolbar">
        <button class="btn-xs" onclick="toggleRpUpgrade()">↑ Upgrade</button>
        <button class="btn-xs" onclick="openDoc('${ef}','${et}');closeRefineView()">↗ Open</button>
        ${docType !== 'feature' ? `<button class="btn-xs red" onclick="confirmRpDelete('${ef}','${et}')">Delete</button>` : ''}
      </div>
      <div class="rp-upgrade-wrap" id="rp-upgrade-wrap" style="display:none">
        <textarea class="rp-textarea" id="rp-upgrade-text"
          placeholder="Describe what to change or improve…"></textarea>
        <div class="rp-btn-row">
          <button class="btn-xs green" id="rp-upgrade-run"
            onclick="executeRpUpgrade('${ef}','${et}')">Regenerate</button>
          <button class="btn-xs" onclick="toggleRpUpgrade()">Cancel</button>
        </div>
        <div class="rp-stream" id="rp-upgrade-stream" style="display:none"></div>
      </div>
      <div class="rp-content markdown" id="rp-content">
        ${marked.parse(stripFrontmatter(content).replace(/\n## Comments\b[\s\S]*$/, ''))}
      </div>
      <div class="rp-deps-section" id="rp-deps-section">
        <div class="rp-loading">Loading dependencies…</div>
      </div>
      <div class="rp-comments-section comments-section hidden" id="rp-comments-section"></div>`;

    // Load and render dependency section and comments
    _loadRpDeps(filename, docType);
    _renderComments(_parseComments(content), filename, docType,
      document.getElementById('rp-comments-section'));
  } catch {
    panel.innerHTML = '<div class="rp-loading">Failed to load content.</div>';
  }
}

async function _loadRpDeps(filename, docType) {
  const section = document.getElementById('rp-deps-section');
  if (!section) return;
  try {
    const res = await fetch(`/api/links/${encodeURIComponent(docType)}/${encodeURIComponent(filename)}`);
    if (!res.ok) { section.innerHTML = ''; return; }
    const data = await res.json();

    function depRow(item, lType) {
      const ef = escHtml(item.filename);
      const et = escHtml(item.docType || docType);
      return `<div class="rp-dep-row">
        <span class="rp-dep-title">${escHtml(item.title || item.filename)}</span>
        <button class="btn-ghost btn-xs dep-remove-btn"
          onclick="_removeCanvasLink('${lType}','${escHtml(filename)}','${escHtml(docType)}','${ef}','${et}')">&times;</button>
      </div>`;
    }

    const blocks   = data.blocks   || [];
    const blockedBy = data.blockedBy || [];
    const parallel  = data.parallel  || [];

    section.innerHTML = `
      <div class="rp-deps-header">Dependencies</div>
      <div class="rp-dep-group">
        <div class="rp-dep-label">Blocks</div>
        ${blocks.length   ? blocks.map(i => depRow(i, 'blocks')).join('') : '<div class="dep-empty">None</div>'}
      </div>
      <div class="rp-dep-group">
        <div class="rp-dep-label">Blocked by</div>
        ${blockedBy.length ? blockedBy.map(i => depRow(i, 'blockedBy')).join('') : '<div class="dep-empty">None</div>'}
      </div>
      <div class="rp-dep-group">
        <div class="rp-dep-label">Parallel with</div>
        ${parallel.length  ? parallel.map(i => depRow(i, 'parallel')).join('') : '<div class="dep-empty">None</div>'}
      </div>`;
  } catch {
    section.innerHTML = '';
  }
}

async function _removeCanvasLink(linkType, srcFilename, srcDocType, tgtFilename, tgtDocType) {
  // For blockedBy direction: the blocker is tgt, the blocked is src
  let finalSrc = srcFilename, finalSrcType = srcDocType;
  let finalTgt = tgtFilename, finalTgtType = tgtDocType;
  if (linkType === 'blockedBy') {
    linkType = 'blocks';
    [finalSrc, finalSrcType, finalTgt, finalTgtType] = [tgtFilename, tgtDocType, srcFilename, srcDocType];
  }
  try {
    await fetch('/api/link', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ linkType, sourceType: finalSrcType, sourceFilename: finalSrc, targetType: finalTgtType, targetFilename: finalTgt }),
    });
    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename, _canvasDocType);
    // Reopen panel to refresh deps
    openRefinePanel(srcFilename, srcDocType);
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

// ── Inline field editing (refine panel) ───────────────────────
async function saveRpTitle() {
  const input = document.getElementById('rp-title-input');
  if (!input) return;
  const newTitle = input.value.trim();
  const original = input.dataset.original;
  const filename = input.dataset.filename;
  const docType  = input.dataset.doctype;
  if (!newTitle || newTitle === original || !filename) return;
  try {
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, { title: newTitle });
    input.dataset.original = newTitle;
    // Update canvas card title instantly
    const card = document.querySelector(`.canvas-card[data-filename="${CSS.escape(filename)}"] .canvas-card-title`);
    if (card) card.textContent = newTitle;
    // Update in-memory allDocs
    const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
    if (doc) doc.title = newTitle;
    // Update markdown heading in panel content
    const h2 = document.querySelector('#rp-content h2');
    if (h2) h2.textContent = newTitle;
  } catch {
    input.value = original;
  }
}

function cancelRpTitleEdit() {
  const input = document.getElementById('rp-title-input');
  if (input) { input.value = input.dataset.original || ''; input.blur(); }
}

async function saveRpStoryPoints(filename, docType) {
  const input = document.getElementById('rp-sp-input');
  if (!input) return;
  const newVal = input.value.trim();
  const orig   = input.dataset.original || '';
  if (newVal === orig) return;
  try {
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`,
      { storyPoints: newVal === '' ? null : Number(newVal) });
    input.dataset.original = newVal;
    // Update canvas card SP badge instantly
    const spEl = document.querySelector(`.canvas-card[data-filename="${CSS.escape(filename)}"] .canvas-card-sp`);
    if (spEl) spEl.textContent = newVal ? `${newVal} SP` : '';
    // Update in-memory
    const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
    if (doc) doc.storyPoints = newVal === '' ? null : Number(newVal);
  } catch {
    input.value = orig;
  }
}

async function saveRpPriority(filename, docType) {
  const sel = document.getElementById('rp-priority-select');
  if (!sel) return;
  const newPri = sel.value;
  try {
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, { priority: newPri });
    // Update in-memory
    const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
    if (doc) doc.priority = newPri;
  } catch (e) {
    showJiraToast('error', `Failed to save priority: ${e.message}`);
  }
}

function toggleRpUpgrade() {
  const wrap = document.getElementById('rp-upgrade-wrap');
  if (!wrap) return;
  const isOpen = wrap.style.display !== 'none';
  wrap.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) document.getElementById('rp-upgrade-text')?.focus();
}

async function executeRpUpgrade(filename, docType) {
  const feedback = document.getElementById('rp-upgrade-text')?.value.trim();
  if (!feedback) { document.getElementById('rp-upgrade-text')?.focus(); return; }

  const btn    = document.getElementById('rp-upgrade-run');
  const stream = document.getElementById('rp-upgrade-stream');
  btn.disabled = true;
  btn.textContent = '⏳ Regenerating…';
  stream.textContent = '';
  stream.style.display = 'block';

  try {
    let result = null;
    await streamSSE(
      `/api/doc/${docType}/${encodeURIComponent(filename)}/upgrade`,
      { feedback },
      {
        onText: (text) => { stream.textContent += text; },
        onDone: (payload) => { result = payload; },
      }
    );

    if (result) {
      document.getElementById('rp-content').innerHTML =
        marked.parse(stripFrontmatter(result.content));
      await loadDocs();
      // Update the card title in the canvas
      const updated = allDocs.find(d => d.filename === filename && d.docType === docType);
      if (updated) {
        const card = document.querySelector(`.canvas-card[data-filename="${CSS.escape(filename)}"] .canvas-card-title`);
        if (card) card.textContent = updated.title;
      }
    }
    btn.textContent = 'Regenerate';
    btn.disabled = false;
    stream.style.display = 'none';
    document.getElementById('rp-upgrade-wrap').style.display = 'none';
    document.getElementById('rp-upgrade-text').value = '';
  } catch (e) {
    stream.textContent += `\n\n❌ ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Regenerate';
  }
}

async function confirmRpDelete(filename, docType) {
  if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error?.message || 'Delete failed');
    closeRefinePanel();
    await buildCanvasGraph(_canvasEpicFilename, _canvasDocType);
  } catch (e) {
    alert(`Failed to delete: ${e.message}`);
  }
}

// ── Create new child node ──────────────────────────────────────
function openCreatePanel(type) {
  if (!_canvasEpicFilename) return;
  const panel = document.getElementById('refine-panel');
  panel.classList.add('open');
  document.querySelectorAll('.canvas-card.selected').forEach(el => el.classList.remove('selected'));

  panel.innerHTML = `
    <div class="rp-header">
      <div class="rp-meta">
        <span class="type-badge ${type}">${TYPE_LABEL[type] || type}</span>
        <span class="rp-title">New ${TYPE_LABEL[type]}</span>
      </div>
      <button class="rp-close" onclick="closeRefinePanel()" title="Close">✕</button>
    </div>
    <div class="rp-create-form">
      <div class="rp-field">
        <label class="rp-label">Title</label>
        <input class="rp-input" id="rp-create-title" type="text"
          placeholder="Optional — Claude will infer one…" />
      </div>
      <div class="rp-field">
        <label class="rp-label">Description *</label>
        <textarea class="rp-textarea rp-textarea-tall" id="rp-create-idea"
          placeholder="Describe the ${TYPE_LABEL[type].toLowerCase()}…"></textarea>
      </div>
      <div class="rp-btn-row">
        <button class="btn-xs green" id="rp-create-btn"
          onclick="executeRpCreate('${type}')">Generate &amp; Link</button>
        <button class="btn-xs" onclick="closeRefinePanel()">Cancel</button>
      </div>
      <div class="rp-stream" id="rp-create-stream" style="display:none"></div>
    </div>`;

  document.getElementById('rp-create-idea').focus();
}

async function executeRpCreate(type) {
  const title = document.getElementById('rp-create-title').value.trim();
  const idea  = document.getElementById('rp-create-idea').value.trim();
  if (!idea) { document.getElementById('rp-create-idea').focus(); return; }

  const btn    = document.getElementById('rp-create-btn');
  const stream = document.getElementById('rp-create-stream');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '⚙ Generating document…';
  stream.style.display = 'block';

  try {
    const parentDoc = allDocs.find(d => d.filename === _canvasEpicFilename);
    const genBody = { title, idea, type, priority: 'Medium' };
    if (parentDoc?.fixVersion) genBody.fixVersion = parentDoc.fixVersion;
    if (parentDoc?.pi && parentDoc.pi !== 'TBD') genBody.pi = parentDoc.pi;
    if (_canvasDocType === 'epic') genBody.parentEpic = _canvasEpicFilename;
    if (_canvasDocType === 'feature') genBody.parentFeature = _canvasEpicFilename;
    const genRes = await fetch('/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(genBody),
    });
    if (!genRes.ok) throw new Error((await genRes.json()).error?.message || 'Generate failed');
    const { filename: newFilename } = await genRes.json();

    stream.textContent = `✓ Created ${newFilename}\n⚙ Linking…`;

    const linkRes = await fetch('/api/link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        sourceType:     type,
        sourceFilename: newFilename,
        targetType:     _canvasDocType,
        targetFilename: _canvasEpicFilename,
      }),
    });
    if (!linkRes.ok) throw new Error('Link failed');

    stream.textContent += '\n✓ Linked successfully.';

    await loadDocs();
    await buildCanvasGraph(_canvasEpicFilename, _canvasDocType);

    setTimeout(() => {
      const card = document.querySelector(`.canvas-card[data-filename="${CSS.escape(newFilename)}"]`);
      if (card) {
        card.classList.add('selected');
        openRefinePanel(newFilename, type);
      }
    }, 100);
  } catch (e) {
    stream.textContent += `\n\n❌ ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Generate & Link';
  }
}
