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
    document.getElementById('detail-content').innerHTML = marked.parse(stripFrontmatter(content));
    resetStoriesSection();
    closeQuickCreate();

    // Button visibility per type
    const isEpic    = docType === 'epic';
    const isFeature = docType === 'feature';
    document.getElementById('create-epic-btn').style.display  = isFeature ? '' : 'none';
    document.getElementById('create-story-btn').style.display = isEpic    ? '' : 'none';
    document.getElementById('create-spike-btn').style.display = isEpic    ? '' : 'none';
    document.getElementById('stories-btn').style.display      = isEpic    ? '' : 'none';
    document.getElementById('stories-btn').disabled = false;
    document.getElementById('stories-btn').textContent = '✨ Refine into Stories';

    // Extract JIRA_ID from frontmatter and update push button label
    const jiraMatch = content.match(/^JIRA_ID:\s*(.+)$/m);
    currentJiraId = jiraMatch ? jiraMatch[1].trim() : 'TBD';
    updateJiraPushBtn();

    document.getElementById('list-view').style.display = 'none';
    document.getElementById('detail-view').classList.add('show');

    // Load stories + original inbox + hierarchy in background
    if (docType === 'epic') loadStoriesForEpic(filename);
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

    const makeRow = (node, indent) => `
      <div class="hierarchy-row" onclick="openDoc('${escHtml(node.filename)}','${node.docType}')">
        <span class="hierarchy-indent">${indent}</span>
        <span class="type-badge ${node.docType}">${TYPE_LABEL[node.docType] || node.docType}</span>
        <span class="hierarchy-title">${escHtml(node.title)}</span>
        ${node.jiraId !== 'TBD' ? `<span class="hierarchy-jira">${escHtml(node.jiraId)}</span>` : ''}
        <span class="status-badge ${(node.status || 'Draft').replace(/\s+/g,'-')}">${STATUS_LABEL[node.status] || node.status || 'Draft'}</span>
      </div>`;

    if (parent) rows.push(makeRow(parent, ''));
    for (const child of children) rows.push(makeRow(child, '└'));

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
  document.getElementById('list-view').style.display = 'flex';
  document.getElementById('upgrade-panel').classList.remove('open');
  document.getElementById('original-section').style.display = 'none';
  resetUpgradePanel();
  closeQuickCreate();
  resetStoriesSection();
  currentFilename = null;
  currentDocType  = null;
  currentStoriesFilename = null;
  currentJiraId   = null;
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
