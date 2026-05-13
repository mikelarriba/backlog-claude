// ── Manual Refinement View ─────────────────────────────────────
// Visual hierarchy editor for Epics. Uses Cytoscape.js with the
// dagre layout plugin for automatic top-down node placement.
//
// Scope: Feature → Epic → [Stories, Spikes, Bugs]
// Clicking a node opens a slide-in panel with full markdown content,
// an upgrade (AI rewrite) panel, and a delete action.
// "+ Story / + Spike / + Bug" buttons in the header open a creation
// form that generates the doc and links it in one flow.

let _cy = null;                 // Cytoscape instance
let _refineEpicFilename = null; // the doc we're refining
let _refineDocType      = null; // 'epic' or 'feature'

// ── Entry / Exit ───────────────────────────────────────────────
async function openManualRefine(filename, docType) {
  // Support legacy call signature: openManualRefine(epicFilename) with no docType
  if (!filename) return;
  docType = docType || 'epic';
  _refineEpicFilename = filename;
  _refineDocType      = docType;
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
  await buildRefineGraph(filename, docType);
}

function closeRefineView() {
  document.getElementById('refine-view').classList.remove('show');
  // Restore split mode if the screen is wide enough
  updateSplitMode();

  if (_cy) { _cy.destroy(); _cy = null; }

  // Return to wherever the user came from
  if (currentFilename && currentDocType) {
    document.getElementById('detail-view').classList.add('show');
  } else {
    document.getElementById('list-view').style.display = 'flex';
  }
}

// ── Graph construction ─────────────────────────────────────────
async function buildRefineGraph(filename, docType) {
  const canvas = document.getElementById('refine-canvas');
  canvas.innerHTML = '';

  let parent = null;
  let children = [];
  try {
    const res = await fetch(`/api/links/${docType}/${encodeURIComponent(filename)}`);
    if (res.ok) ({ parent, children } = await res.json());
  } catch { /* show graph with just the root node */ }

  const epic = allDocs.find(d => d.filename === filename && d.docType === docType);

  const nodes = [];
  const edges = [];

  // ── Parent node (Feature above Epic, if any) ─────────────────
  if (parent) {
    nodes.push(makeNode(parent, false));
    edges.push({ data: { id: `${parent.filename}→${filename}`, source: parent.filename, target: filename, edgeType: 'hierarchy' } });
  }

  // ── Current (root) node ──────────────────────────────────────
  nodes.push(makeNode({ filename, docType, title: epic?.title || filename, status: epic?.status || 'Draft' }, true));

  // ── Child nodes ──────────────────────────────────────────────
  const childFilenames = new Set();
  for (const child of children) {
    nodes.push(makeNode(child, false));
    childFilenames.add(child.filename);
  }

  // ── Collect dep edges among children ─────────────────────────
  const depEdgeSet = new Set(); // "src→tgt"
  for (const child of children) {
    const doc = allDocs.find(d => d.filename === child.filename);
    if (!doc) continue;
    for (const blockedFn of (doc.blocks || [])) {
      if (childFilenames.has(blockedFn)) depEdgeSet.add(`${child.filename}→${blockedFn}`);
    }
  }

  // ── Sort children: rank → priority, then topo-enforce deps ───
  const PRIO = { Critical: 0, Major: 0, High: 1, Medium: 2, Low: 3 };
  const sorted = [...children].sort((a, b) => {
    const da = allDocs.find(d => d.filename === a.filename);
    const db = allDocs.find(d => d.filename === b.filename);
    const ra = da?.rank != null ? da.rank : 9999;
    const rb = db?.rank != null ? db.rank : 9999;
    if (ra !== rb) return ra - rb;
    const pa = PRIO[(da?.priority || 'Medium')] ?? 2;
    const pb = PRIO[(db?.priority || 'Medium')] ?? 2;
    return pa - pb;
  });
  // Topological pass: blocked item must come after its blocker
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < sorted.length; i++) {
      const doc = allDocs.find(d => d.filename === sorted[i].filename);
      for (const bf of (doc?.blockedBy || []).filter(f => childFilenames.has(f))) {
        const bi = sorted.findIndex(c => c.filename === bf);
        if (bi > i) {
          const [item] = sorted.splice(i, 1);
          sorted.splice(bi, 0, item);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  // ── Build edges as a vertical chain ──────────────────────────
  // Epic → first child → second child → … (top to bottom)
  // Edges that also represent a dependency are styled differently.
  if (sorted.length > 0) {
    edges.push({ data: { id: `${filename}→${sorted[0].filename}`, source: filename, target: sorted[0].filename, edgeType: 'hierarchy' } });

    for (let i = 0; i < sorted.length - 1; i++) {
      const src = sorted[i].filename;
      const tgt = sorted[i + 1].filename;
      const isDep = depEdgeSet.has(`${src}→${tgt}`);
      edges.push({ data: { id: `${src}→${tgt}`, source: src, target: tgt, edgeType: isDep ? 'dependency' : 'sequence' } });
      depEdgeSet.delete(`${src}→${tgt}`);
    }

    // Cross-chain dep edges (blocker and blocked aren't adjacent in the chain)
    for (const key of depEdgeSet) {
      const [src, tgt] = key.split('→');
      edges.push({ data: { id: `dep-${src}→${tgt}`, source: src, target: tgt, edgeType: 'dependency' } });
    }
  }

  _cy = cytoscape({
    container: canvas,
    elements: { nodes, edges },
    layout: {
      name: 'dagre',
      rankDir: 'TB',
      nodeSep: 70,
      rankSep: 100,
      padding: 50,
      animate: true,
      animationDuration: 280,
    },
    style: buildCyStyle(),
    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false,
    minZoom: 0.25,
    maxZoom: 3,
  });

  // Node click → open panel
  _cy.on('tap', 'node', (e) => {
    const node = e.target;
    _cy.nodes().removeClass('cy-selected');
    node.addClass('cy-selected');
    openRefinePanel(node.data('filename'), node.data('docType'));
  });

  // Background click → close panel
  _cy.on('tap', (e) => {
    if (e.target === _cy) {
      _cy.nodes().removeClass('cy-selected');
      closeRefinePanel();
    }
  });
}

function makeNode(doc, isCurrent) {
  const typeLabel = (TYPE_LABEL[doc.docType] || doc.docType).toUpperCase();
  const title     = doc.title || doc.filename;
  return {
    data: {
      id:       doc.filename,
      label:    `${typeLabel}\n${title}`,
      type:     doc.docType,
      filename: doc.filename,
      docType:  doc.docType,
      status:   doc.status || 'Draft',
      current:  isCurrent ? 'yes' : '',
    }
  };
}

// ── Cytoscape styles (reads CSS variables for theme awareness) ──
// NOTE: rgba backgrounds don't composite against the canvas the same way they
// do against a DOM surface, so we use solid surface colours for fills and
// reserve the type accent colour for the border only — matching the app's
// card/badge visual language.
let _cachedCyColors = null;
function getCyColors() {
  if (_cachedCyColors) return _cachedCyColors;
  const cs = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  _cachedCyColors = {
    text: cs('--text'), surface: cs('--surface'), border: cs('--border'), accent: cs('--accent'),
    feature: cs('--type-feature-color'), epic: cs('--type-epic-color'),
    story: cs('--type-story-color'), spike: cs('--type-spike-color'), bug: cs('--type-bug-color'),
  };
  return _cachedCyColors;
}

function buildCyStyle() {
  const colors = getCyColors();

  return [
    // ── Default node ─────────────────────────────────────────────
    {
      selector: 'node',
      style: {
        'shape':            'round-rectangle',
        'width':            210,
        'height':           72,
        'padding':          14,
        'label':            'data(label)',
        'text-valign':      'center',
        'text-halign':      'center',
        'font-size':        '11px',
        'font-weight':      '500',
        'font-family':      'system-ui, sans-serif',
        'text-wrap':        'wrap',
        'text-max-width':   '180px',
        'line-height':      1.55,
        'color':            colors.text,
        'background-color': colors.surface,
        'border-width':     2,
        'border-color':     colors.border,
      }
    },
    // ── Type-specific: accent border only (no background override) ─
    { selector: 'node[type="feature"]', style: { 'border-color': colors.feature } },
    { selector: 'node[type="epic"]',    style: { 'border-color': colors.epic    } },
    { selector: 'node[type="story"]',   style: { 'border-color': colors.story   } },
    { selector: 'node[type="spike"]',   style: { 'border-color': colors.spike   } },
    { selector: 'node[type="bug"]',     style: { 'border-color': colors.bug     } },
    // ── Current epic: thicker accent border ───────────────────────
    {
      selector: 'node[current="yes"]',
      style: { 'border-width': 3, 'border-color': colors.accent }
    },
    // ── Selected ──────────────────────────────────────────────────
    {
      selector: 'node.cy-selected',
      style: {
        'border-width':    3,
        'border-color':    colors.accent,
        'overlay-color':   colors.accent,
        'overlay-opacity': 0.08,
        'overlay-padding': 6,
      }
    },
    // ── Edges ─────────────────────────────────────────────────────
    {
      selector: 'edge',
      style: {
        'width':              1.5,
        'line-color':         colors.border,
        'target-arrow-color': colors.border,
        'target-arrow-shape': 'triangle',
        'curve-style':        'bezier',
        'arrow-scale':        1.1,
      }
    },
    // Dependency edges: red dashed
    {
      selector: 'edge[edgeType="dependency"]',
      style: {
        'width':              2,
        'line-color':         '#ef4444',
        'target-arrow-color': '#ef4444',
        'line-style':         'dashed',
        'line-dash-pattern':  [6, 3],
      }
    },
    {
      selector: 'edge.cy-highlighted',
      style: {
        'line-color':         colors.accent,
        'target-arrow-color': colors.accent,
      }
    }
  ];
}

// ── Refine Panel ───────────────────────────────────────────────
function closeRefinePanel() {
  const panel = document.getElementById('refine-panel');
  panel.classList.remove('open');
  // Clear after transition
  setTimeout(() => { if (!panel.classList.contains('open')) panel.innerHTML = ''; }, 230);
  if (_cy) _cy.nodes().removeClass('cy-selected');
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

    // Escape values for inline onclick attributes
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
      // Update the node label in the graph to reflect any title change
      const updated = allDocs.find(d => d.filename === filename && d.docType === docType);
      if (updated && _cy) {
        const typeLabel = (TYPE_LABEL[updated.docType] || updated.docType).toUpperCase();
        _cy.getElementById(filename).data('label', `${typeLabel}\n${updated.title}`);
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
    if (_cy) {
      _cy.getElementById(filename).remove();
    }
  } catch (e) {
    alert(`Failed to delete: ${e.message}`);
  }
}

// ── Create new child node ──────────────────────────────────────
function openCreatePanel(type) {
  if (!_refineEpicFilename) return;
  const panel = document.getElementById('refine-panel');
  panel.classList.add('open');
  if (_cy) _cy.nodes().removeClass('cy-selected');

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
    // 1. Generate the new doc
    const genRes = await fetch('/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, idea, type, priority: 'Medium' }),
    });
    if (!genRes.ok) throw new Error((await genRes.json()).error?.message || 'Generate failed');
    const { filename: newFilename } = await genRes.json();

    stream.textContent = `✓ Created ${newFilename}\n⚙ Linking…`;

    // 2. Link it to the current root doc (epic or feature)
    const linkRes = await fetch('/api/link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        sourceType:     type,
        sourceFilename: newFilename,
        targetType:     _refineDocType,
        targetFilename: _refineEpicFilename,
      }),
    });
    if (!linkRes.ok) throw new Error('Link failed');

    stream.textContent += '\n✓ Linked successfully.';

    // 3. Refresh allDocs and rebuild the full graph so the chain
    //    recalculates correctly with the new node included
    await loadDocs();
    await buildRefineGraph(_refineEpicFilename, _refineDocType);

    // 4. Open the new node's panel after a short delay
    setTimeout(() => {
      if (_cy) {
        const node = _cy.getElementById(newFilename);
        node.addClass('cy-selected');
        openRefinePanel(newFilename, type);
      }
    }, 400);
  } catch (e) {
    stream.textContent += `\n\n❌ ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Generate & Link';
  }
}
