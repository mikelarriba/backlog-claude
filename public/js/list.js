// ── Doc list ───────────────────────────────────────────────────

// PI settings state
var piSettings    = { currentPi: null, nextPi: null };
var jiraVersions  = [];
var _swimlanesCollapsed = { currentPi: false, nextPi: false, backlog: false };

async function loadDocs() {
  try {
    const res = await fetch('/api/docs');
    allDocs = await res.json();
    renderSwimlanes(allDocs);
  } catch (e) {
    console.warn('Could not load docs:', e.message);
  }
}

async function loadPiSettings() {
  try {
    const res = await fetch('/api/settings/pi');
    piSettings = await res.json();
  } catch {}
}

async function loadJiraVersions() {
  try {
    const res = await fetch('/api/jira/versions');
    const data = await res.json();
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
    const children = childrenMap.get(doc.filename) || [];
    children.forEach(child => place(child, indent + 1));
  }

  docs.forEach(d => {
    if (!d.parentFilename || !byFilename.has(d.parentFilename)) place(d, 0);
  });
  docs.forEach(d => { if (!placed.has(key(d))) place(d, 0); });

  return ordered;
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

  const { currentPi, nextPi, backlog } = categorizeDocs(docs);

  const html = [
    renderSwimlaneSectionHtml('currentPi', 'Current PI', piSettings.currentPi, currentPi),
    renderSwimlaneSectionHtml('nextPi',    'Next PI',    piSettings.nextPi,    nextPi),
    renderSwimlaneSectionHtml('backlog',   'Backlog',    null,                 backlog),
  ].join('');

  list.innerHTML = html;
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

  // Render items
  const ordered = buildTreeOrder(docs);
  const itemsHtml = ordered.length
    ? ordered.map(({ doc: d, indent }) => renderDocItem(d, indent)).join('')
    : `<div class="swimlane-empty">No issues in this section</div>`;

  return `
    <div class="swimlane-section" data-section="${sectionKey}">
      <div class="swimlane-header" onclick="toggleSwimlane('${sectionKey}')">
        <span class="swimlane-chevron">${chevron}</span>
        <span class="swimlane-label">${label}</span>
        ${versionDisplay}
        ${countBadge}
        <div class="swimlane-header-right">
          ${versionSelector}
        </div>
      </div>
      <div class="${bodyClass}">
        ${itemsHtml}
      </div>
    </div>`;
}

function renderDocItem(d, indent) {
  const statusClass = (d.status || 'Draft').replace(/\s+/g, '-');
  const connector   = indent > 0 ? `<span class="tree-connector">└</span>` : '';
  return `
    <div class="epic-item"
         data-filename="${escHtml(d.filename)}"
         data-doctype="${d.docType}"
         data-indent="${indent}"
         onclick="openDoc('${escHtml(d.filename)}','${d.docType}')">
      <div class="drag-handle"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      ${connector}
      <div class="epic-dot"></div>
      <div style="flex:1">
        <div class="epic-title-text">${escHtml(d.title)}</div>
      </div>
      <span class="status-badge ${statusClass}">${STATUS_LABEL[d.status] || d.status || 'Draft'}</span>
      <span class="type-badge ${d.docType}">${TYPE_LABEL[d.docType] || d.docType}</span>
      <div class="epic-date">${d.date}</div>
    </div>`;
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
    const res = await fetch('/api/settings/pi', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    if (res.ok) {
      piSettings = update;
      applyFilters();
    }
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

function applyFilters() {
  const q = document.getElementById('search').value.toLowerCase();
  let filtered = allDocs;
  if (activeTypeFilter !== 'all')   filtered = filtered.filter(d => d.docType === activeTypeFilter);
  if (activeStatusFilter !== 'all') filtered = filtered.filter(d => (d.status || 'Draft') === activeStatusFilter);
  if (q) filtered = filtered.filter(d => d.title.toLowerCase().includes(q) || d.filename.toLowerCase().includes(q));
  renderSwimlanes(filtered);
}
