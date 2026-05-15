// ── Doc list ───────────────────────────────────────────────────

// PI settings state
var piSettings    = { currentPi: null, nextPi: null };
var jiraVersions  = [];
var _swimlanesCollapsed = { currentPi: false, nextPi: false, backlog: false };
var _collapsedItems = new Set(); // filenames of collapsed epics/features

// ── Rank helpers ──────────────────────────────────────────────
// Map<filename, {index, total}> — position of each doc in its per-type rank order.
var _rankPositions = new Map();

function _rankSortFn(a, b) {
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  if (a.rank !== null) return -1;
  if (b.rank !== null) return 1;
  return b.filename.localeCompare(a.filename); // default: date-desc
}

function computeRankPositions(docs) {
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
}

async function moveDocRank(filename, docType, delta) {
  const group  = allDocs.filter(d => d.docType === docType);
  const sorted = [...group].sort(_rankSortFn);
  const idx    = sorted.findIndex(d => d.filename === filename);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= sorted.length) return;

  // Swap the two items in the ordered list
  [sorted[idx], sorted[newIdx]] = [sorted[newIdx], sorted[idx]];

  try {
    await postJSON('/api/docs/rerank', { type: docType, orderedFilenames: sorted.map(d => d.filename) });
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

async function loadDocs() {
  try {
    allDocs = await fetchJSON('/api/docs');
    applyFilters();
  } catch (e) {
    console.warn('Could not load docs:', e.message);
  }
}

async function loadPiSettings() {
  try {
    piSettings = await fetchJSON('/api/settings/pi');
  } catch (e) { console.warn('Failed to load PI settings:', e.message); }
}

async function loadJiraVersions() {
  try {
    const data = await fetchJSON('/api/jira/versions');
    jiraVersions = data.versions || [];
  } catch {
    jiraVersions = [];
  }
}

function buildTreeOrder(docs) {
  const key        = d => `${d.docType}:${d.filename}`;
  const byFilename = new Map(docs.map(d => [d.filename, d]));
  const childrenMap = buildChildrenMap(docs);
  const ordered    = [];
  const placed     = new Set();

  function place(doc, indent) {
    if (placed.has(key(doc))) return;
    placed.add(key(doc));
    ordered.push({ doc, indent });
    if (_collapsedItems.has(doc.filename)) return; // skip children when collapsed
    const children = childrenMap.get(doc.filename) || [];
    children.forEach(child => place(child, indent + 1));
  }

  docs.forEach(d => {
    if (!d.parentFilename || !byFilename.has(d.parentFilename)) place(d, 0);
  });
  // Safety pass: only place truly orphaned docs (parent not in this swimlane).
  // Do NOT place children of collapsed parents — they should stay hidden.
  docs.forEach(d => {
    if (!placed.has(key(d)) && (!d.parentFilename || !byFilename.has(d.parentFilename))) place(d, 0);
  });

  return { ordered, childrenMap };
}

// ── Swimlane rendering ────────────────────────────────────────
function categorizeDocs(docs) {
  const currentPi = [];
  const nextPi    = [];
  const backlog   = [];

  for (const d of docs) {
    if (d.fixVersion && piSettings.currentPi && d.fixVersion === piSettings.currentPi) {
      currentPi.push(d);
    } else if (d.fixVersion && piSettings.nextPi && d.fixVersion === piSettings.nextPi) {
      nextPi.push(d);
    } else {
      backlog.push(d);
    }
  }
  return { currentPi, nextPi, backlog };
}

function renderSwimlanes(docs) {
  // Rebuild global readiness lookup tables from all docs (cross-section)
  _readinessAllDocsMap  = new Map(allDocs.map(d => [d.filename, d]));
  _readinessChildrenMap = buildChildrenMap(allDocs);

  const list  = document.getElementById('epic-list');
  const count = document.getElementById('epic-count');
  count.textContent = docs.length;

  if (!docs.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        Nothing matches the current filters.
      </div>`;
    return;
  }

  // Compute rank positions from the full unfiltered doc set so ↑/↓ buttons
  // reflect global order rather than the currently filtered subset.
  computeRankPositions(allDocs);

  const { currentPi, nextPi, backlog } = categorizeDocs(docs);

  const html = [
    renderSwimlaneSectionHtml('currentPi', 'Current PI', piSettings.currentPi, currentPi),
    renderSwimlaneSectionHtml('nextPi',    'Next PI',    piSettings.nextPi,    nextPi),
    renderSwimlaneSectionHtml('backlog',   'Backlog',    null,                 backlog),
  ].join('');

  list.innerHTML = html;
  applyDepCascade();
  attachDepHoverListeners();
}

function renderSwimlaneSectionHtml(sectionKey, label, versionName, docs) {
  const collapsed = _swimlanesCollapsed[sectionKey];
  const chevron   = collapsed ? '▶' : '▼';
  const bodyClass = collapsed ? 'swimlane-body collapsed' : 'swimlane-body';

  // Version selector for Current/Next PI
  let versionSelector = '';
  if (sectionKey !== 'backlog') {
    const options = jiraVersions.map(v =>
      `<option value="${escHtml(v.name)}" ${v.name === versionName ? 'selected' : ''}>${escHtml(v.name)}${v.released ? ' (released)' : ''}</option>`
    ).join('');
    versionSelector = `
      <select class="swimlane-version-select"
              data-section="${sectionKey}"
              onchange="updatePiVersion('${sectionKey}', this.value)"
              onclick="event.stopPropagation()">
        <option value="">— Select version —</option>
        ${options}
      </select>`;
  }

  const versionDisplay = versionName ? `<span class="swimlane-version-name">${escHtml(versionName)}</span>` : '';
  const countBadge     = `<span class="swimlane-count">${docs.length}</span>`;

  // Capacity summary + distribute button for PI swimlanes with sprint config
  let capacitySummary = '';
  let distributeBtn = '';
  if (versionName && sprintConfig[versionName] && sprintConfig[versionName].length) {
    const sprints = sprintConfig[versionName];
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
var _readinessAllDocsMap    = new Map();
var _readinessChildrenMap   = new Map();

function getAllLeaves(filename, childrenMap, docsMap) {
  const children = childrenMap.get(filename) || [];
  if (!children.length) {
    const doc = docsMap.get(filename);
    return doc ? [doc] : [];
  }
  return children.flatMap(c => getAllLeaves(c.filename, childrenMap, docsMap));
}

function computeReadiness(doc, childrenMap, docsMap) {
  const children = childrenMap.get(doc.filename) || [];
  const isLeaf   = doc.docType === 'story' || doc.docType === 'spike' || doc.docType === 'bug';
  const scores   = [];

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
      const withSP = leaves.filter(l => l.storyPoints != null).length;
      scores.push(withSP / leaves.length);
    }
  }

  // 3. Has a proper description
  scores.push(doc.hasDescription ? 1 : 0);

  if (!scores.length) return 0;
  return (scores.reduce((a, b) => a + b, 0) / scores.length) * 100;
}

function renderDocItem(d, indent, childrenMap) {
  const statusClass = (d.status || 'Draft').replace(/\s+/g, '-');
  // Connector shows when item has a parent in the current tree view
  const connector   = indent > 0 ? `<span class="tree-connector">└</span>` : '';

  const hasChildren   = (childrenMap && (childrenMap.get(d.filename) || []).length > 0);
  const isCollapsible = hasChildren && (d.docType === 'feature' || d.docType === 'epic');
  const isCollapsed   = _collapsedItems.has(d.filename);
  const collapseBtn   = isCollapsible
    ? `<button class="collapse-btn${isCollapsed ? ' is-collapsed' : ''}"
               onclick="toggleItemCollapse('${escHtml(d.filename)}', event)"
               title="${isCollapsed ? 'Expand children' : 'Collapse children'}">
         <svg viewBox="0 0 10 10" width="10" height="10"><polyline points="2,3 5,7 8,3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
       </button>`
    : '<div class="collapse-spacer"></div>';

  // Readiness traffic light
  const pct    = computeReadiness(d, _readinessChildrenMap, _readinessAllDocsMap);
  const rdCls  = pct >= 80 ? 'ready-green' : pct >= 40 ? 'ready-amber' : 'ready-red';
  const rdTip  = `Readiness: ${Math.round(pct)}%`;

  const selKey  = `${d.docType}:${d.filename}`;
  const multiSel = selectedItems.has(selKey) ? ' multi-selected' : '';

  // Dependency badges (leaf types only)
  const isLeaf       = ['story', 'spike', 'bug'].includes(d.docType);
  const blocksCnt    = isLeaf ? (d.blocks    || []).length : 0;
  const blockedByCnt = isLeaf ? (d.blockedBy || []).length : 0;
  const depBadges = [
    blocksCnt    ? `<span class="dep-badge dep-badge-blocks" title="Blocks ${blocksCnt} stor${blocksCnt !== 1 ? 'ies' : 'y'}">→ ${blocksCnt}</span>` : '',
    blockedByCnt ? `<span class="dep-badge dep-badge-blocked" title="Blocked by ${blockedByCnt} stor${blockedByCnt !== 1 ? 'ies' : 'y'}">🔒 ${blockedByCnt}</span>` : '',
  ].join('');
  const teamSlug    = d.team        ? d.team.toLowerCase().replace(/\s+/g, '-')        : null;
  const workCatSlug = d.workCategory ? d.workCategory.toLowerCase().replace(/\s+/g, '-') : null;
  const teamBadge    = teamSlug    ? `<span class="team-badge team-badge--${teamSlug}">${escHtml(d.team)}</span>`               : '';
  const workCatBadge = workCatSlug ? `<span class="work-cat-badge work-cat-badge--${workCatSlug}">${escHtml(d.workCategory)}</span>` : '';

  const spVal = d.storyPoints;
  const spBadge = (spVal != null && spVal !== 'TBD' && String(spVal).trim() !== '')
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
/**
 * After the list is rendered, compute the dependency depth of each item
 * within its sibling group and apply incremental indentation (up to 5 levels).
 * Depth 0 = no blockedBy in the group, depth N = longest blocker chain.
 */
function applyDepCascade() {
  const MAX_DEPTH = 5;
  const INDENT_PX = 28;

  // Clear any previous cascade styles
  document.querySelectorAll('#epic-list .epic-item[data-dep-level]').forEach(el => {
    el.style.marginLeft = '';
    el.removeAttribute('data-dep-level');
    el.classList.remove('dep-cascade');
  });

  const docsMap = new Map(allDocs.map(d => [d.filename, d]));

  // Collect items in DOM order grouped by parentFilename
  const groups = new Map(); // parentFn → [{el, doc}]
  document.querySelectorAll('#epic-list .epic-item[data-filename]').forEach(el => {
    const doc = docsMap.get(el.dataset.filename);
    if (!doc) return;
    const key = doc.parentFilename || '__none__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ el, doc });
  });

  for (const siblings of groups.values()) {
    const inGroup = new Set(siblings.map(s => s.doc.filename));
    const visualDepth = new Map(); // filename → computed visual depth
    let runningMax = 0;

    // Single forward pass: blockers always appear before blocked items
    // in rank order, so we can use their already-computed visual depth.
    for (const { el, doc } of siblings) {
      let ownDepth = 0;
      for (const blockerFn of (doc.blockedBy || [])) {
        if (inGroup.has(blockerFn)) {
          ownDepth = Math.max(ownDepth, (visualDepth.get(blockerFn) || 0) + 1);
        }
      }
      const effectiveDepth = Math.min(Math.max(ownDepth, runningMax), MAX_DEPTH);
      visualDepth.set(doc.filename, effectiveDepth);
      runningMax = effectiveDepth;

      if (effectiveDepth > 0) {
        el.setAttribute('data-dep-level', effectiveDepth);
        el.style.marginLeft = `${effectiveDepth * INDENT_PX}px`;
        el.classList.add('dep-cascade');
      }
    }
  }
}

// ── Dependency connector lines ────────────────────────────────
var _depHighlightedEls = [];

/** Find the first visible element matching data-filename (handles hidden views). */
function _findVisibleDepEl(filename) {
  const els = document.querySelectorAll(`[data-filename="${CSS.escape(filename)}"]`);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return el;
  }
  return null;
}

function hideDepConnectors() {
  const svg = document.getElementById('dep-connector-svg');
  if (svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }
  _depHighlightedEls.forEach(el => el.classList.remove('dep-hover-highlight'));
  _depHighlightedEls = [];
}

function showDepConnectors(filename) {
  hideDepConnectors();
  const doc = allDocs.find(d => d.filename === filename);
  if (!doc) return;

  const svg = document.getElementById('dep-connector-svg');
  if (!svg) return;

  // Build pairs: blocker → blocked
  const pairs = [];
  for (const blockedFn of (doc.blocks || [])) {
    pairs.push({ blockerFn: filename, blockedFn });
  }
  for (const blockerFn of (doc.blockedBy || [])) {
    pairs.push({ blockerFn, blockedFn: filename });
  }

  for (const { blockerFn, blockedFn } of pairs) {
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
    path.setAttribute('class', 'dep-connector-line');
    svg.appendChild(path);
  }
}

function attachDepHoverListeners() {
  document.querySelectorAll('#epic-list .epic-item[data-filename]').forEach(el => {
    const doc = allDocs.find(d => d.filename === el.dataset.filename);
    if (!doc) return;
    if (!(doc.blocks || []).length && !(doc.blockedBy || []).length) return;
    el.addEventListener('mouseenter', () => showDepConnectors(doc.filename));
    el.addEventListener('mouseleave', hideDepConnectors);
  });
}

function toggleItemCollapse(filename, e) {
  e.stopPropagation();
  if (_collapsedItems.has(filename)) {
    _collapsedItems.delete(filename);
  } else {
    _collapsedItems.add(filename);
  }
  applyFilters();
}

function collapseAll() {
  const childrenMap = buildChildrenMap(allDocs);
  for (const d of allDocs) {
    if ((d.docType === 'feature' || d.docType === 'epic') && (childrenMap.get(d.filename) || []).length > 0) {
      _collapsedItems.add(d.filename);
    }
  }
  applyFilters();
}

function expandAll() {
  _collapsedItems.clear();
  applyFilters();
}

function toggleSwimlane(sectionKey) {
  _swimlanesCollapsed[sectionKey] = !_swimlanesCollapsed[sectionKey];
  const section = document.querySelector(`.swimlane-section[data-section="${sectionKey}"]`);
  if (!section) return;
  const body    = section.querySelector('.swimlane-body');
  const chevron = section.querySelector('.swimlane-chevron');
  if (_swimlanesCollapsed[sectionKey]) {
    body.classList.add('collapsed');
    chevron.textContent = '▶';
  } else {
    body.classList.remove('collapsed');
    chevron.textContent = '▼';
  }
}

async function updatePiVersion(sectionKey, versionName) {
  const update = { ...piSettings };
  if (sectionKey === 'currentPi') update.currentPi = versionName || null;
  if (sectionKey === 'nextPi')    update.nextPi    = versionName || null;

  try {
    await putJSON('/api/settings/pi', update);
    piSettings = update;
    applyFilters();
  } catch (e) {
    console.error('Failed to save PI settings:', e.message);
  }
}

// ── Filters ───────────────────────────────────────────────────
function setTypeFilter(type) {
  activeTypeFilter = type;
  document.querySelectorAll('[data-type]').forEach(el => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  applyFilters();
}

function setStatusFilter(status) {
  activeStatusFilter = status;
  document.querySelectorAll('[data-status]').forEach(el => {
    el.classList.toggle('active', el.dataset.status === status);
  });
  applyFilters();
}

function setTeamFilter(team) {
  activeTeamFilter = team;
  document.querySelectorAll('[data-team]').forEach(el => {
    el.classList.toggle('active', el.dataset.team === team);
  });
  applyFilters();
}

function setWorkCatFilter(cat) {
  activeWorkCatFilter = cat;
  document.querySelectorAll('[data-workcat]').forEach(el => {
    el.classList.toggle('active', el.dataset.workcat === cat);
  });
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById('search').value.toLowerCase();
  let filtered = allDocs;
  if (activeTypeFilter !== 'all')    filtered = filtered.filter(d => d.docType === activeTypeFilter);
  if (activeStatusFilter !== 'all')  filtered = filtered.filter(d => (d.status || 'Draft') === activeStatusFilter);
  if (activeTeamFilter !== 'all')    filtered = filtered.filter(d => d.team === activeTeamFilter);
  if (activeWorkCatFilter !== 'all') filtered = filtered.filter(d => d.workCategory === activeWorkCatFilter);
  if (q) filtered = filtered.filter(d => d.title.toLowerCase().includes(q) || d.filename.toLowerCase().includes(q));
  renderSwimlanes(filtered);
}

var applyFiltersDebounced = debounce(applyFilters, 200);

// ── Multi-select ─────────────────────────────────────────────
function itemKey(filename, docType) { return `${docType}:${filename}`; }

function getVisibleItems() {
  return Array.from(document.querySelectorAll('.epic-item')).map(el => ({
    filename: el.dataset.filename,
    docType:  el.dataset.doctype,
    el,
  }));
}

function clearSelection() {
  selectedItems.clear();
  _lastClickedItem = null;
  document.querySelectorAll('.epic-item.multi-selected').forEach(el => el.classList.remove('multi-selected'));
}

function syncSelectionUI() {
  document.querySelectorAll('.epic-item').forEach(el => {
    const key = itemKey(el.dataset.filename, el.dataset.doctype);
    el.classList.toggle('multi-selected', selectedItems.has(key));
  });
}

function handleItemClick(e, filename, docType) {
  if (_justDragged) return;

  // Clicks on collapse button are handled separately
  if (e.target.closest('.collapse-btn')) return;

  const key = itemKey(filename, docType);
  const isMeta = e.metaKey || e.ctrlKey;
  const isShift = e.shiftKey;

  if (isMeta) {
    // Cmd/Ctrl+Click: toggle individual item
    e.preventDefault();
    if (selectedItems.has(key)) {
      selectedItems.delete(key);
    } else {
      selectedItems.add(key);
    }
    _lastClickedItem = { filename, docType };
    syncSelectionUI();
    return;
  }

  if (isShift && _lastClickedItem) {
    // Shift+Click: range select
    e.preventDefault();
    const visible = getVisibleItems();
    const lastIdx = visible.findIndex(v => v.filename === _lastClickedItem.filename && v.docType === _lastClickedItem.docType);
    const curIdx  = visible.findIndex(v => v.filename === filename && v.docType === docType);
    if (lastIdx >= 0 && curIdx >= 0) {
      const start = Math.min(lastIdx, curIdx);
      const end   = Math.max(lastIdx, curIdx);
      for (let i = start; i <= end; i++) {
        selectedItems.add(itemKey(visible[i].filename, visible[i].docType));
      }
    }
    syncSelectionUI();
    return;
  }

  // Plain click: clear selection and open the doc
  if (selectedItems.size > 0) {
    clearSelection();
  }
  openDoc(filename, docType);
}

// ── Context menu ─────────────────────────────────────────────
function handleItemContextMenu(e, filename, docType) {
  e.preventDefault();

  const key = itemKey(filename, docType);

  // If right-clicking an unselected item, select only that item
  if (!selectedItems.has(key)) {
    clearSelection();
    selectedItems.add(key);
    _lastClickedItem = { filename, docType };
    syncSelectionUI();
  }

  showContextMenu(e.clientX, e.clientY);
}

function showContextMenu(x, y) {
  closeContextMenu();
  const count = selectedItems.size;
  if (!count) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'list-context-menu';

  // "Move to PI" submenu
  const piOptions = [];
  if (piSettings.currentPi) piOptions.push({ label: piSettings.currentPi, badge: 'Current', section: 'currentPi' });
  if (piSettings.nextPi)    piOptions.push({ label: piSettings.nextPi,    badge: 'Next',    section: 'nextPi' });
  piOptions.push({ label: 'Backlog (clear version)', badge: null, section: 'backlog' });

  const piItems = piOptions.map(opt => {
    const badge = opt.badge ? `<span class="ctx-badge">${escHtml(opt.badge)}</span>` : '';
    return `<button class="ctx-item" onclick="contextMoveToPI('${opt.section}')">
      ${badge}${escHtml(opt.label)}
    </button>`;
  }).join('');

  menu.innerHTML = `
    <div class="ctx-header">${count} item${count > 1 ? 's' : ''} selected</div>
    <div class="ctx-separator"></div>
    <div class="ctx-submenu-wrap">
      <button class="ctx-item ctx-has-sub">Move to PI →</button>
      <div class="ctx-submenu">${piItems}</div>
    </div>
    <div class="ctx-separator"></div>
    <button class="ctx-item ctx-danger" onclick="contextDeleteSelected()">Delete</button>
  `;

  document.body.appendChild(menu);

  // Position: ensure it stays within viewport
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth)  x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;

  // Close on outside click (next tick)
  setTimeout(() => {
    document.addEventListener('mousedown', _closeContextMenuHandler);
    document.addEventListener('contextmenu', _closeContextMenuOnRightClick);
  }, 0);
}

function _closeContextMenuHandler(e) {
  if (!e.target.closest('#list-context-menu')) closeContextMenu();
}
function _closeContextMenuOnRightClick(e) {
  if (!e.target.closest('#list-context-menu')) closeContextMenu();
}

function closeContextMenu() {
  const menu = document.getElementById('list-context-menu');
  if (menu) menu.remove();
  document.removeEventListener('mousedown', _closeContextMenuHandler);
  document.removeEventListener('contextmenu', _closeContextMenuOnRightClick);
}

async function contextMoveToPI(section) {
  closeContextMenu();
  const newFixVersion = sectionToFixVersion(section);
  if (section !== 'backlog' && !newFixVersion) {
    showJiraToast('error', `Set a version for ${SECTION_LABELS[section]} first`);
    return;
  }

  const docs = getSelectedDocs();
  if (!docs.length) return;

  // Include descendants for parent items
  const childrenMap = buildChildrenMap(allDocs);
  const allToMove = [];
  const seen = new Set();
  for (const d of docs) {
    if (seen.has(d.filename)) continue;
    seen.add(d.filename);
    allToMove.push(d);
    for (const desc of getDescendants(d.filename, childrenMap)) {
      if (!seen.has(desc.filename)) {
        seen.add(desc.filename);
        allToMove.push(desc);
      }
    }
  }

  try {
    await postJSON('/api/docs/batch-fix-version', {
      fixVersion: newFixVersion,
      docs: allToMove.map(d => ({ type: d.docType, filename: d.filename })),
    });
    showJiraToast('success', `Moved ${allToMove.length} item(s) to ${SECTION_LABELS[section]}`);
    clearSelection();
  } catch (err) {
    showJiraToast('error', err.message);
  }
}

async function contextDeleteSelected() {
  closeContextMenu();
  const docs = getSelectedDocs();
  if (!docs.length) return;

  const count = docs.length;
  const msg = count === 1
    ? `Delete "${docs[0].title}"? This cannot be undone.`
    : `Delete ${count} selected items? This cannot be undone.`;

  document.getElementById('delete-msg').textContent = msg;
  document.getElementById('delete-overlay').classList.add('show');

  // Replace the delete handler temporarily for batch delete
  const btn = document.getElementById('confirm-delete-btn');
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      const data = await postJSON('/api/docs/batch-delete', {
        docs: docs.map(d => ({ type: d.docType, filename: d.filename })),
      });
      closeDeleteDialog();
      clearSelection();
      showJiraToast('success', `Deleted ${data.deleted} item(s)`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Delete';
      showJiraToast('error', err.message);
    } finally {
      // Restore original handler
      btn.onclick = executeDelete;
    }
  };
}

function getSelectedDocs() {
  const docs = [];
  for (const key of selectedItems) {
    const [docType, ...rest] = key.split(':');
    const filename = rest.join(':');
    const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
    if (doc) docs.push(doc);
  }
  return docs;
}
