// ── Detail view ────────────────────────────────────────────────
function updateJiraLink(jiraId, jiraUrl) {
  const el = document.getElementById('detail-jira-link');
  if (!el) return;
  if (jiraId && jiraId !== 'TBD') {
    const resolvedUrl = jiraUrl || (jiraBase ? `${jiraBase}/browse/${jiraId}` : null);
    el.textContent = jiraId;
    el.href        = resolvedUrl || '#';
    el.style.display = '';
    el.style.pointerEvents = resolvedUrl ? '' : 'none';
  } else {
    el.style.display = 'none';
  }
}

function updateJiraStatus(jiraStatus) {
  const el = document.getElementById('detail-jira-status');
  if (!el) return;
  if (jiraStatus) {
    el.textContent = jiraStatus;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function renderDocContent(doc, content) {
  document.getElementById('status-select').value = doc?.status || 'Draft';
  document.getElementById('detail-filename').textContent = doc?.filename || currentFilename;

  const titleInput = document.getElementById('detail-title-input');
  const stripped = stripFrontmatter(content);
  const tplMatch = stripped.match(/^## \w[\w ]* Title\s*\n+(.+)/m);
  const h2Match  = stripped.match(/^##\s+(.+)$/m);
  const docTitle = doc?.title || (tplMatch ? tplMatch[1].trim() : h2Match ? h2Match[1].trim() : '');
  titleInput.value = docTitle;
  titleInput.dataset.original = docTitle;
  document.getElementById('detail-content').innerHTML = marked.parse(stripped);

  // JIRA Status badge (read-only, pulled from JIRA)
  const jiraStatusMatch = content.match(/^JIRA_Status:\s*(.+)$/m);
  updateJiraStatus(jiraStatusMatch ? jiraStatusMatch[1].trim() : null);
}

// ── Story points helpers ───────────────────────────────────────
function computeChildPoints(filename, docType) {
  // For epics: sum story/spike/bug children. For features: sum epic children.
  const childType = docType === 'feature' ? 'epic' : null;
  const children  = allDocs.filter(d => {
    if (docType === 'feature') return d.docType === 'epic' && d.parentFilename === filename;
    if (docType === 'epic')    return (d.docType === 'story' || d.docType === 'spike' || d.docType === 'bug') && d.parentFilename === filename;
    return false;
  });
  if (!children.length) return null;
  let sum = 0;
  for (const c of children) {
    if (docType === 'feature') {
      // Sum the epic's own children points
      const epicChildren = allDocs.filter(d =>
        (d.docType === 'story' || d.docType === 'spike' || d.docType === 'bug') && d.parentFilename === c.filename
      );
      for (const ec of epicChildren) sum += Number(ec.storyPoints) || 0;
    } else {
      sum += Number(c.storyPoints) || 0;
    }
  }
  return sum;
}

function updateStoryPointsUI(docType, sp) {
  const isLeaf = docType === 'story' || docType === 'spike' || docType === 'bug';
  const isAggr = docType === 'epic' || docType === 'feature';

  const spWrap    = document.getElementById('sp-wrap');
  const spSumWrap = document.getElementById('sp-sum-wrap');
  const spInput   = document.getElementById('sp-input');
  const spSum     = document.getElementById('sp-sum');

  if (isLeaf) {
    spWrap.style.display    = '';
    spSumWrap.style.display = 'none';
    spInput.value           = sp != null ? sp : '';
    spInput.dataset.original = sp != null ? sp : '';
  } else if (isAggr) {
    spWrap.style.display    = 'none';
    spSumWrap.style.display = '';
    const sum = computeChildPoints(currentFilename, docType);
    spSum.textContent = sum !== null ? sum : '—';
  } else {
    spWrap.style.display    = 'none';
    spSumWrap.style.display = 'none';
  }
}

async function saveStoryPoints() {
  const input = document.getElementById('sp-input');
  const newVal = input.value.trim();
  const orig   = input.dataset.original || '';
  if (newVal === orig || !currentFilename || !currentDocType) return;
  try {
    const res = await fetch(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyPoints: newVal === '' ? null : Number(newVal) }),
    });
    if (!res.ok) { input.value = orig; return; }
    input.dataset.original = newVal;
    const doc = allDocs.find(d => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) doc.storyPoints = newVal === '' ? null : Number(newVal);
  } catch {
    input.value = orig;
  }
}

// ── Sprint select helpers ─────────────────────────────────────
function updateSprintSelect(docType, fixVersion, currentSprint) {
  const sel = document.getElementById('sprint-select');
  const isLeaf = docType === 'story' || docType === 'spike' || docType === 'bug';

  // Only show for leaf items that belong to a PI
  if (!isLeaf || !fixVersion) {
    sel.style.display = 'none';
    return;
  }

  const sprints = getSprintsForPi(fixVersion);
  if (!sprints.length) {
    sel.style.display = 'none';
    return;
  }

  sel.innerHTML = '<option value="">No Sprint</option>' +
    sprints.map(s => `<option value="${escHtml(s.name)}"${s.name === currentSprint ? ' selected' : ''}>${escHtml(s.name)}</option>`).join('');
  sel.value = currentSprint || '';
  sel.style.display = '';
}

async function updateDocSprint(sprint) {
  if (!currentFilename || !currentDocType) return;
  try {
    const res = await fetch(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprint: sprint || null }),
    });
    if (!res.ok) return;
    const doc = allDocs.find(d => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) doc.sprint = sprint || null;
    applyFilters();
  } catch {}
}

function updateDocButtons(docType) {
  const isEpic    = docType === 'epic';
  const isFeature = docType === 'feature';
  document.getElementById('create-dropdown-wrap').style.display = (isEpic || isFeature) ? '' : 'none';
  document.getElementById('create-epic-btn').style.display  = isFeature ? '' : 'none';
  document.getElementById('create-story-btn').style.display = isEpic    ? '' : 'none';
  document.getElementById('create-spike-btn').style.display = isEpic    ? '' : 'none';
  document.getElementById('create-bug-btn').style.display   = isEpic    ? '' : 'none';
  document.getElementById('refine-dropdown-wrap').style.display = (isEpic || isFeature) ? '' : 'none';
  const storiesBtn = document.getElementById('stories-btn');
  if (storiesBtn) { storiesBtn.disabled = false; storiesBtn.textContent = 'AI Story Generation'; }
}

async function openDoc(filename, docType) {
  if (_justDragged) return;
  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    const { content } = await res.json();
    currentFilename = filename;
    currentDocType  = docType;

    const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
    renderDocContent(doc, content);
    resetStoriesSection();
    closeQuickCreate();
    updateDocButtons(docType);

    const jiraMatch    = content.match(/^JIRA_ID:\s*(.+)$/m);
    const jiraUrlMatch = content.match(/^JIRA_URL:\s*(.+)$/m);
    currentJiraId = jiraMatch ? jiraMatch[1].trim() : 'TBD';
    updateJiraLink(currentJiraId, jiraUrlMatch ? jiraUrlMatch[1].trim() : null);
    updateJiraPushBtn();
    updateStoryPointsUI(docType, doc?.storyPoints ?? null);
    updateSprintSelect(docType, doc?.fixVersion, doc?.sprint);

    document.querySelector('.right').classList.add('has-selection');
    if (isSplitMode() || isRoadmapOpen()) {
      document.getElementById('detail-view').classList.add('show');
      highlightSelectedItem(filename, docType);
    } else {
      document.getElementById('list-view').style.display = 'none';
      document.getElementById('detail-view').classList.add('show');
    }

    if (docType === 'epic' || docType === 'feature') loadHierarchy(filename, docType);
    else document.getElementById('hierarchy-section').style.display = 'none';
    loadOriginal(filename);
  } catch (e) {
    console.error(e);
  }
}

async function loadOriginal(filename) {
  const section   = document.getElementById('original-section');
  const container = document.getElementById('original-content');

  // Reset collapsed state
  document.getElementById('original-body').classList.remove('open');
  document.getElementById('original-chevron').style.transform = '';

  try {
    const res = await fetch(`/api/inbox/${encodeURIComponent(filename)}`);
    if (!res.ok) { section.style.display = 'none'; return; }
    const { content } = await res.json();
    container.innerHTML = `<div class="original-content">${escHtml(content)}</div>`;
    section.style.display = 'block';
  } catch {
    section.style.display = 'none';
  }
}

// ── Toolbar dropdowns ──────────────────────────────────────────
function toggleDropdown(id) {
  const menu = document.getElementById(id);
  const isOpen = menu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) menu.classList.add('open');
}
function closeDropdown(id) {
  document.getElementById(id)?.classList.remove('open');
}
function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
}
document.addEventListener('click', e => {
  if (!e.target.closest('.dropdown-wrap')) closeAllDropdowns();
});

// ── Inline title editing ───────────────────────────────────────
async function saveTitle() {
  const input = document.getElementById('detail-title-input');
  const newTitle = input.value.trim();
  if (!newTitle || newTitle === input.dataset.original || !currentFilename || !currentDocType) return;
  try {
    const res = await fetch(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    });
    if (!res.ok) { input.value = input.dataset.original; return; }
    input.dataset.original = newTitle;
    // Re-render the heading inside the detail content without a full reload
    const contentEl = document.getElementById('detail-content');
    const h2 = contentEl.querySelector('h2');
    if (h2) h2.textContent = newTitle;
  } catch (e) {
    input.value = input.dataset.original;
  }
}

function cancelTitleEdit() {
  const input = document.getElementById('detail-title-input');
  input.value = input.dataset.original || '';
  input.blur();
}

// ── Hierarchy panel ────────────────────────────────────────────
async function loadHierarchy(filename, docType) {
  const section = document.getElementById('hierarchy-section');
  const body    = document.getElementById('hierarchy-body');
  const label   = document.getElementById('hierarchy-label');
  section.style.display = 'none';
  body.innerHTML = '';

  try {
    const res = await fetch(`/api/links/${docType}/${encodeURIComponent(filename)}`);
    if (!res.ok) return;
    const { parent, children } = await res.json();

    const rows = [];

    // Parent: simple clickable row that navigates to the parent doc
    const makeParentRow = (node) => `
      <div class="hierarchy-row" onclick="openDoc('${escHtml(node.filename)}','${node.docType}')">
        <span class="type-badge ${node.docType}">${TYPE_LABEL[node.docType] || node.docType}</span>
        <span class="hierarchy-title">${escHtml(node.title)}</span>
        ${node.jiraId !== 'TBD' ? `<span class="hierarchy-jira">${escHtml(node.jiraId)}</span>` : ''}
        <span class="status-badge ${(node.status || 'Draft').replace(/\s+/g,'-')}">${STATUS_LABEL[node.status] || node.status || 'Draft'}</span>
      </div>`;

    // Children: expandable panels that load and render doc content inline
    const makeChildRow = (node) => `
      <div class="hierarchy-child"
           data-filename="${escHtml(node.filename)}"
           data-doctype="${node.docType}">
        <div class="hierarchy-child-header" onclick="toggleHierarchyChild(this.parentElement)">
          <span class="hierarchy-child-chevron">▶</span>
          <span class="type-badge ${node.docType}">${TYPE_LABEL[node.docType] || node.docType}</span>
          <span class="hierarchy-title">${escHtml(node.title)}</span>
          ${node.jiraId !== 'TBD' ? `<span class="hierarchy-jira">${escHtml(node.jiraId)}</span>` : ''}
          <span class="status-badge ${(node.status || 'Draft').replace(/\s+/g,'-')}">${STATUS_LABEL[node.status] || node.status || 'Draft'}</span>
        </div>
        <div class="hierarchy-child-body"></div>
      </div>`;

    if (parent) rows.push(makeParentRow(parent));
    for (const child of children) rows.push(makeChildRow(child));

    const parts = [];
    if (parent)          parts.push(`↑ ${TYPE_LABEL[parent.docType]}`);
    if (children.length) parts.push(`↓ ${children.length} linked`);
    label.textContent = `🔗 ${parts.join('  ·  ') || 'Linked Issues'}`;

    // Always show hierarchy section for epics/features — even with no children yet
    const isParent = docType === 'epic' || docType === 'feature';
    const childLabel = docType === 'epic' ? 'story / spike / bug' : 'epic';
    const linkBtn = isParent
      ? `<button class="btn-link-existing" onclick="linkExistingChildren()">＋ Link existing ${childLabel}</button>`
      : '';

    if (rows.length || isParent) {
      body.innerHTML = rows.join('') + linkBtn;
      section.style.display = 'block';
    }
  } catch (e) {
    console.warn('Could not load hierarchy:', e.message);
  }
}

// ── Link existing child to current doc ────────────────────────
async function linkExistingChildren() {
  if (!currentFilename || (currentDocType !== 'epic' && currentDocType !== 'feature')) return;

  const childTypes = currentDocType === 'epic' ? ['story', 'spike', 'bug'] : ['epic'];

  // Find already-linked children so we can exclude them
  const linkedFilenames = new Set();
  try {
    const res = await fetch(`/api/links/${currentDocType}/${encodeURIComponent(currentFilename)}`);
    if (res.ok) {
      const { children } = await res.json();
      for (const c of (children || [])) linkedFilenames.add(c.filename);
    }
  } catch (_) {}

  // Build candidates: items of the right type that aren't already linked here
  const candidates = allDocs
    .filter(d => childTypes.includes(d.docType) && !linkedFilenames.has(d.filename))
    .map(d => ({
      key:       d.filename,
      filename:  d.filename,
      docType:   d.docType,
      summary:   d.title,
      type:      TYPE_LABEL[d.docType] || d.docType,
      localExists: false,
    }))
    .sort((a, b) => a.summary.localeCompare(b.summary));

  if (!candidates.length) {
    showJiraToast('success', 'No unlinked items available');
    return;
  }

  const selected = await showJiraSelectModal(
    `Link existing ${childLabel(currentDocType)} to "${allDocs.find(d=>d.filename===currentFilename)?.title || currentFilename}"`,
    candidates,
    'Link selected'
  );

  if (!selected.length) return;

  let linked = 0;
  for (const item of selected) {
    try {
      const res = await fetch('/api/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType:     item.docType,
          sourceFilename: item.filename,
          targetType:     currentDocType,
          targetFilename: currentFilename,
        }),
      });
      if (res.ok) linked++;
    } catch (_) {}
  }

  if (linked > 0) {
    showJiraToast('success', `Linked ${linked} item(s)`);
    loadHierarchy(currentFilename, currentDocType);
    await loadDocs();
  }
}

function childLabel(docType) {
  return docType === 'epic' ? 'story / spike / bug' : 'epic';
}

async function toggleHierarchyChild(rowEl) {
  const body    = rowEl.querySelector('.hierarchy-child-body');
  const chevron = rowEl.querySelector('.hierarchy-child-chevron');
  const isOpen  = rowEl.classList.contains('open');

  if (isOpen) {
    rowEl.classList.remove('open');
    chevron.textContent = '▶';
    return;
  }

  rowEl.classList.add('open');
  chevron.textContent = '▼';

  if (body.dataset.loaded) return;

  const filename = rowEl.dataset.filename;
  const docType  = rowEl.dataset.doctype;
  body.innerHTML = '<div class="hierarchy-loading">Loading…</div>';

  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    const { content } = await res.json();
    body.innerHTML = `<div class="markdown hierarchy-doc-content">${marked.parse(stripFrontmatter(content))}</div>`;
    body.dataset.loaded = '1';
  } catch {
    body.innerHTML = '<div class="hierarchy-loading">Failed to load content.</div>';
  }
}

function toggleHierarchy() {
  const body    = document.getElementById('hierarchy-body');
  const chevron = document.getElementById('hierarchy-chevron');
  const isOpen  = body.classList.toggle('open');
  body.style.display  = isOpen ? 'block' : 'none';
  chevron.style.transform = isOpen ? 'rotate(180deg)' : '';
}

function toggleOriginal() {
  const body    = document.getElementById('original-body');
  const chevron = document.getElementById('original-chevron');
  const isOpen  = body.classList.toggle('open');
  chevron.style.transform = isOpen ? 'rotate(180deg)' : '';
}

// ── Update status ──────────────────────────────────────────────
async function updateDocStatus(status) {
  if (!currentFilename || !currentDocType) return;
  try {
    await fetch(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const doc = allDocs.find(d => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) doc.status = status;
  } catch (e) {
    console.error('Failed to update status:', e.message);
  }
}

function showList() {
  document.getElementById('detail-view').classList.remove('show');
  document.querySelector('.right').classList.remove('has-selection');
  document.getElementById('upgrade-panel').classList.remove('open');
  document.getElementById('original-section').style.display = 'none';
  resetUpgradePanel();
  closeQuickCreate();
  resetStoriesSection();
  currentFilename = null;
  currentDocType  = null;
  currentStoriesFilename = null;
  currentJiraId   = null;
  updateJiraLink(null, null);
  updateJiraStatus(null);
  document.getElementById('sp-wrap').style.display    = 'none';
  document.getElementById('sp-sum-wrap').style.display = 'none';

  if (isRoadmapOpen()) {
    // Roadmap stays visible; just clear the selection highlight
    highlightSelectedItem(null, null);
  } else if (isSplitMode()) {
    // List is already visible — just clear the selection highlight
    highlightSelectedItem(null, null);
  } else {
    document.getElementById('list-view').style.display = 'flex';
  }
}

// ── Delete ────────────────────────────────────────────────────
function confirmDelete() {
  if (!currentFilename) return;
  document.getElementById('delete-msg').textContent =
    `Delete "${currentFilename}"? This will permanently remove the file and cannot be undone.`;
  document.getElementById('delete-overlay').classList.add('show');
}

function closeDeleteDialog() {
  document.getElementById('delete-overlay').classList.remove('show');
  const btn = document.getElementById('confirm-delete-btn');
  btn.disabled = false;
  btn.textContent = 'Delete';
}

async function executeDelete() {
  if (!currentFilename || !currentDocType) return;
  const btn = document.getElementById('confirm-delete-btn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    const res = await fetch(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(getErrorMessage((await res.json()).error, 'Delete failed'));
    closeDeleteDialog();
    showList();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Delete';
    alert(`Failed to delete: ${e.message}`);
  }
}
