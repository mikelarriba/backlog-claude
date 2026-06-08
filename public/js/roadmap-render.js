// ── Roadmap rendering helpers and render functions ─────────────
import { escHtml, TYPE_LABEL } from './state.js';
import { applyEpicFocus, getAllSprints } from './roadmap.js';
import { initRoadmapDragDrop, attachRoadmapDepHoverListeners } from './roadmap-drag.js';
import { syncRoadmapSelectionUI } from './roadmap-select.js';

// ── Story-point card heights (Fibonacci scale) ────────────────
const SP_HEIGHTS = { 0: 56, 1: 64, 2: 72, 3: 80, 5: 96, 8: 112, 13: 132, 21: 160 };
function spCardHeight(sp) {
  const n = Number(sp) || 0;
  const keys = Object.keys(SP_HEIGHTS).map(Number);
  const closest = keys.reduce((p, c) => (Math.abs(c - n) < Math.abs(p - n) ? c : p));
  return SP_HEIGHTS[closest];
}

// ── Priority ordering ─────────────────────────────────────────
const PRIO_ORDER = { critical: 0, major: 0, high: 1, medium: 2, low: 3 };

// ── Topological sort: priority/rank first, then dep-order ─────
// Ensures blockers always appear before the items they block within
// the same sprint column. Uses a stable bubble-pass approach.
export function topoSortCards(docs) {
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
  const filenameSet = new Set(docs.map((d) => d.filename));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < sorted.length; i++) {
      const blockers = (sorted[i].blockedBy || []).filter((f) => filenameSet.has(f));
      for (const bf of blockers) {
        const bi = sorted.findIndex((d) => d.filename === bf);
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
  '#3B82F6',
  '#8B5CF6',
  '#10B981',
  '#14B8A6',
  '#F59E0B',
  '#EC4899',
  '#06B6D4',
  '#6366F1',
];
export function epicColor(key) {
  let h = 0;
  for (const c of key || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return _EPIC_COLORS[h % _EPIC_COLORS.length];
}

// ── Main render ──────────────────────────────────────────────
export function renderRoadmapBoard() {
  const sprints = getAllSprints();

  if (!sprints.length) {
    document.getElementById('rm-body-epics').innerHTML =
      '<div class="roadmap-empty">No sprints configured. Set up sprints in PI Sprint Config.</div>';
    document.getElementById('rm-body-stories').innerHTML = '';
    document.getElementById('rm-count-epics').textContent = '0';
    document.getElementById('rm-count-stories').textContent = '0';
    return;
  }

  renderEpicPanel(sprints);
  renderStoryPanel(sprints);
  injectGhostCards();
  applyEpicFocus();
  syncRoadmapSelectionUI();
  attachRoadmapDepHoverListeners();
}

// ── Epic panel rendering ─────────────────────────────────────
export function renderEpicPanel(sprints) {
  const body = document.getElementById('rm-body-epics');

  const epicTypes = new Set(['epic']);
  const leafTypes = new Set(['story', 'spike', 'bug']);

  // All visible leaf docs (respect PI checkboxes)
  const visibleLeafs = allDocs.filter(
    (d) => leafTypes.has(d.docType) && d.fixVersion && _roadmapVisiblePis.has(d.fixVersion)
  );

  // Map: epicFilename → { epicDoc, sprintSet, storyCount, totalSP }
  const epicMap = new Map();
  for (const leaf of visibleLeafs) {
    const key = leaf.parentFilename || '__none__';
    if (!epicMap.has(key)) {
      const epicDoc = leaf.parentFilename
        ? allDocs.find((d) => d.filename === leaf.parentFilename)
        : null;
      epicMap.set(key, { epicDoc, sprints: new Set(), storyCount: 0, totalSP: 0 });
    }
    const entry = epicMap.get(key);
    entry.storyCount++;
    entry.totalSP += Number(leaf.storyPoints) || 0;
    if (leaf.sprint) entry.sprints.add(leaf.sprint);
  }

  // Also add epics/features with no children yet
  for (const d of allDocs) {
    if (epicTypes.has(d.docType) && !epicMap.has(d.filename)) {
      epicMap.set(d.filename, { epicDoc: d, sprints: new Set(), storyCount: 0, totalSP: 0 });
    }
  }

  // Sort: by rank, then filename descending
  const sorted = [...epicMap.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === '__none__') return 1;
    if (kb === '__none__') return -1;
    const ra = a.epicDoc?.rank != null ? a.epicDoc.rank : 9999;
    const rb = b.epicDoc?.rank != null ? b.epicDoc.rank : 9999;
    if (ra !== rb) return ra - rb;
    return kb.localeCompare(ka);
  });

  document.getElementById('rm-count-epics').textContent = sorted.length;

  // Sprint name → index for positioning
  const sprintIdx = new Map(sprints.map((s, i) => [s.name, i]));
  const N = sprints.length;

  // Header row
  const headerCells = sprints
    .map(
      (s) => `
    <div class="rm-sprint-header-cell">${escHtml(s.name)}</div>
  `
    )
    .join('');

  // Epic rows
  let rowsHtml = '';
  for (const [key, { epicDoc, sprints: sprintSet, storyCount, totalSP }] of sorted) {
    const isNone = key === '__none__';
    const title = epicDoc?.title || (isNone ? 'Unlinked Stories' : key);
    const color = isNone ? 'var(--muted)' : epicColor(key);
    const fn = epicDoc?.filename || '';
    const snippet = epicDoc?.descriptionSnippet || '';

    // Compute sprint span
    const indices = [...sprintSet].filter((s) => sprintIdx.has(s)).map((s) => sprintIdx.get(s));
    const minIdx = indices.length ? Math.min(...indices) : -1;
    const maxIdx = indices.length ? Math.max(...indices) : -1;

    // Bar geometry
    let barHtml = '';
    if (minIdx >= 0) {
      const leftPct = ((minIdx / N) * 100).toFixed(2);
      const widthPct = (((maxIdx - minIdx + 1) / N) * 100).toFixed(2);
      barHtml = `<div class="rm-epic-bar" style="left:${leftPct}%;width:${widthPct}%;background:${color};"></div>`;
    }

    // Grid cells (vertical lines)
    const cells = sprints.map(() => '<div class="rm-grid-cell"></div>').join('');

    const meta = `${storyCount} stor${storyCount !== 1 ? 'ies' : 'y'} · ${totalSP} SP`;

    // Tooltip data attributes for hover popup
    const tooltipAttrs = snippet
      ? ` data-tooltip-title="${escHtml(title)}" data-tooltip-desc="${escHtml(snippet)}"`
      : ` data-tooltip-title="${escHtml(title)}"`;

    const epicDocType = epicDoc?.docType || 'epic';
    rowsHtml += `
      <div class="rm-epic-card${isNone ? ' rm-epic-unlinked' : ''}"
           data-filename="${escHtml(fn)}" data-doctype="${epicDocType}"${tooltipAttrs}
           onclick="${fn ? `handleRoadmapEpicClick(event,'${escHtml(fn)}','${epicDocType}')` : ''}"
           oncontextmenu="${fn ? `handleEpicContextMenu(event,'${escHtml(fn)}','${epicDocType}')` : ''}">
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
      <div class="rm-name-col-header">Epic</div>
      <div class="rm-sprint-headers">${headerCells}</div>
    </div>
    ${rowsHtml}`;

  // Attach tooltip hover listeners
  body.querySelectorAll('.rm-epic-card[data-tooltip-title]').forEach((card) => {
    card.addEventListener('mouseenter', showFeatureTooltip);
    card.addEventListener('mouseleave', hideFeatureTooltip);
  });
}

// ── Story panel rendering ────────────────────────────────────
export function renderStoryPanel(sprints) {
  const body = document.getElementById('rm-body-stories');

  const leafTypes = new Set(['story', 'spike', 'bug']);

  // Get visible stories (respect PI checkboxes)
  const piDocs = allDocs.filter(
    (d) => leafTypes.has(d.docType) && d.fixVersion && _roadmapVisiblePis.has(d.fixVersion)
  );

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

export function renderStoryColumn(sprintName, docs, capacity) {
  const isUnassigned = !sprintName;
  const label = isUnassigned ? 'Unassigned' : escHtml(sprintName);
  const columnClass = isUnassigned ? 'roadmap-column roadmap-unassigned' : 'roadmap-column';

  const usedSP = docs.reduce((sum, d) => sum + (Number(d.storyPoints) || 0), 0);

  // eslint-disable-next-line no-useless-assignment
  let statsHtml = '';
  let barHtml = '';
  if (!isUnassigned && capacity > 0) {
    const pct = Math.round((usedSP / capacity) * 100);
    const barClass = pct > 100 ? 'over' : pct > 90 ? 'warn' : '';
    const barWidth = Math.min(pct, 100);
    statsHtml = `<span class="roadmap-col-stats">${usedSP} / ${capacity} SP</span>`;
    barHtml = `<div class="roadmap-capacity-bar ${barClass}"><div class="roadmap-capacity-fill" style="width:${barWidth}%"></div></div>`;
  } else if (!isUnassigned) {
    statsHtml = `<span class="roadmap-col-stats">${usedSP} SP</span>`;
  } else {
    statsHtml = `<span class="roadmap-col-stats">${docs.length} item(s)</span>`;
  }

  const sortedDocs = topoSortCards(docs);
  const cardsHtml = sortedDocs.length
    ? sortedDocs.map((d) => renderRoadmapCard(d, sprintName)).join('')
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

export function renderRoadmapCard(d, _sprintName) {
  const priorityClass = (d.priority || 'Medium').replace(/\s+/g, '-').toLowerCase();
  const sp = Number(d.storyPoints) || 0;
  const spLabel = sp ? `${sp} SP` : 'No SP';
  const spClass = sp ? 'rm-badge rm-sp' : 'rm-badge rm-no-sp';
  const cardHeight = spCardHeight(sp);

  // Find parent epic for focus
  const parentFn = d.parentFilename || '';
  let parentHtml = '';
  if (parentFn) {
    const parent = allDocs.find((p) => p.filename === parentFn);
    if (parent) {
      const color = epicColor(parentFn);
      parentHtml = `<div class="roadmap-card-parent"><span class="rm-parent-dot" style="background:${color}"></span>${escHtml(parent.title)}</div>`;
    }
  }

  // Dependency badges
  const blocks = d.blocks || [];
  const blockedBy = d.blockedBy || [];
  const parallel = d.parallel || [];
  let depHtml = '';
  if (blockedBy.length)
    depHtml += `<div class="dep-badge dep-blocked">⬅ blocked by ${blockedBy.length}</div>`;
  if (blocks.length) depHtml += `<div class="dep-badge dep-blocks">→ blocks ${blocks.length}</div>`;
  if (parallel.length)
    depHtml += `<div class="dep-badge dep-parallel"># parallel ${parallel.length}</div>`;

  const depBlockedClass = blockedBy.length ? ' rm-dep-blocked' : '';
  const noEstimateClass = sp ? '' : ' rm-no-estimate';

  return `
    <div class="roadmap-card${depBlockedClass}${noEstimateClass}" draggable="true"
         onclick="handleRoadmapCardClick(event,'${escHtml(d.filename)}','${d.docType}')"
         oncontextmenu="handleStoryContextMenu(event,'${escHtml(d.filename)}','${d.docType}')"
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
      <button class="rm-dep-btn" title="Manage dependencies (blocks / blocked by)"
              onclick="event.stopPropagation();openDepModal('${escHtml(d.filename)}','${d.docType}')">⛓</button>
    </div>`;
}

// ── Feature tooltip popup ────────────────────────────────────
let _tooltipEl = null;

export function showFeatureTooltip(e) {
  const card = e.currentTarget;
  const title = card.dataset.tooltipTitle || '';
  const desc = card.dataset.tooltipDesc || '';
  if (!title) return;

  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'rm-feature-tooltip';
    document.body.appendChild(_tooltipEl);
  }

  let html = `<div class="rm-tooltip-title">${escHtml(title)}</div>`;
  if (desc) html += `<div class="rm-tooltip-desc">${escHtml(desc)}</div>`;
  _tooltipEl.innerHTML = html;
  _tooltipEl.classList.add('show');

  const rect = card.getBoundingClientRect();
  _tooltipEl.style.left = rect.left + 12 + 'px';
  _tooltipEl.style.top = rect.bottom + 4 + 'px';

  // Keep tooltip on screen
  requestAnimationFrame(() => {
    const tr = _tooltipEl.getBoundingClientRect();
    if (tr.right > window.innerWidth - 8) {
      _tooltipEl.style.left = window.innerWidth - tr.width - 8 + 'px';
    }
    if (tr.bottom > window.innerHeight - 8) {
      _tooltipEl.style.top = rect.top - tr.height - 4 + 'px';
    }
  });
}

export function hideFeatureTooltip() {
  if (_tooltipEl) _tooltipEl.classList.remove('show');
}

// ── Ghost cards for stories split across PIs ─────────────────
export function injectGhostCards() {
  const leafTypes = new Set(['story', 'spike', 'bug']);

  // Find stories whose PI (fixVersion) differs from their parent epic's PI
  const crossPiStories = allDocs.filter((d) => {
    if (!leafTypes.has(d.docType) || !d.parentFilename || !d.fixVersion) return false;
    const parent = allDocs.find((p) => p.filename === d.parentFilename);
    return parent && parent.fixVersion && parent.fixVersion !== d.fixVersion;
  });

  for (const story of crossPiStories) {
    const parent = allDocs.find((p) => p.filename === story.parentFilename);
    if (!parent || !parent.fixVersion) continue;

    // Find the first rendered sprint column belonging to the parent's PI
    const parentSprints =
      (typeof sprintConfig !== 'undefined' && sprintConfig[parent.fixVersion]) || [];
    let targetList = null;
    for (const s of parentSprints) {
      targetList = document.querySelector(
        `.roadmap-card-list[data-sprint="${CSS.escape(s.name)}"]`
      );
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
