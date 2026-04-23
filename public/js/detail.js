// ── Detail view ────────────────────────────────────────────────
async function openDoc(filename, docType) {
  if (_justDragged) return; // swallow click fired by browser after dragend
  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    const { content } = await res.json();
    currentFilename = filename;
    currentDocType  = docType;

    // Sync status dropdown with the doc's current status
    const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
    document.getElementById('status-select').value = doc?.status || 'Draft';

    document.getElementById('detail-filename').textContent = filename;
    const titleInput = document.getElementById('detail-title-input');
    const stripped = stripFrontmatter(content);
    // Template headings ("## Story Title", "## Epic Title", …) → next non-empty line; otherwise use heading text
    const tplMatch = stripped.match(/^## \w[\w ]* Title\s*\n+(.+)/m);
    const h2Match  = stripped.match(/^##\s+(.+)$/m);
    const docTitle = doc?.title || (tplMatch ? tplMatch[1].trim() : h2Match ? h2Match[1].trim() : '');
    titleInput.value = docTitle;
    titleInput.dataset.original = docTitle;
    document.getElementById('detail-content').innerHTML = marked.parse(stripped);
    resetStoriesSection();
    closeQuickCreate();

    // Button visibility per type
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

    // Extract JIRA_ID from frontmatter and update push button label
    const jiraMatch = content.match(/^JIRA_ID:\s*(.+)$/m);
    currentJiraId = jiraMatch ? jiraMatch[1].trim() : 'TBD';
    updateJiraPushBtn();

    if (isSplitMode()) {
      // Split mode: list stays visible — just reveal the detail panel and highlight
      document.getElementById('detail-view').classList.add('show');
      highlightSelectedItem(filename, docType);
    } else {
      document.getElementById('list-view').style.display = 'none';
      document.getElementById('detail-view').classList.add('show');
    }

    // Load hierarchy + original inbox in background
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
    await loadDocs();
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

    if (rows.length) {
      body.innerHTML = rows.join('');
      section.style.display = 'block';
    }
  } catch (e) {
    console.warn('Could not load hierarchy:', e.message);
  }
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
  document.getElementById('upgrade-panel').classList.remove('open');
  document.getElementById('original-section').style.display = 'none';
  resetUpgradePanel();
  closeQuickCreate();
  resetStoriesSection();
  currentFilename = null;
  currentDocType  = null;
  currentStoriesFilename = null;
  currentJiraId   = null;

  if (isSplitMode()) {
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
    await loadDocs();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Delete';
    alert(`Failed to delete: ${e.message}`);
  }
}
