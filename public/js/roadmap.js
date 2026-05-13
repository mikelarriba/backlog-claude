// ── Roadmap View (Two-Panel: Epics + Stories) ─────────────────
let _roadmapPiName       = null;  // selected PI filter (null = all)
let _roadmapPanelState   = { epics: true, stories: true }; // expanded/collapsed
let _roadmapFocusedEpic  = null;  // filename of clicked epic (focus mode)

// ── Story-point card heights (Fibonacci scale) ────────────────
const SP_HEIGHTS = { 0:56, 1:64, 2:72, 3:80, 5:96, 8:112, 13:132, 21:160 };
function spCardHeight(sp) {
  const n = Number(sp) || 0;
  const keys = Object.keys(SP_HEIGHTS).map(Number);
  const closest = keys.reduce((p, c) => Math.abs(c - n) < Math.abs(p - n) ? c : p);
  return SP_HEIGHTS[closest];
}

// ── Priority ordering ─────────────────────────────────────────
const PRIO_ORDER = { critical:0, major:0, high:1, medium:2, low:3 };

// ── Topological sort: priority/rank first, then dep-order ─────
// Ensures blockers always appear before the items they block within
// the same sprint column. Uses a stable bubble-pass approach.
function topoSortCards(docs) {
  if (!docs.length) return docs;

  // First sort by rank, then priority
  const sorted = [...docs].sort((a, b) => {
    const ra = a.rank != null ? a.rank : 9999;
    const rb = b.rank != null ? b.rank : 9999;
    if (ra !== rb) return ra - rb;
    const pa = PRIO_ORDER[(a.priority || 'medium').toLowerCase()] ?? 2;
    const pb = PRIO_ORDER[(b.priority || 'medium').toLowerCase()] ?? 2;
    return pa - pb;
  });

  // Enforce dep ordering: blocked item must come after its blocker
  const filenameSet = new Set(docs.map(d => d.filename));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < sorted.length; i++) {
      const blockers = (sorted[i].blockedBy || []).filter(f => filenameSet.has(f));
      for (const bf of blockers) {
        const bi = sorted.findIndex(d => d.filename === bf);
        if (bi > i) {
          // Blocker sits below blocked item — move blocked item to after blocker
          const [item] = sorted.splice(i, 1);
          sorted.splice(bi, 0, item);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return sorted;
}

// Palette for epic cards — consistent hash-based colour
const _EPIC_COLORS = [
  '#3B82F6','#8B5CF6','#10B981','#14B8A6',
  '#F59E0B','#EC4899','#06B6D4','#6366F1',
];
function epicColor(key) {
  let h = 0;
  for (const c of (key || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return _EPIC_COLORS[h % _EPIC_COLORS.length];
}

// ── Open / Close ─────────────────────────────────────────────
function openRoadmapView() {
  // Hide other views
  document.getElementById('list-view').style.display = 'none';
  document.getElementById('refine-view')?.classList.remove('show');
  document.getElementById('detail-view').classList.remove('show');
  document.querySelector('.right').classList.remove('has-selection');
  currentFilename = null;
  currentDocType  = null;

  // Show roadmap
  document.getElementById('roadmap-view').classList.add('show');
  document.querySelector('.right').classList.add('roadmap-mode');

  // Populate PI filter dropdown
  populateRoadmapPiFilter();

  // Reset focus
  _roadmapFocusedEpic = null;

  renderRoadmapBoard();
}

function closeRoadmapView() {
  document.getElementById('roadmap-view').classList.remove('show');
  document.querySelector('.right').classList.remove('roadmap-mode');
  document.querySelector('.right').classList.remove('has-selection');
  document.getElementById('detail-view').classList.remove('show');
  currentFilename = null;
  currentDocType  = null;
  document.getElementById('list-view').style.display = '';
  _roadmapPiName      = null;
  _roadmapFocusedEpic = null;
}

function isRoadmapOpen() {
  return document.getElementById('roadmap-view').classList.contains('show');
}

function refreshRoadmapView() {
  if (isRoadmapOpen()) renderRoadmapBoard();
}

// ── PI Filter ────────────────────────────────────────────────
function populateRoadmapPiFilter() {
  const select = document.getElementById('roadmap-pi-filter');
  if (!select) return;
  let html = '<option value="">All Sprints</option>';
  if (piSettings.currentPi) {
    html += `<option value="${escHtml(piSettings.currentPi)}">${escHtml(piSettings.currentPi)}</option>`;
  }
  if (piSettings.nextPi) {
    html += `<option value="${escHtml(piSettings.nextPi)}">${escHtml(piSettings.nextPi)}</option>`;
  }
  select.innerHTML = html;
  if (_roadmapPiName) select.value = _roadmapPiName;
}

function filterRoadmapByPi(piName) {
  _roadmapPiName = piName || null;
  renderRoadmapBoard();
}

// ── Panel collapse ───────────────────────────────────────────
function toggleRoadmapPanel(panel) {
  _roadmapPanelState[panel] = !_roadmapPanelState[panel];
  const body    = document.getElementById(`rm-body-${panel}`);
  const chevron = document.getElementById(`rm-chevron-${panel}`);
  if (_roadmapPanelState[panel]) {
    body.classList.remove('collapsed');
    chevron.textContent = '▼';
  } else {
    body.classList.add('collapsed');
    chevron.textContent = '▶';
  }
}

// ── Epic focus (click on epic card) ──────────────────────────
function focusEpic(filename) {
  if (_roadmapFocusedEpic === filename) {
    _roadmapFocusedEpic = null; // toggle off
  } else {
    _roadmapFocusedEpic = filename;
  }
  applyEpicFocus();
}

function applyEpicFocus() {
  // Epic panel: highlight focused epic
  document.querySelectorAll('.rm-epic-card').forEach(card => {
    card.classList.toggle('rm-focused', card.dataset.filename === _roadmapFocusedEpic);
    card.classList.toggle('rm-dimmed', _roadmapFocusedEpic && card.dataset.filename !== _roadmapFocusedEpic);
  });

  // Story panel: dim non-matching stories
  document.querySelectorAll('.roadmap-card').forEach(card => {
    if (!_roadmapFocusedEpic) {
      card.classList.remove('rm-dimmed');
      return;
    }
    const parent = card.dataset.parent || '';
    card.classList.toggle('rm-dimmed', parent !== _roadmapFocusedEpic);
  });
}

// ── Gather all sprints across PIs ────────────────────────────
function getAllSprints() {
  // If a PI filter is active, only show that PI's sprints
  if (_roadmapPiName && sprintConfig[_roadmapPiName]) {
    return sprintConfig[_roadmapPiName];
  }
  // Else merge all PI sprints in order (current then next)
  const all = [];
  const seen = new Set();
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  for (const pi of pis) {
    for (const s of (sprintConfig[pi] || [])) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        all.push(s);
      }
    }
  }
  return all;
}

// ── Main render ──────────────────────────────────────────────
function renderRoadmapBoard() {
  const sprints = getAllSprints();

  if (!sprints.length) {
    document.getElementById('rm-body-epics').innerHTML = '<div class="roadmap-empty">No sprints configured. Set up sprints in PI Sprint Config.</div>';
    document.getElementById('rm-body-stories').innerHTML = '';
    document.getElementById('rm-count-epics').textContent = '0';
    document.getElementById('rm-count-stories').textContent = '0';
    return;
  }

  renderEpicPanel(sprints);
  renderStoryPanel(sprints);
  injectGhostCards();
  applyEpicFocus();
  attachRoadmapDepHoverListeners();
}

// ── Epic panel rendering ─────────────────────────────────────
function renderEpicPanel(sprints) {
  const body = document.getElementById('rm-body-epics');

  // Get epics that have children in the visible sprints
  const epicTypes = new Set(['epic', 'feature']);
  const leafTypes = new Set(['story', 'spike', 'bug']);

  // All visible leaf docs (respect PI filter)
  const piFilter = _roadmapPiName;
  const visibleLeafs = piFilter
    ? allDocs.filter(d => leafTypes.has(d.docType) && d.fixVersion === piFilter)
    : allDocs.filter(d => leafTypes.has(d.docType) && d.sprint);

  // Map: epicFilename → { epicDoc, sprintSet, storyCount, totalSP }
  const epicMap = new Map();
  for (const leaf of visibleLeafs) {
    const key = leaf.parentFilename || '__none__';
    if (!epicMap.has(key)) {
      const epicDoc = leaf.parentFilename
        ? allDocs.find(d => d.filename === leaf.parentFilename)
        : null;
      epicMap.set(key, { epicDoc, sprints: new Set(), storyCount: 0, totalSP: 0 });
    }
    const entry = epicMap.get(key);
    entry.storyCount++;
    entry.totalSP += Number(leaf.storyPoints) || 0;
    if (leaf.sprint) entry.sprints.add(leaf.sprint);
  }

  // Also add epics with no children yet but have a sprint assignment
  for (const d of allDocs) {
    if (epicTypes.has(d.docType) && !epicMap.has(d.filename)) {
      if (piFilter && d.fixVersion !== piFilter) continue;
      epicMap.set(d.filename, { epicDoc: d, sprints: new Set(), storyCount: 0, totalSP: 0 });
    }
  }

  // Sort: named epics first (by title)
  const sorted = [...epicMap.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === '__none__') return 1;
    if (kb === '__none__') return -1;
    return (a.epicDoc?.title || ka).localeCompare(b.epicDoc?.title || kb);
  });

  document.getElementById('rm-count-epics').textContent = sorted.length;

  // Sprint name → index for positioning
  const sprintIdx = new Map(sprints.map((s, i) => [s.name, i]));
  const N = sprints.length;

  // Header row
  const headerCells = sprints.map(s => `
    <div class="rm-sprint-header-cell">${escHtml(s.name)}</div>
  `).join('');

  // Epic rows
  let rowsHtml = '';
  for (const [key, { epicDoc, sprints: sprintSet, storyCount, totalSP }] of sorted) {
    const isNone = key === '__none__';
    const title  = epicDoc?.title || (isNone ? 'Unlinked Stories' : key);
    const color  = isNone ? 'var(--muted)' : epicColor(key);
    const fn     = epicDoc?.filename || '';

    // Compute sprint span
    const indices = [...sprintSet]
      .filter(s => sprintIdx.has(s))
      .map(s => sprintIdx.get(s));
    const minIdx = indices.length ? Math.min(...indices) : -1;
    const maxIdx = indices.length ? Math.max(...indices) : -1;

    // Bar geometry
    let barHtml = '';
    if (minIdx >= 0) {
      const leftPct  = ((minIdx / N) * 100).toFixed(2);
      const widthPct = (((maxIdx - minIdx + 1) / N) * 100).toFixed(2);
      barHtml = `<div class="rm-epic-bar" style="left:${leftPct}%;width:${widthPct}%;background:${color};"></div>`;
    }

    // Grid cells (vertical lines)
    const cells = sprints.map(() => '<div class="rm-grid-cell"></div>').join('');

    const meta = `${storyCount} stor${storyCount !== 1 ? 'ies' : 'y'} · ${totalSP} SP`;

    rowsHtml += `
      <div class="rm-epic-card${isNone ? ' rm-epic-unlinked' : ''}"
           data-filename="${escHtml(fn)}"
           onclick="${fn ? `focusEpic('${escHtml(fn)}')` : ''}">
        <div class="rm-epic-name-col">
          <div class="rm-epic-dot" style="background:${color}"></div>
          <div class="rm-epic-info">
            <div class="rm-epic-title">${escHtml(title)}</div>
            <div class="rm-epic-meta">${escHtml(meta)}</div>
          </div>
        </div>
        <div class="rm-epic-timeline">
          ${cells}
          ${barHtml}
        </div>
      </div>`;
  }

  body.innerHTML = `
    <div class="rm-board-header">
      <div class="rm-name-col-header">Epic / Feature</div>
      <div class="rm-sprint-headers">${headerCells}</div>
    </div>
    ${rowsHtml}`;
}

// ── Story panel rendering ────────────────────────────────────
function renderStoryPanel(sprints) {
  const body = document.getElementById('rm-body-stories');

  const leafTypes = new Set(['story', 'spike', 'bug']);
  const piFilter  = _roadmapPiName;

  // Get visible stories
  const piDocs = piFilter
    ? allDocs.filter(d => leafTypes.has(d.docType) && d.fixVersion === piFilter)
    : allDocs.filter(d => leafTypes.has(d.docType) && (d.fixVersion === piSettings.currentPi || d.fixVersion === piSettings.nextPi));

  document.getElementById('rm-count-stories').textContent = piDocs.length;

  // Group by sprint
  const grouped = new Map();
  const unassigned = [];
  for (const s of sprints) grouped.set(s.name, []);

  for (const d of piDocs) {
    if (d.sprint && grouped.has(d.sprint)) {
      grouped.get(d.sprint).push(d);
    } else {
      unassigned.push(d);
    }
  }

  // Render columns (same sprint order as epic panel)
  let html = '';
  for (const s of sprints) {
    const docs = grouped.get(s.name) || [];
    html += renderStoryColumn(s.name, docs, s.capacity);
  }
  // Unassigned
  html += renderStoryColumn(null, unassigned, 0);

  body.innerHTML = `<div class="rm-story-columns">${html}</div>`;
  initRoadmapDragDrop();
}

function renderStoryColumn(sprintName, docs, capacity) {
  const isUnassigned = !sprintName;
  const label        = isUnassigned ? 'Unassigned' : escHtml(sprintName);
  const columnClass  = isUnassigned ? 'roadmap-column roadmap-unassigned' : 'roadmap-column';

  const usedSP = docs.reduce((sum, d) => sum + (Number(d.storyPoints) || 0), 0);

  let statsHtml = '';
  let barHtml   = '';
  if (!isUnassigned && capacity > 0) {
    const pct      = Math.round((usedSP / capacity) * 100);
    const barClass = pct > 100 ? 'over' : pct > 90 ? 'warn' : '';
    const barWidth = Math.min(pct, 100);
    statsHtml = `<span class="roadmap-col-stats">${usedSP} / ${capacity} SP</span>`;
    barHtml   = `<div class="roadmap-capacity-bar ${barClass}"><div class="roadmap-capacity-fill" style="width:${barWidth}%"></div></div>`;
  } else if (!isUnassigned) {
    statsHtml = `<span class="roadmap-col-stats">${usedSP} SP</span>`;
  } else {
    statsHtml = `<span class="roadmap-col-stats">${docs.length} item(s)</span>`;
  }

  const sortedDocs = topoSortCards(docs);
  const cardsHtml = sortedDocs.length
    ? sortedDocs.map(d => renderRoadmapCard(d, sprintName)).join('')
    : '<div class="roadmap-card-empty">No items</div>';

  return `
    <div class="${columnClass}" data-sprint="${sprintName ? escHtml(sprintName) : ''}">
      <div class="roadmap-column-header">
        <span class="roadmap-col-name">${label}</span>
        ${statsHtml}
      </div>
      ${barHtml}
      <div class="roadmap-card-list" data-sprint="${sprintName ? escHtml(sprintName) : ''}">
        ${cardsHtml}
      </div>
    </div>`;
}

function renderRoadmapCard(d, sprintName) {
  const priorityClass = (d.priority || 'Medium').replace(/\s+/g, '-').toLowerCase();
  const sp      = Number(d.storyPoints) || 0;
  const spLabel = sp ? `${sp} SP` : 'No SP';
  const spClass = sp ? 'rm-badge rm-sp' : 'rm-badge rm-no-sp';
  const cardHeight = spCardHeight(sp);

  // Find parent epic for focus feature
  const parentFn = d.parentFilename || '';
  let parentHtml = '';
  if (parentFn) {
    const parent = allDocs.find(p => p.filename === parentFn);
    if (parent) {
      const color = epicColor(parentFn);
      parentHtml = `<div class="roadmap-card-parent"><span class="rm-parent-dot" style="background:${color}"></span>${escHtml(parent.title)}</div>`;
    }
  }

  // Dependency badges
  const blocks    = d.blocks    || [];
  const blockedBy = d.blockedBy || [];
  let depHtml = '';
  if (blockedBy.length) depHtml += `<div class="dep-badge dep-blocked">⬅ blocked by ${blockedBy.length}</div>`;
  if (blocks.length)    depHtml += `<div class="dep-badge dep-blocks">→ blocks ${blocks.length}</div>`;

  const depBlockedClass = blockedBy.length ? ' rm-dep-blocked' : '';

  return `
    <div class="roadmap-card${depBlockedClass}" draggable="true"
         onclick="openDoc('${escHtml(d.filename)}','${d.docType}')"
         data-filename="${escHtml(d.filename)}"
         data-doctype="${d.docType}"
         data-sp="${sp}"
         data-parent="${escHtml(parentFn)}"
         data-sprint="${d.sprint ? escHtml(d.sprint) : ''}"
         style="min-height:${cardHeight}px">
      ${parentHtml}
      <div class="roadmap-card-title">${escHtml(d.title)}</div>
      ${depHtml}
      <div class="roadmap-card-meta">
        <span class="rm-badge rm-type-${d.docType}">${TYPE_LABEL[d.docType] || d.docType}</span>
        <span class="rm-badge rm-priority-${priorityClass}">${escHtml(d.priority || 'Medium')}</span>
        <span class="${spClass}">${spLabel}</span>
      </div>
      <button class="rm-dep-btn" title="Manage dependencies"
              onclick="event.stopPropagation();openDepModal('${escHtml(d.filename)}','${d.docType}')">⛓</button>
    </div>`;
}

// ── Ghost cards for stories split across PIs ─────────────────
function injectGhostCards() {
  const leafTypes = new Set(['story', 'spike', 'bug']);

  // Find stories whose PI (fixVersion) differs from their parent epic's PI
  const crossPiStories = allDocs.filter(d => {
    if (!leafTypes.has(d.docType) || !d.parentFilename || !d.fixVersion) return false;
    const parent = allDocs.find(p => p.filename === d.parentFilename);
    return parent && parent.fixVersion && parent.fixVersion !== d.fixVersion;
  });

  for (const story of crossPiStories) {
    const parent = allDocs.find(p => p.filename === story.parentFilename);
    if (!parent || !parent.fixVersion) continue;

    // Find the first rendered sprint column belonging to the parent's PI
    const parentSprints = (typeof sprintConfig !== 'undefined' && sprintConfig[parent.fixVersion]) || [];
    let targetList = null;
    for (const s of parentSprints) {
      targetList = document.querySelector(`.roadmap-card-list[data-sprint="${CSS.escape(s.name)}"]`);
      if (targetList) break;
    }
    if (!targetList) continue;

    const color = epicColor(parent.filename);
    const ghostHtml = `
      <div class="roadmap-card ghost-card"
           onclick="openDoc('${escHtml(story.filename)}','${story.docType}')"
           title="Story is in ${escHtml(story.fixVersion)}; parent epic is in ${escHtml(parent.fixVersion)}">
        <div class="roadmap-card-parent">
          <span class="rm-parent-dot" style="background:${color}"></span>${escHtml(parent.title)}
        </div>
        <div class="roadmap-card-title">${escHtml(story.title)}</div>
        <div class="ghost-card-label">⤵ Split to ${escHtml(story.fixVersion)}</div>
      </div>`;
    targetList.insertAdjacentHTML('beforeend', ghostHtml);
  }
}

// ── Drag and drop (sprint move + in-column rerank + dep popup) ─
function initRoadmapDragDrop() {
  const cards     = document.querySelectorAll('.roadmap-card[draggable]');
  const dropZones = document.querySelectorAll('.roadmap-card-list');

  function clearCardDropClasses() {
    document.querySelectorAll('.roadmap-card').forEach(c =>
      c.classList.remove('rm-drop-center', 'rm-insert-before', 'rm-insert-after'));
  }

  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        filename:   card.dataset.filename,
        docType:    card.dataset.doctype,
        fromSprint: card.dataset.sprint,
      }));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      clearCardDropClasses();
      dropZones.forEach(z => z.classList.remove('drag-over'));
    });

    // ── Per-card zone detection ──
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation(); // prevent bubbling to card-list drag-over
      const rect = card.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const zone = relY < rect.height * 0.3 ? 'before'
                 : relY > rect.height * 0.7 ? 'after'
                 : 'center';
      card.classList.remove('rm-drop-center', 'rm-insert-before', 'rm-insert-after');
      if (zone === 'center')       card.classList.add('rm-drop-center');
      else if (zone === 'before')  card.classList.add('rm-insert-before');
      else                         card.classList.add('rm-insert-after');
      e.dataTransfer.dropEffect = 'move';
    });

    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget))
        card.classList.remove('rm-drop-center', 'rm-insert-before', 'rm-insert-after');
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const zone = relY < rect.height * 0.3 ? 'before'
                 : relY > rect.height * 0.7 ? 'after'
                 : 'center';
      clearCardDropClasses();

      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.filename === card.dataset.filename) return;

        if (zone === 'center') {
          // Dep / link popup (reuses dragdrop.js global)
          showDropActionPopup(data.filename, data.docType, card, e.clientX, e.clientY);
        } else {
          // Rerank: determine insertBefore filename
          let insertBeforeFilename;
          if (zone === 'before') {
            insertBeforeFilename = card.dataset.filename;
          } else {
            // Insert after = insert before the next card in the same column
            const list = card.closest('.roadmap-card-list');
            const allCards = list
              ? [...list.querySelectorAll('.roadmap-card[data-filename]')]
              : [];
            const idx = allCards.indexOf(card);
            insertBeforeFilename = (idx >= 0 && idx + 1 < allCards.length)
              ? allCards[idx + 1].dataset.filename
              : null;
          }
          await executeRerankDrop(data.filename, data.docType, insertBeforeFilename);
          renderRoadmapBoard();
        }
      } catch (err) { console.warn('Roadmap card drop failed:', err.message); }
    });
  });

  // ── Column-level drop (cross-sprint move) ────────────────────
  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      // Card drops stop propagation so this only fires for empty-area drops
      try {
        const data     = JSON.parse(e.dataTransfer.getData('text/plain'));
        const toSprint = zone.dataset.sprint || null;
        if (data.fromSprint === (toSprint || '')) return;

        await patchJSON(`/api/doc/${data.docType}/${encodeURIComponent(data.filename)}`, { sprint: toSprint });
        const doc = allDocs.find(d => d.filename === data.filename && d.docType === data.docType);
        if (doc) doc.sprint = toSprint;
        renderRoadmapBoard();
      } catch (err) { console.warn('Failed to update sprint assignment:', err.message); }
    });
  });
}

// ── Roadmap dep hover listeners ──────────────────────────────
function attachRoadmapDepHoverListeners() {
  document.querySelectorAll('.roadmap-card[data-filename]').forEach(el => {
    const doc = allDocs.find(d => d.filename === el.dataset.filename);
    if (!doc) return;
    if (!(doc.blocks || []).length && !(doc.blockedBy || []).length) return;
    el.addEventListener('mouseenter', () => showDepConnectors(doc.filename));
    el.addEventListener('mouseleave', hideDepConnectors);
  });
}

// ── Dependency modal ─────────────────────────────────────────
let _depModalFilename = null;
let _depModalDocType  = null;

async function openDepModal(filename, docType) {
  _depModalFilename = filename;
  _depModalDocType  = docType;

  const doc = allDocs.find(d => d.filename === filename);
  document.getElementById('dep-modal-subtitle').textContent = doc?.title || filename;

  // Reset state
  document.getElementById('dep-blocks-list').innerHTML   = '<div class="dep-loading">Loading…</div>';
  document.getElementById('dep-blockedby-list').innerHTML = '';

  document.getElementById('dep-overlay').classList.add('show');

  try {
    const data = await fetch(`/api/links/${encodeURIComponent(docType)}/${encodeURIComponent(filename)}`).then(r => r.json());
    renderDepLists(data);
    populateDepTargetSelect(filename, data);
  } catch (e) {
    document.getElementById('dep-blocks-list').innerHTML = `<div class="dep-error">${escHtml(e.message)}</div>`;
  }
}

function renderDepLists(data) {
  function depItemHtml(item, direction) {
    return `
      <div class="dep-item">
        <span class="dep-item-title">${escHtml(item.title || item.filename)}</span>
        <button class="btn-ghost btn-xs dep-remove-btn"
                onclick="removeDepLink('${escHtml(item.filename)}','${escHtml(item.docType || _depModalDocType)}','${direction}')"
                title="Remove">&times;</button>
      </div>`;
  }

  const blocksList    = document.getElementById('dep-blocks-list');
  const blockedByList = document.getElementById('dep-blockedby-list');

  blocksList.innerHTML = (data.blocks || []).length
    ? (data.blocks || []).map(item => depItemHtml(item, 'blocks')).join('')
    : '<div class="dep-empty">None</div>';

  blockedByList.innerHTML = (data.blockedBy || []).length
    ? (data.blockedBy || []).map(item => depItemHtml(item, 'blockedBy')).join('')
    : '<div class="dep-empty">None</div>';
}

function populateDepTargetSelect(excludeFilename, currentData) {
  const select = document.getElementById('dep-target-select');
  const leafTypes = new Set(['story', 'spike', 'bug']);
  const alreadyBlocks = new Set((currentData.blocks || []).map(b => b.filename));
  alreadyBlocks.add(excludeFilename);

  const candidates = allDocs
    .filter(d => leafTypes.has(d.docType) && !alreadyBlocks.has(d.filename))
    .sort((a, b) => (a.title || a.filename).localeCompare(b.title || b.filename));

  select.innerHTML = candidates.length
    ? candidates.map(d => `<option value="${escHtml(d.filename)}" data-doctype="${d.docType}">${escHtml(d.title || d.filename)}</option>`).join('')
    : '<option value="" disabled>No candidates</option>';
}

async function addDepLink() {
  const select = document.getElementById('dep-target-select');
  const targetFilename = select.value;
  if (!targetFilename) return;
  const targetDocType  = select.selectedOptions[0]?.dataset.doctype || 'story';

  try {
    await postJSON('/api/link', {
      linkType: 'blocks',
      sourceType: _depModalDocType, sourceFilename: _depModalFilename,
      targetType: targetDocType,    targetFilename,
    });
    // Refresh modal
    const data = await fetch(`/api/links/${encodeURIComponent(_depModalDocType)}/${encodeURIComponent(_depModalFilename)}`).then(r => r.json());
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename, data);
    // Update allDocs entry
    const srcDoc = allDocs.find(d => d.filename === _depModalFilename);
    if (srcDoc) { srcDoc.blocks = srcDoc.blocks || []; if (!srcDoc.blocks.includes(targetFilename)) srcDoc.blocks.push(targetFilename); }
    const tgtDoc = allDocs.find(d => d.filename === targetFilename);
    if (tgtDoc) { tgtDoc.blockedBy = tgtDoc.blockedBy || []; if (!tgtDoc.blockedBy.includes(_depModalFilename)) tgtDoc.blockedBy.push(_depModalFilename); }
    renderRoadmapBoard();
  } catch (e) { showJiraToast('error', e.message); }
}

async function removeDepLink(targetFilename, targetDocType, direction) {
  try {
    let srcFilename, srcDocType, tgtFilename, tgtDocType;
    if (direction === 'blocks') {
      srcFilename = _depModalFilename; srcDocType = _depModalDocType;
      tgtFilename = targetFilename;    tgtDocType = targetDocType;
    } else {
      srcFilename = targetFilename;    srcDocType = targetDocType;
      tgtFilename = _depModalFilename; tgtDocType = _depModalDocType;
    }
    await fetch('/api/link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkType: 'blocks', sourceType: srcDocType, sourceFilename: srcFilename, targetType: tgtDocType, targetFilename: tgtFilename }),
    });
    // Refresh modal
    const data = await fetch(`/api/links/${encodeURIComponent(_depModalDocType)}/${encodeURIComponent(_depModalFilename)}`).then(r => r.json());
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename, data);
    // Update allDocs entries
    const srcDoc = allDocs.find(d => d.filename === srcFilename);
    if (srcDoc) srcDoc.blocks = (srcDoc.blocks || []).filter(f => f !== tgtFilename);
    const tgtDoc = allDocs.find(d => d.filename === tgtFilename);
    if (tgtDoc) tgtDoc.blockedBy = (tgtDoc.blockedBy || []).filter(f => f !== srcFilename);
    renderRoadmapBoard();
  } catch (e) { showJiraToast('error', e.message); }
}

function closeDepModal() {
  document.getElementById('dep-overlay').classList.remove('show');
  _depModalFilename = null;
  _depModalDocType  = null;
}

// ── Split modal (kept from old roadmap) ──────────────────────
let _splitModalFilename = null;
let _splitModalDocType  = null;
let _splitModalSprint1  = null;
let _splitModalSprint2  = null;

function openSplitModal(filename, docType, sprint1, sprint2) {
  _splitModalFilename = filename;
  _splitModalDocType  = docType;
  _splitModalSprint1  = sprint1 || null;
  _splitModalSprint2  = sprint2 || null;

  const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
  const sp  = Number(doc?.storyPoints) || 0;
  const sprints = getAllSprints();

  const sprintOptions = sprints.map(s =>
    `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`
  ).join('');

  const sel1 = sprint1 ? `<option value="${escHtml(sprint1)}" selected>${escHtml(sprint1)}</option>${sprintOptions}` : sprintOptions;
  const sel2 = sprint2 ? `<option value="${escHtml(sprint2)}" selected>${escHtml(sprint2)}</option>${sprintOptions}` : sprintOptions;

  document.getElementById('split-modal-title').textContent = doc?.title || filename;
  document.getElementById('split-modal-sp').textContent = sp ? `${sp} SP → ~${Math.round(sp / 2)} SP each` : 'No SP estimate';
  document.getElementById('split-sprint-1').innerHTML = sel1;
  document.getElementById('split-sprint-2').innerHTML = sel2;
  document.getElementById('split-modal-output').innerHTML = '';
  document.getElementById('split-modal-status').className = 'split-modal-status';

  const applyBtn = document.getElementById('split-apply-btn');
  applyBtn.disabled = false;
  applyBtn.textContent = 'Split with AI';

  document.getElementById('split-overlay').classList.add('show');
}

function closeSplitModal() {
  document.getElementById('split-overlay').classList.remove('show');
  _splitModalFilename = null;
  _splitModalDocType  = null;
}

async function executeSplit() {
  if (!_splitModalFilename) return;

  const sprint1 = document.getElementById('split-sprint-1').value;
  const sprint2 = document.getElementById('split-sprint-2').value;
  const btn     = document.getElementById('split-apply-btn');
  const output  = document.getElementById('split-modal-output');
  const status  = document.getElementById('split-modal-status');

  btn.disabled    = true;
  btn.textContent = 'Splitting…';
  output.textContent = '';
  status.className   = 'split-modal-status';

  try {
    const res = await fetch('/api/docs/split-story', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        filename:    _splitModalFilename,
        docType:     _splitModalDocType,
        targetCount: 2,
        sprints:     [sprint1, sprint2].filter(Boolean),
      }),
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done   = false;
    let result = null;

    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.error) throw new Error(payload.error.message || 'Split failed');
          if (payload.text)  output.textContent += payload.text;
          if (payload.done) { result = payload; done = true; }
        } catch (parseErr) {
          if (parseErr.message !== 'Split failed') continue;
          throw parseErr;
        }
      }
    }

    if (result) {
      status.className   = 'split-modal-status show success';
      status.textContent = `Created ${result.files.length} stories. Original deleted.`;
      btn.textContent    = 'Done';
      setTimeout(() => closeSplitModal(), 2000);
    }
  } catch (err) {
    status.className   = 'split-modal-status show error';
    status.textContent = err.message || 'Split failed';
    btn.disabled       = false;
    btn.textContent    = 'Retry';
  }
}

