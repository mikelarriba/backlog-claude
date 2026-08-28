// ── Roadmap rendering helpers and render functions ─────────────
import { escHtml, TYPE_LABEL } from './state.js';
import { applyEpicFocus, getAllSprints, openDepModal } from './roadmap.js';
import { initRoadmapDragDrop, attachRoadmapDepHoverListeners } from './roadmap-drag.js';
import {
  syncRoadmapSelectionUI,
  handleRoadmapEpicClick,
  handleRoadmapCardClick,
} from './roadmap-select.js';
import { registerActions } from './actions.js';
// Typed data-action names for the epic-row click, story-card click,
// dependency-modal button, and cross-PI ghost card in this module's render
// functions (issue #461 migration — see actions.ts and piconfig.ts's
// PICONFIG_ACTIONS for the established pattern). Replaces
// onclick="handleRoadmapEpicClick(...)" / onclick="handleRoadmapCardClick(...)" /
// onclick="event.stopPropagation();openDepModal(...)" /
// onclick="openDoc(...)" strings previously built by hand. Note:
// openDepModal was never reachable through the old onclick string at
// runtime — it was never added to main.ts's window bridge (_dynGlobals),
// so the dependency-manage button (⛓) has been silently broken (a
// ReferenceError on click); this migration fixes that as a side effect of
// routing it through the typed dispatcher instead.
//
// openDoc itself is intentionally referenced as the ambient global declared
// in global.d.ts (var openDoc: ...) rather than imported from detail.ts —
// same treatment detail-links.ts already gives it (see that file's
// DETAIL_LINKS_ACTIONS.openDoc), to avoid pulling detail.ts's much heavier
// dependency graph (main.ts and friends) into this render module. This was
// the last remaining onclick="openDoc(...)" site anywhere in public/ts/ —
// detail-links.ts's two former sites moved onto its own action map earlier
// — so openDoc no longer needs main.ts's window bridge at all.
export const ROADMAP_RENDER_ACTIONS = {
  epicClick: 'roadmapRenderEpicClick',
  cardClick: 'roadmapRenderCardClick',
  openDepModal: 'roadmapRenderOpenDepModal',
  ghostCardOpenDoc: 'roadmapRenderGhostCardOpenDoc',
  estCardOpenEpic: 'roadmapRenderEstCardOpenEpic',
};
registerActions({
  [ROADMAP_RENDER_ACTIONS.epicClick]: (el, e) => {
    const filename = el.dataset.filename;
    const docType = el.dataset.doctype;
    handleRoadmapEpicClick(e, filename, docType);
  },
  [ROADMAP_RENDER_ACTIONS.cardClick]: (el, e) => {
    const filename = el.dataset.filename;
    const docType = el.dataset.doctype;
    handleRoadmapCardClick(e, filename, docType);
  },
  [ROADMAP_RENDER_ACTIONS.openDepModal]: (el, e) => {
    e.stopPropagation();
    const filename = el.dataset.filename;
    const docType = el.dataset.doctype;
    void openDepModal(filename, docType);
  },
  [ROADMAP_RENDER_ACTIONS.ghostCardOpenDoc]: (el) => {
    openDoc(el.dataset.filename ?? '', el.dataset.doctype ?? '');
  },
  [ROADMAP_RENDER_ACTIONS.estCardOpenEpic]: (el) => {
    openDoc(el.dataset.estEpic ?? '', 'epic');
  },
});
// ── Story-point card heights (Fibonacci scale) ────────────────
const SP_HEIGHTS = {
  0: 56,
  1: 64,
  2: 72,
  3: 80,
  5: 96,
  8: 112,
  13: 132,
  21: 160,
};
export function spCardHeight(sp) {
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
// Category-based colours for epic cards
const _CATEGORY_COLORS = {
  'User Features': '#16a34a',
  'Platform Features': '#0891b2',
  'Testing Features': '#d97706',
  'Platform Maintenance': '#64748b',
  'Technical Debt': '#dc2626',
};
const _CATEGORY_FALLBACK = '#94a3b8';
export function epicColor(workCategory) {
  return (workCategory && _CATEGORY_COLORS[workCategory]) || _CATEGORY_FALLBACK;
}
// Pure: maps each column identifier (sprint name, or '' for Unassigned) to the
// placeholder cards it should show. `knownSprintNames` are the sprint columns
// currently rendered — placements pointing at a hidden PI's sprint are simply
// not drawn. Split out so it's unit-testable without a DOM or the allDocs global.
export function buildEstPlaceholders(epics, knownSprintNames) {
  const map = new Map();
  const push = (key, p) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  };
  for (const epic of epics) {
    const size = epic.estimatedSprintSize || 0;
    if (size < 1) continue;
    const color = epicColor(epic.workCategory);
    const placements = epic.estimatedSprints || [];
    for (const s of placements) {
      if (!knownSprintNames.has(s)) continue;
      push(s, { epicFilename: epic.filename, epicTitle: epic.title, color, fromSprint: s });
    }
    // Remaining placeholders (size minus every saved placement) sit unassigned.
    const remaining = Math.max(0, size - placements.length);
    for (let i = 0; i < remaining; i++) {
      push('', { epicFilename: epic.filename, epicTitle: epic.title, color, fromSprint: '' });
    }
  }
  return map;
}
export function buildEstPlaceholderCardHtml(p) {
  return `
    <div class="rm-est-card" draggable="true"
         role="button" tabindex="0"
         data-action="${ROADMAP_RENDER_ACTIONS.estCardOpenEpic}"
         oncontextmenu="handleEstCardContextMenu(event,'${escHtml(p.epicFilename)}','${escHtml(p.fromSprint)}')"
         data-est-epic="${escHtml(p.epicFilename)}"
         data-sprint="${escHtml(p.fromSprint)}"
         style="--rm-est-color:${p.color}"
         title="Estimated sprint for &quot;${escHtml(p.epicTitle)}&quot; — not yet refined. Drag, right-click, or use Left/Right arrow keys to plan the roadmap."
         aria-label="Estimated sprint for ${escHtml(p.epicTitle)}. Left or Right arrow keys move it to the adjacent sprint. Right-click for more options.">
      <div class="rm-est-card-parent">
        <span class="rm-parent-dot" style="background:${p.color}"></span>${escHtml(p.epicTitle)}
      </div>
      <div class="rm-est-card-label">≈ 1 sprint · estimate</div>
    </div>`;
}
// Pure: applies a single placeholder move to an epic's persisted placement
// multiset — removes one entry for `fromSprint` (a move out of Unassigned,
// fromSprint null, removes nothing), adds one for `toSprint` (a move to
// Unassigned, toSprint null, adds nothing) but never exceeds `size` placements.
// Shared by the drag path (roadmap-drag.ts) and the context menu
// (roadmap-context-menus.ts) so both mutate placements identically.
export function updateEstPlacements(placements, size, fromSprint, toSprint) {
  const next = [...placements];
  if (fromSprint) {
    const idx = next.indexOf(fromSprint);
    if (idx !== -1) next.splice(idx, 1);
  }
  if (toSprint && next.length < size) next.push(toSprint);
  return next;
}
// Selects epics eligible for placeholder rendering: type epic, a set estimate,
// and either no PI yet or a currently-visible PI. Kept here (not pure) so both
// renderStoryPanel and patchStoryColumn build the same set the same way.
export function visibleEstimateEpics() {
  return allDocs.filter(
    (d) =>
      d.docType === 'epic' &&
      (d.estimatedSprintSize || 0) >= 1 &&
      (!d.fixVersion || _roadmapVisiblePis.has(d.fixVersion))
  );
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
  document.getElementById('rm-count-epics').textContent = String(sorted.length);
  if (!sorted.length) {
    body.innerHTML = `
      <div class="empty-state-v2">
        <div class="empty-icon">🗓️</div>
        <p class="empty-title">No items assigned to sprints yet</p>
        <p class="empty-body">
          Add stories to sprints from the Backlog or Detail view to see them appear here.
        </p>
      </div>`;
    return;
  }
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
    const color = isNone ? 'var(--muted)' : epicColor(epicDoc?.workCategory);
    const fn = epicDoc?.filename || '';
    const snippet = epicDoc?.descriptionSnippet || '';
    // Compute sprint span — union of story-derived sprints and, for unrefined
    // epics, their estimated-sprint placements so the bar reflects the estimate.
    const estSprints = (epicDoc?.estimatedSprints || []).filter((s) => sprintIdx.has(s));
    const spanSprints = new Set([...sprintSet, ...estSprints]);
    const indices = [...spanSprints].filter((s) => sprintIdx.has(s)).map((s) => sprintIdx.get(s));
    const minIdx = indices.length ? Math.min(...indices) : -1;
    const maxIdx = indices.length ? Math.max(...indices) : -1;
    // A bar built purely from the estimate (no refined stories yet) is drawn
    // in a lighter, dashed style to read as "estimated, not committed".
    const isEstBar = storyCount === 0 && !!epicDoc?.estimatedSprintSize;
    // Bar geometry
    let barHtml = '';
    if (minIdx >= 0) {
      const leftPct = ((minIdx / N) * 100).toFixed(2);
      const widthPct = (((maxIdx - minIdx + 1) / N) * 100).toFixed(2);
      barHtml = `<div class="rm-epic-bar${isEstBar ? ' rm-epic-bar-est' : ''}" style="left:${leftPct}%;width:${widthPct}%;background:${color};"></div>`;
    }
    // Grid cells (vertical lines)
    const cells = sprints.map(() => '<div class="rm-grid-cell"></div>').join('');
    const estSize = epicDoc?.estimatedSprintSize || 0;
    const meta =
      storyCount === 0 && estSize
        ? `~${estSize} sprint${estSize !== 1 ? 's' : ''} · estimate`
        : `${storyCount} stor${storyCount !== 1 ? 'ies' : 'y'} · ${totalSP} SP`;
    // Tooltip data attributes for hover popup
    const tooltipAttrs = snippet
      ? ` data-tooltip-title="${escHtml(title)}" data-tooltip-desc="${escHtml(snippet)}"`
      : ` data-tooltip-title="${escHtml(title)}"`;
    const epicDocType = epicDoc?.docType || 'epic';
    rowsHtml += `
      <div class="rm-epic-card${isNone ? ' rm-epic-unlinked' : ''}"
           data-filename="${escHtml(fn || '__none__')}" data-doctype="${epicDocType}"${tooltipAttrs}
           ${fn || isNone ? `data-action="${ROADMAP_RENDER_ACTIONS.epicClick}"` : ''}
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
  document.getElementById('rm-count-stories').textContent = String(piDocs.length);
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
  // Estimated-sprint placeholder cards for unrefined epics (keyed by column)
  const knownSprintNames = new Set(sprints.map((s) => s.name));
  const placeholderMap = buildEstPlaceholders(visibleEstimateEpics(), knownSprintNames);
  // Render columns (same sprint order as epic panel)
  let html = '';
  for (const s of sprints) {
    const docs = grouped.get(s.name) || [];
    html += renderStoryColumn(s.name, docs, s.capacity, placeholderMap.get(s.name) || []);
  }
  // Unassigned
  html += renderStoryColumn(null, unassigned, 0, placeholderMap.get('') || []);
  body.innerHTML = `<div class="rm-story-columns">${html}</div>`;
  initRoadmapDragDrop();
}
export function renderStoryColumn(sprintName, docs, capacity, placeholders = []) {
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
  const realCardsHtml = sortedDocs.map((d) => renderRoadmapCard(d, sprintName)).join('');
  const estCardsHtml = placeholders.map(buildEstPlaceholderCardHtml).join('');
  const cardsHtml =
    realCardsHtml + estCardsHtml || '<div class="roadmap-card-empty">No items</div>';
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
// ── Single-column patch path (perf) ───────────────────────────
// Patches just one story column's existing DOM node instead of rebuilding
// the whole board on every rerank/cross-sprint drag drop — mirrors the
// single-document patch path used by the backlog list (patchSingleDoc).
// Falls back to a full renderRoadmapBoard() if the column isn't currently
// rendered (e.g. it doesn't exist yet), so callers always end up consistent.
export function patchStoryColumn(sprintName) {
  const sprints = getAllSprints();
  const leafTypes = new Set(['story', 'spike', 'bug']);
  const piDocs = allDocs.filter(
    (d) => leafTypes.has(d.docType) && d.fixVersion && _roadmapVisiblePis.has(d.fixVersion)
  );
  const knownSprintNames = new Set(sprints.map((s) => s.name));
  const docs = sprintName
    ? piDocs.filter((d) => d.sprint === sprintName)
    : piDocs.filter((d) => !d.sprint || !knownSprintNames.has(d.sprint));
  const capacity = sprintName ? (sprints.find((s) => s.name === sprintName)?.capacity ?? 0) : 0;
  const selector = `.roadmap-column[data-sprint="${sprintName ? CSS.escape(sprintName) : ''}"]`;
  const existing = document.querySelector(selector);
  if (!existing) {
    renderRoadmapBoard();
    return;
  }
  const placeholders =
    buildEstPlaceholders(visibleEstimateEpics(), knownSprintNames).get(sprintName ?? '') || [];
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderStoryColumn(sprintName, docs, capacity, placeholders).trim();
  const newEl = wrapper.firstElementChild;
  if (!newEl) {
    renderRoadmapBoard();
    return;
  }
  existing.replaceWith(newEl);
  initRoadmapDragDrop(newEl);
  injectGhostCards();
  applyEpicFocus();
  syncRoadmapSelectionUI();
  attachRoadmapDepHoverListeners();
}
// Pure: builds the roadmap card's HTML given the doc and its already-resolved
// parent epic/feature (or undefined if it has none / the parent wasn't
// found), instead of looking the parent up via the `allDocs` global itself —
// split out so this is testable without a DOM or global doc list (#460).
// `renderRoadmapCard` below does the `allDocs` lookup and delegates here.
export function buildRoadmapCardHtml(d, parent) {
  const priorityClass = (d.priority || 'Medium').replace(/\s+/g, '-').toLowerCase();
  const sp = Number(d.storyPoints) || 0;
  const spLabel = sp ? `${sp} SP` : 'No SP';
  const spClass = sp ? 'rm-badge rm-sp' : 'rm-badge rm-no-sp';
  const cardHeight = spCardHeight(sp);
  const parentFn = d.parentFilename || '';
  let parentHtml = '';
  if (parent) {
    const color = epicColor(parent.workCategory);
    parentHtml = `<div class="roadmap-card-parent"><span class="rm-parent-dot" style="background:${color}"></span>${escHtml(parent.title)}</div>`;
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
         data-action="${ROADMAP_RENDER_ACTIONS.cardClick}"
         oncontextmenu="handleStoryContextMenu(event,'${escHtml(d.filename)}','${d.docType}')"
         data-filename="${escHtml(d.filename)}"
         data-doctype="${d.docType}"
         data-sp="${sp}"
         data-parent="${escHtml(parentFn)}"
         data-sprint="${d.sprint ? escHtml(d.sprint) : ''}"
         style="min-height:${cardHeight}px">
      <div class="rm-reorder-handle" role="button" tabindex="0"
           title="Use arrow keys to reorder or move sprint"
           aria-label="Reorder ${escHtml(d.title)}. Up or Down arrow keys move it within this sprint; Home or End move it to the top or bottom of this sprint; Left or Right move it to the adjacent sprint."
           onclick="event.stopPropagation()"
           ><span></span><span></span><span></span><span></span><span></span><span></span></div>
      ${parentHtml}
      <div class="roadmap-card-title">${escHtml(d.title)}</div>
      ${depHtml}
      <div class="roadmap-card-meta">
        <span class="rm-badge rm-type-${d.docType}">${TYPE_LABEL[d.docType] || d.docType}</span>
        <span class="rm-badge rm-priority-${priorityClass}">${escHtml(d.priority || 'Medium')}</span>
        <span class="${spClass}">${spLabel}</span>
      </div>
      <button class="rm-dep-btn" title="Manage dependencies (blocks / blocked by)"
              data-action="${ROADMAP_RENDER_ACTIONS.openDepModal}"
              data-filename="${escHtml(d.filename)}" data-doctype="${d.docType}">⛓</button>
    </div>`;
}
export function renderRoadmapCard(d, _sprintName) {
  const parentFn = d.parentFilename || '';
  const parent = parentFn ? allDocs.find((p) => p.filename === parentFn) : undefined;
  return buildRoadmapCardHtml(d, parent);
}
// ── Feature tooltip popup ────────────────────────────────────
let _tooltipEl = null;
export function showFeatureTooltip(e) {
  const card = e.currentTarget;
  const title = card.dataset['tooltipTitle'] || '';
  const desc = card.dataset['tooltipDesc'] || '';
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
    const parentSprints = sprintConfig[parent.fixVersion] || [];
    let targetList = null;
    for (const s of parentSprints) {
      targetList = document.querySelector(
        `.roadmap-card-list[data-sprint="${CSS.escape(s.name)}"]`
      );
      if (targetList) break;
    }
    if (!targetList) continue;
    const color = epicColor(parent.workCategory);
    const ghostHtml = `
      <div class="roadmap-card ghost-card"
           data-action="${ROADMAP_RENDER_ACTIONS.ghostCardOpenDoc}"
           data-filename="${escHtml(story.filename)}"
           data-doctype="${story.docType}"
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
//# sourceMappingURL=roadmap-render.js.map
