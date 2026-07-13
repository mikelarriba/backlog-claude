// ── List rendering: rank helpers, swimlane rendering, readiness, dep connectors ─
import { escHtml, buildChildrenMap, TYPE_LABEL, STATUS_LABEL } from './state.js';
// ── Rank helpers ──────────────────────────────────────────────
// Map<filename, {index, total}> — position of each doc in its per-type rank order.
const _rankPositions = new Map();
export function _rankSortFn(a, b) {
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  if (a.rank !== null) return -1;
  if (b.rank !== null) return 1;
  return b.filename.localeCompare(a.filename); // default: date-desc
}
export function computeRankPositions(docs) {
  _rankPositions.clear();
  const byType = {};
  for (const d of docs) {
    if (!byType[d.docType]) byType[d.docType] = [];
    byType[d.docType].push(d);
  }
  for (const group of Object.values(byType)) {
    const sorted = [...group].sort(_rankSortFn);
    sorted.forEach((d, i) => _rankPositions.set(d.filename, { index: i, total: sorted.length }));
  }
  return _rankPositions;
}
export function buildTreeOrder(docs, collapsed = _collapsedItems) {
  const key = (d) => `${d.docType}:${d.filename}`;
  const byFilename = new Map(docs.map((d) => [d.filename, d]));
  const childrenMap = buildChildrenMap(docs);
  const ordered = [];
  const placed = new Set();
  function place(doc, indent) {
    if (placed.has(key(doc))) return;
    placed.add(key(doc));
    ordered.push({ doc, indent });
    if (collapsed.has(doc.filename)) return; // skip children when collapsed
    const children = childrenMap.get(doc.filename) || [];
    children.forEach((child) => place(child, indent + 1));
  }
  docs.forEach((d) => {
    if (!d.parentFilename || !byFilename.has(d.parentFilename)) place(d, 0);
  });
  // Safety pass: only place truly orphaned docs (parent not in this swimlane).
  // Do NOT place children of collapsed parents — they should stay hidden.
  docs.forEach((d) => {
    if (!placed.has(key(d)) && (!d.parentFilename || !byFilename.has(d.parentFilename)))
      place(d, 0);
  });
  return { ordered, childrenMap };
}
// ── Swimlane rendering ────────────────────────────────────────
export function categorizeDocs(docs, pi = piSettings) {
  const currentPi = [];
  const nextPi = [];
  const backlog = [];
  for (const d of docs) {
    if (d.fixVersion && pi.currentPi && d.fixVersion === pi.currentPi) {
      currentPi.push(d);
    } else if (d.fixVersion && pi.nextPi && d.fixVersion === pi.nextPi) {
      nextPi.push(d);
    } else {
      backlog.push(d);
    }
  }
  return { currentPi, nextPi, backlog };
}
const WELCOME_DISMISSED_KEY = 'midas-welcomed';
export function dismissWelcomeBanner() {
  localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
  document.getElementById('welcome-banner')?.classList.add('hidden');
}
function updateWelcomeBanner() {
  const banner = document.getElementById('welcome-banner');
  if (!banner) return;
  const shouldShow = !allDocs.length && !localStorage.getItem(WELCOME_DISMISSED_KEY);
  banner.classList.toggle('hidden', !shouldShow);
}
export function renderSwimlanes(docs) {
  // Rebuild global readiness lookup tables from all docs (cross-section)
  _readinessAllDocsMap = new Map(allDocs.map((d) => [d.filename, d]));
  _readinessChildrenMap = buildChildrenMap(allDocs);
  const list = document.getElementById('epic-list');
  const count = document.getElementById('epic-count');
  count.textContent = String(docs.length);
  updateWelcomeBanner();
  if (!docs.length) {
    if (!allDocs.length) {
      list.innerHTML = `
        <div class="empty-state-v2">
          <div class="empty-icon">📋</div>
          <p class="empty-title">Your backlog is empty</p>
          <p class="empty-body">
            Start by creating your first Feature, Epic or Story using the + button in the
            bottom right, or import items from JIRA.
          </p>
          <div class="empty-actions">
            <button class="btn-primary" data-action="toggleFab">Create first item</button>
          </div>
        </div>`;
    } else {
      list.innerHTML = `
        <div class="empty-state">
          <div class="icon">📋</div>
          Nothing matches the current filters.
        </div>`;
    }
    return;
  }
  // Compute rank positions from the full unfiltered doc set so ↑/↓ buttons
  // reflect global order rather than the currently filtered subset.
  computeRankPositions(allDocs);
  const { currentPi, nextPi, backlog } = categorizeDocs(docs);
  const html = [
    renderSwimlaneSectionHtml('currentPi', 'Current PI', piSettings.currentPi, currentPi),
    renderSwimlaneSectionHtml('nextPi', 'Next PI', piSettings.nextPi, nextPi),
    renderSwimlaneSectionHtml('backlog', 'Backlog', null, backlog),
  ].join('');
  list.innerHTML = html;
  applyDepCascade();
  attachDepHoverListeners();
}
export function renderSwimlaneSectionHtml(sectionKey, label, versionName, docs) {
  const collapsed = _swimlanesCollapsed[sectionKey];
  const chevron = collapsed ? '▶' : '▼';
  const bodyClass = collapsed ? 'swimlane-body collapsed' : 'swimlane-body';
  // Version selector for Current/Next PI
  let versionSelector = '';
  if (sectionKey !== 'backlog') {
    const versions = jiraVersions;
    const options = versions
      .map(
        (v) =>
          `<option value="${escHtml(v.name)}" ${v.name === versionName ? 'selected' : ''}>${escHtml(v.name)}${v.released ? ' (released)' : ''}</option>`
      )
      .join('');
    versionSelector = `
      <select class="swimlane-version-select"
              data-section="${sectionKey}"
              onchange="updatePiVersion('${sectionKey}', this.value)"
              onclick="event.stopPropagation()">
        <option value="">— Select version —</option>
        ${options}
      </select>`;
  }
  const versionDisplay = versionName
    ? `<span class="swimlane-version-name">${escHtml(versionName)}</span>`
    : '';
  const countBadge = `<span class="swimlane-count">${docs.length}</span>`;
  // Capacity summary + distribute button for PI swimlanes with sprint config
  let capacitySummary = '';
  let distributeBtn = '';
  const sprintConfigMap = sprintConfig;
  if (versionName && sprintConfigMap[versionName] && sprintConfigMap[versionName].length) {
    const sprints = sprintConfigMap[versionName];
    const totalCapacity = sprints.reduce((sum, s) => sum + s.capacity, 0);
    const assignedSP = docs.reduce((sum, d) => sum + (Number(d.storyPoints) || 0), 0);
    const pct = totalCapacity > 0 ? Math.round((assignedSP / totalCapacity) * 100) : 0;
    const overClass = pct > 100 ? ' over' : '';
    capacitySummary = `<span class="swimlane-capacity${overClass}">${assignedSP} / ${totalCapacity} SP (${pct}%)</span>`;
    distributeBtn = `<button class="btn-distribute" onclick="event.stopPropagation(); openDistributionModal('${escHtml(versionName)}')" title="Auto-distribute stories into sprints">Distribute</button>`;
  }
  // Render items — sort by rank (nulls last) within each swimlane section
  const { ordered, childrenMap } = buildTreeOrder([...docs].sort(_rankSortFn));
  const itemsHtml = ordered.length
    ? ordered.map(({ doc: d, indent }) => renderDocItem(d, indent, childrenMap)).join('')
    : `<div class="swimlane-empty">No issues in this section</div>`;
  return `
    <div class="swimlane-section" data-section="${sectionKey}">
      <div class="swimlane-header" onclick="toggleSwimlane('${sectionKey}')">
        <span class="swimlane-chevron">${chevron}</span>
        <span class="swimlane-label">${label}</span>
        ${versionDisplay}
        ${countBadge}
        ${capacitySummary}
        <div class="swimlane-header-right">
          ${distributeBtn}
          ${versionSelector}
        </div>
      </div>
      <div class="${bodyClass}">
        ${itemsHtml}
      </div>
    </div>`;
}
// ── Readiness helpers ─────────────────────────────────────────
let _readinessAllDocsMap = new Map();
let _readinessChildrenMap = new Map();
export function getAllLeaves(filename, childrenMap, docsMap) {
  const children = childrenMap.get(filename) || [];
  if (!children.length) {
    const doc = docsMap.get(filename);
    return doc ? [doc] : [];
  }
  return children.flatMap((c) => getAllLeaves(c.filename, childrenMap, docsMap));
}
export function computeReadiness(doc, childrenMap, docsMap) {
  const children = childrenMap.get(doc.filename) || [];
  const isLeaf = doc.docType === 'story' || doc.docType === 'spike' || doc.docType === 'bug';
  const scores = [];
  // 1. Has children (features/epics only)
  if (doc.docType === 'feature' || doc.docType === 'epic') {
    scores.push(children.length > 0 ? 1 : 0);
  }
  // 2. Story points coverage
  if (isLeaf) {
    scores.push(doc.storyPoints != null ? 1 : 0);
  } else {
    const leaves = getAllLeaves(doc.filename, childrenMap, docsMap);
    if (leaves.length > 0) {
      const withSP = leaves.filter((l) => l.storyPoints != null).length;
      scores.push(withSP / leaves.length);
    }
  }
  // 3. Has a proper description
  scores.push(doc.hasDescription ? 1 : 0);
  if (!scores.length) return 0;
  return (scores.reduce((a, b) => a + b, 0) / scores.length) * 100;
}
export function renderDocItem(d, indent, childrenMap) {
  const statusClass = (d.status || 'Draft').replace(/\s+/g, '-');
  // Connector shows when item has a parent in the current tree view
  const connector = indent > 0 ? `<span class="tree-connector">└</span>` : '';
  const hasChildren = childrenMap && (childrenMap.get(d.filename) || []).length > 0;
  const isCollapsible = hasChildren && (d.docType === 'feature' || d.docType === 'epic');
  const isCollapsed = _collapsedItems.has(d.filename);
  const collapseBtn = isCollapsible
    ? `<button class="collapse-btn${isCollapsed ? ' is-collapsed' : ''}"
               onclick="toggleItemCollapse('${escHtml(d.filename)}', event)"
               title="${isCollapsed ? 'Expand children' : 'Collapse children'}">
         <svg viewBox="0 0 10 10" width="10" height="10"><polyline points="2,3 5,7 8,3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
       </button>`
    : '<div class="collapse-spacer"></div>';
  // Readiness traffic light
  const pct = computeReadiness(d, _readinessChildrenMap, _readinessAllDocsMap);
  const rdCls = pct >= 80 ? 'ready-green' : pct >= 40 ? 'ready-amber' : 'ready-red';
  const rdTip = `Readiness: ${Math.round(pct)}%`;
  const selKey = `${d.docType}:${d.filename}`;
  const multiSel = selectedItems.has(selKey) ? ' multi-selected' : '';
  // Dependency badges (leaf types only)
  const isLeaf = ['story', 'spike', 'bug'].includes(d.docType);
  const blocksCnt = isLeaf ? (d.blocks || []).length : 0;
  const blockedByCnt = isLeaf ? (d.blockedBy || []).length : 0;
  const parallelCnt = isLeaf ? (d.parallel || []).length : 0;
  const depBadges = [
    blocksCnt
      ? `<span class="dep-badge dep-badge-blocks" title="Blocks ${blocksCnt} stor${blocksCnt !== 1 ? 'ies' : 'y'}">→ ${blocksCnt}</span>`
      : '',
    blockedByCnt
      ? `<span class="dep-badge dep-badge-blocked" title="Blocked by ${blockedByCnt} stor${blockedByCnt !== 1 ? 'ies' : 'y'}">🔒 ${blockedByCnt}</span>`
      : '',
    parallelCnt
      ? `<span class="dep-badge dep-badge-parallel" title="Parallel with ${parallelCnt} stor${parallelCnt !== 1 ? 'ies' : 'y'}"># ${parallelCnt}</span>`
      : '',
  ].join('');
  const teamSlug = d.team ? d.team.toLowerCase().replace(/\s+/g, '-') : null;
  const workCatSlug = d.workCategory ? d.workCategory.toLowerCase().replace(/\s+/g, '-') : null;
  const teamBadge = teamSlug
    ? `<span class="team-badge team-badge--${teamSlug}">${escHtml(d.team)}</span>`
    : '';
  const workCatBadge = workCatSlug
    ? `<span class="work-cat-badge work-cat-badge--${workCatSlug}">${escHtml(d.workCategory)}</span>`
    : '';
  const spVal = d.storyPoints;
  const spBadge =
    spVal != null && spVal !== 'TBD' && String(spVal).trim() !== ''
      ? `<span class="sp-badge" title="Story Points">${escHtml(String(spVal))} SP</span>`
      : '';
  return `
    <div class="epic-item${multiSel}"
         data-filename="${escHtml(d.filename)}"
         data-doctype="${d.docType}"
         data-indent="${indent}"
         onclick="handleItemClick(event,'${escHtml(d.filename)}','${d.docType}')"
         oncontextmenu="handleItemContextMenu(event,'${escHtml(d.filename)}','${d.docType}')">
      <div class="drag-handle" title="Drag to reorder or link"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      <div class="readiness-dot ${rdCls}" title="${rdTip}"></div>
      ${collapseBtn}
      ${connector}
      <span class="type-badge ${d.docType}">${TYPE_LABEL[d.docType] || d.docType}</span>
      <div style="flex:1;min-width:0">
        <div class="epic-title-text">${escHtml(d.title)}</div>
      </div>
      ${depBadges}
      ${teamBadge}
      ${workCatBadge}
      ${spBadge}
      ${d.sprint ? `<span class="sprint-badge">${escHtml(d.sprint)}</span>` : ''}
      <span class="status-badge ${statusClass}">${STATUS_LABEL[d.status] || d.status || 'Draft'}</span>
      <div class="epic-date">${d.date}</div>
    </div>`;
}
// ── Cascade indent (post-render) ─────────────────────────────
export function applyDepCascade() {
  const MAX_DEPTH = 5;
  const INDENT_PX = 28;
  // Clear any previous cascade styles
  document.querySelectorAll('#epic-list .epic-item[data-dep-level]').forEach((el) => {
    el.style.marginLeft = '';
    el.removeAttribute('data-dep-level');
    el.classList.remove('dep-cascade');
  });
  const docsMap = new Map(allDocs.map((d) => [d.filename, d]));
  // Collect items in DOM order grouped by parentFilename
  const groups = new Map(); // parentFn → [{el, doc}]
  document.querySelectorAll('#epic-list .epic-item[data-filename]').forEach((el) => {
    const doc = docsMap.get(el.dataset.filename);
    if (!doc) return;
    const key = doc.parentFilename || '__none__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ el, doc });
  });
  for (const siblings of groups.values()) {
    const inGroup = new Set(siblings.map((s) => s.doc.filename));
    const visualDepth = new Map(); // filename → computed visual depth
    let runningMax = 0;
    // Single forward pass: blockers always appear before blocked items
    // in rank order, so we can use their already-computed visual depth.
    for (const { el, doc } of siblings) {
      let ownDepth = 0;
      for (const blockerFn of doc.blockedBy || []) {
        if (inGroup.has(blockerFn)) {
          ownDepth = Math.max(ownDepth, (visualDepth.get(blockerFn) || 0) + 1);
        }
      }
      const effectiveDepth = Math.min(Math.max(ownDepth, runningMax), MAX_DEPTH);
      visualDepth.set(doc.filename, effectiveDepth);
      runningMax = effectiveDepth;
      if (effectiveDepth > 0) {
        el.setAttribute('data-dep-level', String(effectiveDepth));
        el.style.marginLeft = `${effectiveDepth * INDENT_PX}px`;
        el.classList.add('dep-cascade');
      }
    }
  }
}
// ── Dependency connector lines ────────────────────────────────
let _depHighlightedEls = [];
/** Find the first visible element matching data-filename (handles hidden views). */
function _findVisibleDepEl(filename) {
  const els = document.querySelectorAll(`[data-filename="${CSS.escape(filename)}"]`);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return el;
  }
  return null;
}
export function hideDepConnectors() {
  const svg = document.getElementById('dep-connector-svg');
  if (svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }
  _depHighlightedEls.forEach((el) => el.classList.remove('dep-hover-highlight'));
  _depHighlightedEls = [];
}
export function showDepConnectors(filename) {
  hideDepConnectors();
  const doc = allDocs.find((d) => d.filename === filename);
  if (!doc) return;
  const svg = document.getElementById('dep-connector-svg');
  if (!svg) return;
  // Build pairs: blocker → blocked (sequential) and parallel
  const pairs = [];
  for (const blockedFn of doc.blocks || []) {
    pairs.push({ blockerFn: filename, blockedFn, isParallel: false });
  }
  for (const blockerFn of doc.blockedBy || []) {
    pairs.push({ blockerFn, blockedFn: filename, isParallel: false });
  }
  for (const parallelFn of doc.parallel || []) {
    pairs.push({ blockerFn: filename, blockedFn: parallelFn, isParallel: true });
  }
  for (const { blockerFn, blockedFn, isParallel } of pairs) {
    const blockerEl = _findVisibleDepEl(blockerFn);
    const blockedEl = _findVisibleDepEl(blockedFn);
    if (!blockerEl || !blockedEl) continue;
    blockerEl.classList.add('dep-hover-highlight');
    blockedEl.classList.add('dep-hover-highlight');
    _depHighlightedEls.push(blockerEl, blockedEl);
    // Anchor at the readiness-dot (left side) of each item
    const dot1 = blockerEl.querySelector('.readiness-dot');
    const dot2 = blockedEl.querySelector('.readiness-dot');
    if (!dot1 || !dot2) continue;
    const r1 = dot1.getBoundingClientRect();
    const r2 = dot2.getBoundingClientRect();
    const x1 = r1.left + r1.width / 2;
    const y1 = r1.top + r1.height / 2;
    const x2 = r2.left + r2.width / 2;
    const y2 = r2.top + r2.height / 2;
    // Draw a left-side bracket: go left, down, then right
    const offset = 14;
    const xMid = Math.min(x1, x2) - offset;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} H${xMid} V${y2} H${x2}`);
    path.setAttribute(
      'class',
      isParallel ? 'dep-connector-line dep-connector-line--parallel' : 'dep-connector-line'
    );
    svg.appendChild(path);
  }
}
export function attachDepHoverListeners() {
  document.querySelectorAll('#epic-list .epic-item[data-filename]').forEach((el) => {
    const doc = allDocs.find((d) => d.filename === el.dataset.filename);
    if (!doc) return;
    if (!(doc.blocks || []).length && !(doc.blockedBy || []).length && !(doc.parallel || []).length)
      return;
    el.addEventListener('mouseenter', () => showDepConnectors(doc.filename));
    el.addEventListener('mouseleave', hideDepConnectors);
  });
}
//# sourceMappingURL=list-render.js.map
