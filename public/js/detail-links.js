// ── Detail view: hierarchy panel + dependency linking ───────────
// Renders parent/child links (hierarchy panel) and the blocks/blockedBy/
// parallel dependency chips shown in the detail header.
import {
  fetchJSON,
  postJSON,
  stripFrontmatter,
  escHtml,
  showJiraToast,
  toggleSection,
  TYPE_LABEL,
  STATUS_LABEL,
} from './state.js';
import { upsertDoc } from './store.js';
import { showJiraSelectModal } from './jira-import.js';
export function renderDetailDeps(doc) {
  const row = document.getElementById('detail-deps-row');
  if (!row) return;
  const blocks = doc?.blocks || [];
  const blockedBy = doc?.blockedBy || [];
  const parallel = doc?.parallel || [];
  if (!blocks.length && !blockedBy.length && !parallel.length) {
    row.classList.add('hidden');
    row.innerHTML = '';
    return;
  }
  function depChip(fn, chipClass, icon, linkType) {
    const d = allDocs.find((dd) => dd.filename === fn);
    const title = d ? d.title : fn.replace(/\.md$/, '');
    const dtype = d ? d.docType : 'story';
    const short = title.length > 35 ? title.slice(0, 33) + '…' : title;
    return (
      `<span class="dep-chip ${chipClass}" title="${escHtml(linkType)}: ${escHtml(title)}">` +
      `<span class="dep-chip-text" onclick="openDoc('${escHtml(fn)}','${dtype}')">${icon} ${escHtml(short)}</span>` +
      `<button class="dep-chip-delete" onclick="event.stopPropagation(); deleteDepFromDetail('${escHtml(fn)}','${dtype}','${linkType}')" title="Remove dependency">&times;</button>` +
      `</span>`
    );
  }
  const chips = [];
  for (const fn of blockedBy) chips.push(depChip(fn, 'dep-chip-blocked', '🔒', 'blockedBy'));
  for (const fn of blocks) chips.push(depChip(fn, 'dep-chip-blocks', '→', 'blocks'));
  for (const fn of parallel) chips.push(depChip(fn, 'dep-chip-parallel', '#', 'parallel'));
  row.innerHTML = chips.join('');
  row.classList.remove('hidden');
}
export async function deleteDepFromDetail(targetFn, targetDocType, linkType) {
  let srcFn = currentFilename,
    srcType = currentDocType;
  let tgtFn = targetFn,
    tgtType = targetDocType;
  let apiLinkType = linkType;
  if (linkType === 'blockedBy') {
    apiLinkType = 'blocks';
    srcFn = targetFn;
    srcType = targetDocType;
    tgtFn = currentFilename;
    tgtType = currentDocType;
  }
  try {
    // fetchJSON is used directly (rather than deleteJSON) because this DELETE
    // needs a JSON request body, which deleteJSON's signature doesn't support.
    await fetchJSON('/api/link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkType: apiLinkType,
        sourceType: srcType,
        sourceFilename: srcFn,
        targetType: tgtType,
        targetFilename: tgtFn,
      }),
    });
    // Update both affected docs in the store directly — the field changes are
    // fully known from the link we just removed, so no refetch is needed.
    if (apiLinkType === 'parallel') {
      const srcDoc = allDocs.find((d) => d.filename === srcFn);
      if (srcDoc)
        upsertDoc({ ...srcDoc, parallel: (srcDoc.parallel || []).filter((f) => f !== tgtFn) });
      const tgtDoc = allDocs.find((d) => d.filename === tgtFn);
      if (tgtDoc)
        upsertDoc({ ...tgtDoc, parallel: (tgtDoc.parallel || []).filter((f) => f !== srcFn) });
    } else {
      const srcDoc = allDocs.find((d) => d.filename === srcFn);
      if (srcDoc)
        upsertDoc({ ...srcDoc, blocks: (srcDoc.blocks || []).filter((f) => f !== tgtFn) });
      const tgtDoc = allDocs.find((d) => d.filename === tgtFn);
      if (tgtDoc)
        upsertDoc({ ...tgtDoc, blockedBy: (tgtDoc.blockedBy || []).filter((f) => f !== srcFn) });
    }
    const doc = allDocs.find((d) => d.filename === currentFilename);
    if (doc) renderDetailDeps(doc);
    showJiraToast('ok', 'Dependency removed');
  } catch (e) {
    showJiraToast('error', `Failed to remove dependency: ${e.message}`);
  }
}
// ── Hierarchy panel ────────────────────────────────────────────
export async function loadHierarchy(filename, docType) {
  const section = document.getElementById('hierarchy-section');
  const body = document.getElementById('hierarchy-body');
  const label = document.getElementById('hierarchy-label');
  section.classList.add('hidden');
  body.innerHTML = '';
  try {
    const { parent, children } = await fetchJSON(
      `/api/links/${docType}/${encodeURIComponent(filename)}`
    );
    const rows = [];
    // Parent: simple clickable row that navigates to the parent doc
    const makeParentRow = (node) => `
      <div class="hierarchy-row" onclick="openDoc('${escHtml(node.filename)}','${node.docType}')">
        <span class="type-badge ${node.docType}">${TYPE_LABEL[node.docType] || node.docType}</span>
        <span class="hierarchy-title">${escHtml(node.title)}</span>
        ${node.jiraId !== 'TBD' ? `<span class="hierarchy-jira">${escHtml(node.jiraId)}</span>` : ''}
        <span class="status-badge ${(node.status || 'Draft').replace(/\s+/g, '-')}">${STATUS_LABEL[node.status] || node.status || 'Draft'}</span>
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
          <span class="status-badge ${(node.status || 'Draft').replace(/\s+/g, '-')}">${STATUS_LABEL[node.status] || node.status || 'Draft'}</span>
        </div>
        <div class="hierarchy-child-body"></div>
      </div>`;
    if (parent) rows.push(makeParentRow(parent));
    for (const child of children) rows.push(makeChildRow(child));
    const parts = [];
    if (parent) parts.push(`↑ ${TYPE_LABEL[parent.docType]}`);
    if (children.length) parts.push(`↓ ${children.length} linked`);
    label.textContent = `🔗 ${parts.join('  ·  ') || 'Linked Issues'}`;
    // Always show hierarchy section for epics/features — even with no children yet
    const isParent = docType === 'epic' || docType === 'feature';
    const childLabelText = docType === 'epic' ? 'story / spike / bug' : 'epic';
    const linkBtn = isParent
      ? `<button class="btn-link-existing" onclick="linkExistingChildren()">＋ Link existing ${childLabelText}</button>`
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
export async function linkExistingChildren() {
  if (!currentFilename || (currentDocType !== 'epic' && currentDocType !== 'feature')) return;
  const childTypes = currentDocType === 'epic' ? ['story', 'spike', 'bug'] : ['epic'];
  // Find already-linked children so we can exclude them
  const linkedFilenames = new Set();
  try {
    const linkData = await fetchJSON(
      `/api/links/${currentDocType}/${encodeURIComponent(currentFilename)}`
    );
    for (const c of linkData.children || []) linkedFilenames.add(c.filename);
  } catch (e) {
    console.warn('Failed to load linked children:', e.message);
  }
  // Build candidates: items of the right type that aren't already linked here
  const candidates = allDocs
    .filter((d) => childTypes.includes(d.docType) && !linkedFilenames.has(d.filename))
    .map((d) => ({
      key: d.filename,
      filename: d.filename,
      docType: d.docType,
      summary: d.title,
      type: TYPE_LABEL[d.docType] || d.docType,
      localExists: false,
    }))
    .sort((a, b) => a.summary.localeCompare(b.summary));
  if (!candidates.length) {
    showJiraToast('success', 'No unlinked items available');
    return;
  }
  const selected = await showJiraSelectModal(
    `Link existing ${childLabel(currentDocType)} to "${allDocs.find((d) => d.filename === currentFilename)?.title || currentFilename}"`,
    candidates,
    'Link selected'
  );
  if (!selected.length) return;
  const linkedItems = [];
  for (const item of selected) {
    try {
      await postJSON('/api/link', {
        sourceType: item.docType,
        sourceFilename: item.filename,
        targetType: currentDocType,
        targetFilename: currentFilename,
      });
      linkedItems.push(item);
    } catch (e) {
      console.warn(`Failed to link ${item.filename}:`, e.message);
    }
  }
  if (linkedItems.length > 0) {
    showJiraToast('success', `Linked ${linkedItems.length} item(s)`);
    // Each successful link only changes the child's parent field — apply that
    // update directly instead of refetching the whole doc list.
    for (const item of linkedItems) {
      const doc = allDocs.find((d) => d.filename === item.filename && d.docType === item.docType);
      if (doc) upsertDoc({ ...doc, parentFilename: currentFilename });
    }
    loadHierarchy(currentFilename, currentDocType);
  }
}
export function childLabel(docType) {
  return docType === 'epic' ? 'story / spike / bug' : 'epic';
}
export async function toggleHierarchyChild(rowEl) {
  const body = rowEl.querySelector('.hierarchy-child-body');
  const chevron = rowEl.querySelector('.hierarchy-child-chevron');
  const isOpen = rowEl.classList.contains('open');
  if (isOpen) {
    rowEl.classList.remove('open');
    chevron.textContent = '▶';
    return;
  }
  rowEl.classList.add('open');
  chevron.textContent = '▼';
  if (body.dataset.loaded) return;
  const filename = rowEl.dataset.filename;
  const docType = rowEl.dataset.doctype;
  body.innerHTML = '<div class="hierarchy-loading">Loading…</div>';
  try {
    const { content } = await fetchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    body.innerHTML = `<div class="markdown hierarchy-doc-content">${marked.parse(stripFrontmatter(content))}</div>`;
    body.dataset.loaded = '1';
  } catch {
    body.innerHTML = '<div class="hierarchy-loading">Failed to load content.</div>';
  }
}
export function toggleHierarchy() {
  toggleSection('hierarchy-body', 'hierarchy-chevron', 180);
}
//# sourceMappingURL=detail-links.js.map
