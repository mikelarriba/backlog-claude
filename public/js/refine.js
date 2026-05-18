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
let _canvasEpicFilename = null;
let _canvasDocType      = null;
let _canvasLayout       = {};   // { storyFilename: { col, row } }
let _canvasStories      = [];
let _canvasParallel     = [];   // [{ a, b }] pairs
let _canvasBlocks       = [];   // [{ src, tgt }] pairs

// Grid constants
const CELL_W    = 240;
const CELL_H    = 110;
const GUTTER_X  = 60;
const GUTTER_Y  = 36;
const TOP_OFFSET = 80;

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

  // Render the correct "+ Create" buttons for this doc type
  const addBtns = document.getElementById('refine-add-btns');
  if (docType === 'feature') {
    addBtns.innerHTML = `<button class="btn-xs" onclick="openCreatePanel('epic')">＋ Epic</button>`;
  } else {
    addBtns.innerHTML = `
      <button class="btn-xs green" onclick="openCreatePanel('story')">＋ Story</button>
      <button class="btn-xs" onclick="openCreatePanel('spike')">＋ Spike</button>
      <button class="btn-xs red" onclick="openCreatePanel('bug')">＋ Bug</button>`;
  }

  closeRefinePanel();
  await buildCanvasGraph(filename, docType);
}

function closeRefineView() {
  document.getElementById('refine-view').classList.remove('show');
  updateSplitMode();

  // Clear canvas state
  _canvasEpicFilename = null;
  _canvasDocType      = null;
  _canvasLayout       = {};
  _canvasStories      = [];
  _canvasParallel     = [];
  _canvasBlocks       = [];

  if (currentFilename && currentDocType) {
    document.getElementById('detail-view').classList.add('show');
  } else {
    document.getElementById('list-view').style.display = 'flex';
  }
}

// ── Graph construction ─────────────────────────────────────────
async function buildCanvasGraph(filename, docType) {
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

  _canvasStories  = children;
  _canvasParallel = [];
  _canvasBlocks   = [];

  // Build blocks pairs from child blockedBy info
  const childFilenames = new Set(children.map(c => c.filename));
  for (const child of children) {
    const doc = allDocs.find(d => d.filename === child.filename);
    if (!doc) continue;
    for (const blockedFn of (doc.blocks || [])) {
      if (childFilenames.has(blockedFn)) {
        _canvasBlocks.push({ src: child.filename, tgt: blockedFn });
      }
    }
    for (const parallelFn of (doc.parallel || [])) {
      if (childFilenames.has(parallelFn)) {
        const pairKey = [child.filename, parallelFn].sort().join('|');
        if (!_canvasParallel.find(p => [p.a, p.b].sort().join('|') === pairKey)) {
          _canvasParallel.push({ a: child.filename, b: parallelFn });
        }
      }
    }
  }

  if (Object.keys(savedPositions).length > 0) {
    _canvasLayout = savedPositions;
  } else {
    _canvasLayout = computeAutoLayout(children, _canvasBlocks, _canvasParallel);
  }

  renderCanvas(filename, docType);
}

// ── Auto layout: topological BFS ──────────────────────────────
function computeAutoLayout(children, blocks, parallel) {
  const layout = {};
  if (!children.length) return layout;

  // Build adjacency: blockedBy means row = blocker.row + 1
  const blockedByMap = new Map();
  for (const { src, tgt } of blocks) {
    if (!blockedByMap.has(tgt)) blockedByMap.set(tgt, []);
    blockedByMap.get(tgt).push(src);
  }

  // BFS from roots (no blockedBy) to assign rows
  const rowMap = new Map();
  const queue  = [];
  for (const child of children) {
    if (!(blockedByMap.get(child.filename) || []).length) {
      rowMap.set(child.filename, 0);
      queue.push(child.filename);
    }
  }
  // Safety: any remaining unplaced stories get row 0
  for (const child of children) {
    if (!rowMap.has(child.filename)) { rowMap.set(child.filename, 0); queue.push(child.filename); }
  }

  // BFS to propagate row depths
  const visited = new Set(queue);
  while (queue.length) {
    const fn = queue.shift();
    const currentRow = rowMap.get(fn) || 0;
    for (const { src, tgt } of blocks) {
      if (src === fn && !visited.has(tgt)) {
        rowMap.set(tgt, Math.max(rowMap.get(tgt) || 0, currentRow + 1));
        visited.add(tgt);
        queue.push(tgt);
      }
    }
  }

  // Assign columns: parallel groups share a column, sequential chains go to col 0
  const colMap = new Map();
  let nextCol  = 0;

  // Group by parallel connected components
  const parallelSets = new Map();
  for (const child of children) parallelSets.set(child.filename, child.filename);

  function findRoot(fn) {
    if (parallelSets.get(fn) === fn) return fn;
    const root = findRoot(parallelSets.get(fn));
    parallelSets.set(fn, root);
    return root;
  }
  function union(a, b) {
    const ra = findRoot(a), rb = findRoot(b);
    if (ra !== rb) parallelSets.set(ra, rb);
  }

  for (const { a, b } of parallel) union(a, b);

  const componentCol = new Map();
  for (const child of children) {
    const root = findRoot(child.filename);
    if (!componentCol.has(root)) {
      componentCol.set(root, nextCol++);
    }
    colMap.set(child.filename, componentCol.get(root));
  }

  // Build layout
  const rowCounters = new Map(); // col → next available row within that col
  for (const child of children) {
    const col = colMap.get(child.filename) || 0;
    const row = rowMap.get(child.filename) || 0;
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

  if (!_canvasStories.length) {
    container.innerHTML = '<div class="canvas-empty">No stories linked to this epic yet. Use the buttons above to add some.</div>';
    return;
  }

  // Determine grid dimensions
  const cols = Math.max(...Object.values(_canvasLayout).map(p => p.col), 0) + 1;
  const rows = Math.max(...Object.values(_canvasLayout).map(p => p.row), 0) + 1;

  const totalW = cols * (CELL_W + GUTTER_X) + GUTTER_X;
  const totalH = TOP_OFFSET + rows * (CELL_H + GUTTER_Y) + GUTTER_Y + 40;

  container.style.width  = '100%';
  container.style.height = '100%';

  // Wrapper sized to content (for scrolling)
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `position:relative;min-width:${totalW}px;min-height:${totalH}px`;
  container.appendChild(wrapper);

  // SVG overlay layer
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'canvas-svg-layer');
  svg.setAttribute('width', totalW);
  svg.setAttribute('height', totalH);
  svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible';
  wrapper.appendChild(svg);

  // Dotted vertical lane dividers
  for (let c = 1; c < cols; c++) {
    const x = GUTTER_X + c * (CELL_W + GUTTER_X) - GUTTER_X / 2;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x); line.setAttribute('y1', TOP_OFFSET - 10);
    line.setAttribute('x2', x); line.setAttribute('y2', totalH - 20);
    line.setAttribute('stroke', 'var(--border)');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4 4');
    line.setAttribute('opacity', '0.5');
    svg.appendChild(line);
  }

  // Epic title node at top center
  const epicDoc = allDocs.find(d => d.filename === epicFilename && d.docType === docType);
  const epicNode = document.createElement('div');
  epicNode.className = 'canvas-epic-node';
  const epicCenterX = totalW / 2;
  epicNode.style.cssText = `left:${epicCenterX - 110}px;top:14px;width:220px`;
  epicNode.innerHTML = `
    <span class="type-badge ${docType}">${TYPE_LABEL[docType] || docType}</span>
    <span class="canvas-epic-title">${escHtml(epicDoc?.title || epicFilename)}</span>`;
  wrapper.appendChild(epicNode);

  // Story cards
  const cardPositions = {}; // filename → { cx, cy, el }
  for (const child of _canvasStories) {
    const pos = _canvasLayout[child.filename] || { col: 0, row: 0 };
    const x   = GUTTER_X + pos.col * (CELL_W + GUTTER_X);
    const y   = TOP_OFFSET + pos.row * (CELL_H + GUTTER_Y);
    const cx  = x + CELL_W / 2;
    const cy  = y + CELL_H / 2;

    const doc = allDocs.find(d => d.filename === child.filename);
    const sp  = doc?.storyPoints ? `${doc.storyPoints} SP` : '';

    const card = document.createElement('div');
    card.className = 'canvas-card';
    card.dataset.filename = child.filename;
    card.dataset.doctype  = child.docType || docType;
    card.style.cssText = `left:${x}px;top:${y}px;width:${CELL_W}px;min-height:${CELL_H}px`;
    card.setAttribute('draggable', 'true');
    card.innerHTML = `
      <div class="canvas-card-header">
        <span class="type-badge ${child.docType || docType}">${TYPE_LABEL[child.docType || docType] || child.docType}</span>
        ${sp ? `<span class="canvas-card-sp">${sp}</span>` : ''}
      </div>
      <div class="canvas-card-title">${escHtml(child.title || child.filename)}</div>`;

    card.addEventListener('click', () => {
      document.querySelectorAll('.canvas-card.selected').forEach(el => el.classList.remove('selected'));
      card.classList.add('selected');
      openRefinePanel(child.filename, child.docType || docType);
    });

    wrapper.appendChild(card);
    cardPositions[child.filename] = { cx, cy, el: card, x, y };
  }

  // Init drag-to-reposition
  initCanvasDrag(wrapper, svg, epicFilename, cols, rows, cardPositions);

  // Draw SVG edges after cards are placed
  drawCanvasEdges(svg, cardPositions, epicFilename, epicCenterX, totalW);
}

// ── Draw SVG edges ─────────────────────────────────────────────
function drawCanvasEdges(svg, cardPositions, epicFilename, epicCenterX, totalW) {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  // Arrowhead marker for BLOCKS edges
  defs.innerHTML = `
    <marker id="arrow-blocks" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#ef4444"/>
    </marker>
    <marker id="arrow-sec" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="var(--border)"/>
    </marker>`;
  svg.appendChild(defs);

  // SEC arrows: connect cards in the same column, ordered by row
  const byCols = {};
  for (const [fn, pos] of Object.entries(_canvasLayout)) {
    if (!byCols[pos.col]) byCols[pos.col] = [];
    byCols[pos.col].push({ fn, row: pos.row });
  }
  for (const colItems of Object.values(byCols)) {
    colItems.sort((a, b) => a.row - b.row);
    for (let i = 0; i < colItems.length - 1; i++) {
      const src = cardPositions[colItems[i].fn];
      const tgt = cardPositions[colItems[i + 1].fn];
      if (!src || !tgt) continue;
      // Skip if there's already a BLOCKS edge between them
      const hasBlocks = _canvasBlocks.some(b =>
        (b.src === colItems[i].fn && b.tgt === colItems[i + 1].fn) ||
        (b.src === colItems[i + 1].fn && b.tgt === colItems[i].fn)
      );
      if (hasBlocks) continue;

      const x1 = src.cx, y1 = src.y + CELL_H;
      const x2 = tgt.cx, y2 = tgt.y;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mx = (x1 + x2) / 2;
      path.setAttribute('d', `M${x1},${y1} C${x1},${y1 + 20} ${x2},${y2 - 20} ${x2},${y2}`);
      path.setAttribute('stroke', 'var(--border)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#arrow-sec)');
      svg.appendChild(path);

      // SEC label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x1 + 6);
      label.setAttribute('y', y1 + (y2 - y1) / 2);
      label.setAttribute('class', 'canvas-edge-label');
      label.textContent = 'SEC';
      svg.appendChild(label);
    }
  }

  // BLOCKS arrows (red)
  for (const { src, tgt } of _canvasBlocks) {
    const s = cardPositions[src];
    const t = cardPositions[tgt];
    if (!s || !t) continue;

    const x1 = s.cx, y1 = s.y + CELL_H;
    const x2 = t.cx, y2 = t.y;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} C${x1},${y1 + 24} ${x2},${y2 - 24} ${x2},${y2}`);
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
  }

  // PARALLEL brackets (dotted horizontal bracket above both cards)
  for (const { a, b } of _canvasParallel) {
    const pa = cardPositions[a];
    const pb = cardPositions[b];
    if (!pa || !pb) continue;

    const x1 = pa.x;
    const x2 = pb.x + CELL_W;
    const y  = Math.min(pa.y, pb.y) - 14;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${pa.y - 4} V${y} H${x2} V${pb.y - 4}`);
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
  }
}

// ── Drag-to-reposition ─────────────────────────────────────────
function initCanvasDrag(wrapper, svg, epicFilename, cols, rows) {
  let draggingFilename = null;
  let draggingDocType  = null;

  document.querySelectorAll('.canvas-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      draggingFilename = card.dataset.filename;
      draggingDocType  = card.dataset.doctype;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggingFilename = null;
    });
  });

  // Create drop cell overlays
  const maxCols = cols + 1;
  const maxRows = rows + 2;
  for (let col = 0; col < maxCols; col++) {
    for (let row = 0; row < maxRows; row++) {
      const cell = document.createElement('div');
      cell.className = 'canvas-drop-cell';
      cell.dataset.col = col;
      cell.dataset.row = row;
      cell.style.cssText = `
        left:${GUTTER_X + col * (CELL_W + GUTTER_X)}px;
        top:${TOP_OFFSET + row * (CELL_H + GUTTER_Y)}px;
        width:${CELL_W}px;height:${CELL_H}px`;
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', async e => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        if (!draggingFilename) return;
        const newCol = parseInt(cell.dataset.col);
        const newRow = parseInt(cell.dataset.row);
        const current = _canvasLayout[draggingFilename] || {};
        if (current.col === newCol && current.row === newRow) return; // no-op
        _canvasLayout[draggingFilename] = { col: newCol, row: newRow };
        await saveCanvasLayout(epicFilename);
        renderCanvas(epicFilename, _canvasDocType);
      });
      wrapper.appendChild(cell);
    }
  }
}

async function saveCanvasLayout(epicFilename) {
  try {
    await fetch(`/api/canvas/layout/${encodeURIComponent(epicFilename)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ positions: _canvasLayout }),
    });
  } catch { /* silent */ }
}

async function resetCanvasLayout(epicFilename) {
  try {
    await fetch(`/api/canvas/layout/${encodeURIComponent(epicFilename)}`, { method: 'DELETE' });
  } catch {}
  _canvasLayout = computeAutoLayout(_canvasStories, _canvasBlocks, _canvasParallel);
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

    panel.innerHTML = `
      <div class="rp-header">
        <div class="rp-meta">
          <span class="type-badge ${docType}">${TYPE_LABEL[docType] || docType}</span>
          <span class="rp-title">${escHtml(title)}</span>
        </div>
        <button class="rp-close" onclick="closeRefinePanel()" title="Close">✕</button>
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
        ${marked.parse(stripFrontmatter(content))}
      </div>`;
  } catch {
    panel.innerHTML = '<div class="rp-loading">Failed to load content.</div>';
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
    const genRes = await fetch('/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, idea, type, priority: 'Medium' }),
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
