// ── Detail view ────────────────────────────────────────────────
function updateJiraLink(jiraId, jiraUrl) {
  const el = document.getElementById('detail-jira-link');
  if (!el) return;
  if (jiraId && jiraId !== 'TBD') {
    const resolvedUrl = jiraUrl || (jiraBase ? `${jiraBase}/browse/${jiraId}` : null);
    el.textContent = jiraId;
    el.href        = resolvedUrl || '#';
    el.classList.remove('hidden');
    el.style.pointerEvents = resolvedUrl ? '' : 'none';
  } else {
    el.classList.add('hidden');
  }
}

function updateJiraStatus(jiraStatus) {
  const el = document.getElementById('detail-jira-status');
  if (!el) return;
  if (jiraStatus) {
    el.textContent = jiraStatus;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function renderDetailDeps(doc) {
  const row = document.getElementById('detail-deps-row');
  if (!row) return;

  const blocks    = (doc?.blocks    || []);
  const blockedBy = (doc?.blockedBy || []);

  if (!blocks.length && !blockedBy.length) {
    row.classList.add('hidden');
    row.innerHTML = '';
    return;
  }

  const chips = [];

  for (const fn of blockedBy) {
    const d = allDocs.find(dd => dd.filename === fn);
    const title = d ? d.title : fn.replace(/\.md$/, '');
    const dtype = d ? d.docType : 'story';
    chips.push(`<span class="dep-chip dep-chip-blocked" onclick="openDoc('${escHtml(fn)}','${dtype}')" title="Blocked by: ${escHtml(title)}">🔒 ${escHtml(title.length > 35 ? title.slice(0, 33) + '…' : title)}</span>`);
  }
  for (const fn of blocks) {
    const d = allDocs.find(dd => dd.filename === fn);
    const title = d ? d.title : fn.replace(/\.md$/, '');
    const dtype = d ? d.docType : 'story';
    chips.push(`<span class="dep-chip dep-chip-blocks" onclick="openDoc('${escHtml(fn)}','${dtype}')" title="Blocks: ${escHtml(title)}">→ ${escHtml(title.length > 35 ? title.slice(0, 33) + '…' : title)}</span>`);
  }

  row.innerHTML = chips.join('');
  row.classList.remove('hidden');
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
    spWrap.classList.remove('hidden');
    spSumWrap.classList.add('hidden');
    spInput.value           = sp != null ? sp : '';
    spInput.dataset.original = sp != null ? sp : '';
  } else if (isAggr) {
    spWrap.classList.add('hidden');
    spSumWrap.classList.remove('hidden');
    const sum = computeChildPoints(currentFilename, docType);
    spSum.textContent = sum !== null ? sum : '—';
  } else {
    spWrap.classList.add('hidden');
    spSumWrap.classList.add('hidden');
  }
}

async function saveStoryPoints() {
  const input = document.getElementById('sp-input');
  const newVal = input.value.trim();
  const orig   = input.dataset.original || '';
  if (newVal === orig || !currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`,
      { storyPoints: newVal === '' ? null : Number(newVal) });
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
  const group = sel.closest('.detail-field-group');
  const isLeaf = docType === 'story' || docType === 'spike' || docType === 'bug';

  // Only show for leaf items that belong to a PI
  if (!isLeaf || !fixVersion) {
    sel.classList.add('hidden');
    if (group) group.classList.add('hidden');
    return;
  }

  const sprints = getSprintsForPi(fixVersion);
  if (!sprints.length) {
    sel.classList.add('hidden');
    if (group) group.classList.add('hidden');
    return;
  }

  sel.innerHTML = '<option value="">No Sprint</option>' +
    sprints.map(s => `<option value="${escHtml(s.name)}"${s.name === currentSprint ? ' selected' : ''}>${escHtml(s.name)}</option>`).join('');
  sel.value = currentSprint || '';
  sel.classList.remove('hidden');
  if (group) group.classList.remove('hidden');
}

async function updateDocSprint(sprint) {
  if (!currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`,
      { sprint: sprint || null });
    const doc = allDocs.find(d => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) doc.sprint = sprint || null;
    applyFilters();
  } catch (e) { console.warn('Failed to save sprint:', e.message); }
}

// ── Team & Work Category helpers ──────────────────────────────
function updateTeamWorkCatSelects(doc) {
  document.getElementById('detail-team-select').value    = doc?.team || '';
  document.getElementById('detail-workcat-select').value = doc?.workCategory || '';
}

async function updateDocTeam(team) {
  if (!currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`,
      { team: team || null });
    const doc = allDocs.find(d => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) doc.team = team || null;
    applyFilters();
  } catch (e) { console.warn('Failed to save team:', e.message); }
}

async function updateDocWorkCategory(workCategory) {
  if (!currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`,
      { workCategory: workCategory || null });
    const doc = allDocs.find(d => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) doc.workCategory = workCategory || null;
    applyFilters();
  } catch (e) { console.warn('Failed to save work category:', e.message); }
}

function updateDocButtons(docType) {
  const isEpic    = docType === 'epic';
  const isFeature = docType === 'feature';
  document.getElementById('create-dropdown-wrap').classList.toggle('hidden', !(isEpic || isFeature));
  document.getElementById('create-epic-btn').classList.toggle('hidden', !isFeature);
  document.getElementById('create-story-btn').classList.toggle('hidden', !isEpic);
  document.getElementById('create-spike-btn').classList.toggle('hidden', !isEpic);
  document.getElementById('create-bug-btn').classList.toggle('hidden', !isEpic);
  document.getElementById('refine-dropdown-wrap').classList.toggle('hidden', !(isEpic || isFeature));
  const storiesBtn = document.getElementById('stories-btn');
  if (storiesBtn) { storiesBtn.disabled = false; storiesBtn.textContent = 'AI Story Generation'; }
}

async function openDoc(filename, docType) {
  if (_justDragged) return;
  try {
    const { content } = await fetchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    currentFilename = filename;
    currentDocType  = docType;

    const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
    renderDocContent(doc, content);
    renderDetailDeps(doc);
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
    updateTeamWorkCatSelects(doc);

    document.querySelector('.right').classList.add('has-selection');
    if (isSplitMode() || isRoadmapOpen()) {
      document.getElementById('detail-view').classList.add('show');
      highlightSelectedItem(filename, docType);
    } else {
      document.getElementById('list-view').style.display = 'none';
      document.getElementById('detail-view').classList.add('show');
    }

    if (docType === 'epic' || docType === 'feature') loadHierarchy(filename, docType);
    else document.getElementById('hierarchy-section').classList.add('hidden');
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
    const { content } = await fetchJSON(`/api/inbox/${encodeURIComponent(filename)}`);
    container.innerHTML = `<div class="original-content">${escHtml(content)}</div>`;
    section.classList.remove('hidden');
  } catch {
    section.classList.add('hidden');
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
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`,
      { title: newTitle });
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
  section.classList.add('hidden');
  body.innerHTML = '';

  try {
    const { parent, children } = await fetchJSON(`/api/links/${docType}/${encodeURIComponent(filename)}`);

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
      section.classList.remove('hidden');
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
    const linkData = await fetchJSON(`/api/links/${currentDocType}/${encodeURIComponent(currentFilename)}`);
    for (const c of (linkData.children || [])) linkedFilenames.add(c.filename);
  } catch (e) { console.warn('Failed to load linked children:', e.message); }

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
      await postJSON('/api/link', {
        sourceType:     item.docType,
        sourceFilename: item.filename,
        targetType:     currentDocType,
        targetFilename: currentFilename,
      });
      linked++;
    } catch (e) { console.warn(`Failed to link ${child.filename}:`, e.message); }
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
    const { content } = await fetchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    body.innerHTML = `<div class="markdown hierarchy-doc-content">${marked.parse(stripFrontmatter(content))}</div>`;
    body.dataset.loaded = '1';
  } catch {
    body.innerHTML = '<div class="hierarchy-loading">Failed to load content.</div>';
  }
}

function toggleHierarchy() {
  toggleSection('hierarchy-body', 'hierarchy-chevron', 180);
}

function toggleOriginal() {
  toggleSection('original-body', 'original-chevron', 180);
}

// ── Update status ──────────────────────────────────────────────
async function updateDocStatus(status) {
  if (!currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, { status });
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
  document.getElementById('original-section').classList.add('hidden');
  resetUpgradePanel();
  closeQuickCreate();
  resetStoriesSection();
  currentFilename = null;
  currentDocType  = null;
  currentJiraId   = null;
  updateJiraLink(null, null);
  updateJiraStatus(null);
  document.getElementById('sp-wrap').classList.add('hidden');
  document.getElementById('sp-sum-wrap').classList.add('hidden');

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
    await deleteJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`);
    closeDeleteDialog();
    showList();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Delete';
    alert(`Failed to delete: ${e.message}`);
  }
}
