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
  renderMarkdown,
} from './state.js';
import type { DocEntry } from './state.js';
import { upsertDoc } from './store.js';
import { showJiraSelectModal } from './jira-import.js';
import type { SelectModalItem, ChildLink, LinksResponse } from './detail.js';
import { registerActions } from './actions.js';

// Typed data-action names for the dependency chip's "remove" button and its
// clickable label in renderDetailDeps, and the hierarchy panel's parent row,
// per-child expand/collapse header, and "Link existing" button in
// loadHierarchy (issue #461 migration — see actions.ts and list-filters.ts's
// CTX_ACTIONS for the established pattern). Replaces the
// onclick="event.stopPropagation(); deleteDepFromDetail(fn, dtype, linkType)" /
// onclick="openDoc(fn, dtype)" / onclick="toggleHierarchyChild(this.parentElement)" /
// onclick="linkExistingChildren()" strings previously built by hand (the
// first with the three args hand-interpolated into the template). The
// deleteDep handler was never actually reachable at runtime — main.ts's
// window bridge (_dynGlobals) never included deleteDepFromDetail, so the
// button silently threw "deleteDepFromDetail is not defined" on click — that
// migration also fixed a dead/broken "remove dependency" button.
//
// openDoc itself is intentionally referenced as the ambient global declared
// in global.d.ts (var openDoc: ...) rather than imported from detail.ts:
// detail.ts already imports loadHierarchy/renderDetailDeps from this module,
// so a value import the other way would close a direct two-file cycle
// pulling detail.ts's much heavier dependency graph (main.ts and friends)
// into this module — the same reason currentFilename/currentDocType/allDocs
// are referenced as bare globals below rather than imported. openDoc stays
// on the window bridge for one remaining onclick="openDoc(...)" site outside
// this module (roadmap-render.ts's cross-PI "ghost card"); see main.ts.
export const DETAIL_LINKS_ACTIONS = {
  deleteDep: 'detailLinksDeleteDep',
  openDoc: 'detailLinksOpenDoc',
  toggleHierarchyChild: 'detailLinksToggleHierarchyChild',
  linkExistingChildren: 'detailLinksLinkExistingChildren',
} as const;

registerActions({
  [DETAIL_LINKS_ACTIONS.deleteDep]: (el, e) => {
    e.stopPropagation();
    void deleteDepFromDetail(
      el.dataset.depFn ?? '',
      el.dataset.depType ?? '',
      el.dataset.linkType ?? ''
    );
  },
  [DETAIL_LINKS_ACTIONS.openDoc]: (el) => {
    openDoc(el.dataset.filename ?? '', el.dataset.doctype ?? '');
  },
  [DETAIL_LINKS_ACTIONS.toggleHierarchyChild]: (el) => {
    void toggleHierarchyChild(el.parentElement as HTMLElement);
  },
  [DETAIL_LINKS_ACTIONS.linkExistingChildren]: () => {
    void linkExistingChildren();
  },
});

export function renderDetailDeps(doc: DocEntry | undefined): void {
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

  function depChip(fn: string, chipClass: string, icon: string, linkType: string): string {
    const d = allDocs.find((dd) => dd.filename === fn);
    const title = d ? d.title : fn.replace(/\.md$/, '');
    const dtype = d ? d.docType : 'story';
    const short = title.length > 35 ? title.slice(0, 33) + '…' : title;
    return (
      `<span class="dep-chip ${chipClass}" title="${escHtml(linkType)}: ${escHtml(title)}">` +
      `<span class="dep-chip-text" data-action="${DETAIL_LINKS_ACTIONS.openDoc}" data-filename="${escHtml(fn)}" data-doctype="${dtype}">${icon} ${escHtml(short)}</span>` +
      `<button class="dep-chip-delete" data-action="${DETAIL_LINKS_ACTIONS.deleteDep}" data-dep-fn="${escHtml(fn)}" data-dep-type="${escHtml(dtype)}" data-link-type="${escHtml(linkType)}" title="Remove dependency">&times;</button>` +
      `</span>`
    );
  }

  const chips: string[] = [];
  for (const fn of blockedBy) chips.push(depChip(fn, 'dep-chip-blocked', '🔒', 'blockedBy'));
  for (const fn of blocks) chips.push(depChip(fn, 'dep-chip-blocks', '→', 'blocks'));
  for (const fn of parallel) chips.push(depChip(fn, 'dep-chip-parallel', '#', 'parallel'));

  row.innerHTML = chips.join('');
  row.classList.remove('hidden');
}

export async function deleteDepFromDetail(
  targetFn: string,
  targetDocType: string,
  linkType: string
): Promise<void> {
  let srcFn = currentFilename,
    srcType = currentDocType;
  let tgtFn = targetFn,
    tgtType: string | null = targetDocType;
  let apiLinkType = linkType;
  if (linkType === 'blockedBy') {
    apiLinkType = 'blocks';
    srcFn = targetFn;
    srcType = targetDocType;
    tgtFn = currentFilename as string;
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
    showJiraToast('error', `Failed to remove dependency: ${(e as Error).message}`);
  }
}

// ── Hierarchy panel ────────────────────────────────────────────
export async function loadHierarchy(filename: string, docType: string): Promise<void> {
  const section = document.getElementById('hierarchy-section') as HTMLElement;
  const body = document.getElementById('hierarchy-body') as HTMLElement;
  const label = document.getElementById('hierarchy-label') as HTMLElement;
  section.classList.add('hidden');
  body.innerHTML = '';

  try {
    const { parent, children } = (await fetchJSON(
      `/api/links/${docType}/${encodeURIComponent(filename)}`
    )) as LinksResponse;

    const rows: string[] = [];

    // Parent: simple clickable row that navigates to the parent doc
    const makeParentRow = (node: DocEntry & { jiraId: string }): string => `
      <div class="hierarchy-row" data-action="${DETAIL_LINKS_ACTIONS.openDoc}" data-filename="${escHtml(node.filename)}" data-doctype="${node.docType}">
        <span class="type-badge ${node.docType}">${TYPE_LABEL[node.docType] || node.docType}</span>
        <span class="hierarchy-title">${escHtml(node.title)}</span>
        ${node.jiraId !== 'TBD' ? `<span class="hierarchy-jira">${escHtml(node.jiraId)}</span>` : ''}
        <span class="status-badge ${(node.status || 'Draft').replace(/\s+/g, '-')}">${STATUS_LABEL[node.status] || node.status || 'Draft'}</span>
      </div>`;

    // Children: expandable panels that load and render doc content inline
    const makeChildRow = (node: DocEntry & { jiraId: string }): string => `
      <div class="hierarchy-child"
           data-filename="${escHtml(node.filename)}"
           data-doctype="${node.docType}">
        <div class="hierarchy-child-header" data-action="${DETAIL_LINKS_ACTIONS.toggleHierarchyChild}">
          <span class="hierarchy-child-chevron">▶</span>
          <span class="type-badge ${node.docType}">${TYPE_LABEL[node.docType] || node.docType}</span>
          <span class="hierarchy-title">${escHtml(node.title)}</span>
          ${node.jiraId !== 'TBD' ? `<span class="hierarchy-jira">${escHtml(node.jiraId)}</span>` : ''}
          <span class="status-badge ${(node.status || 'Draft').replace(/\s+/g, '-')}">${STATUS_LABEL[node.status] || node.status || 'Draft'}</span>
        </div>
        <div class="hierarchy-child-body"></div>
      </div>`;

    if (parent) rows.push(makeParentRow(parent));
    for (const child of children) rows.push(makeChildRow(child as DocEntry & { jiraId: string }));

    const parts: string[] = [];
    if (parent) parts.push(`↑ ${TYPE_LABEL[parent.docType]}`);
    if (children.length) parts.push(`↓ ${children.length} linked`);
    label.textContent = `🔗 ${parts.join('  ·  ') || 'Linked Issues'}`;

    // Always show hierarchy section for epics/features — even with no children yet
    const isParent = docType === 'epic' || docType === 'feature';
    const childLabelText = docType === 'epic' ? 'story / spike / bug' : 'epic';
    const linkBtn = isParent
      ? `<button class="btn-link-existing" data-action="${DETAIL_LINKS_ACTIONS.linkExistingChildren}">＋ Link existing ${childLabelText}</button>`
      : '';

    if (rows.length || isParent) {
      body.innerHTML = rows.join('') + linkBtn;
      section.classList.remove('hidden');
    }
  } catch (e) {
    console.warn('Could not load hierarchy:', (e as Error).message);
  }
}

// ── Link existing child to current doc ────────────────────────
export async function linkExistingChildren(): Promise<void> {
  if (!currentFilename || (currentDocType !== 'epic' && currentDocType !== 'feature')) return;

  const childTypes = currentDocType === 'epic' ? ['story', 'spike', 'bug'] : ['epic'];

  // Find already-linked children so we can exclude them
  const linkedFilenames = new Set<string>();
  try {
    const linkData = (await fetchJSON(
      `/api/links/${currentDocType}/${encodeURIComponent(currentFilename)}`
    )) as LinksResponse;
    for (const c of linkData.children || []) linkedFilenames.add(c.filename);
  } catch (e) {
    console.warn('Failed to load linked children:', (e as Error).message);
  }

  // Build candidates: items of the right type that aren't already linked here
  const candidates: SelectModalItem[] = allDocs
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

  const linkedItems: SelectModalItem[] = [];
  for (const item of selected as SelectModalItem[]) {
    try {
      await postJSON('/api/link', {
        sourceType: item.docType,
        sourceFilename: item.filename,
        targetType: currentDocType,
        targetFilename: currentFilename,
      });
      linkedItems.push(item);
    } catch (e) {
      console.warn(`Failed to link ${item.filename}:`, (e as Error).message);
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

export function childLabel(docType: string): string {
  return docType === 'epic' ? 'story / spike / bug' : 'epic';
}

export async function toggleHierarchyChild(rowEl: HTMLElement): Promise<void> {
  const body = rowEl.querySelector('.hierarchy-child-body') as HTMLElement;
  const chevron = rowEl.querySelector('.hierarchy-child-chevron') as HTMLElement;
  const isOpen = rowEl.classList.contains('open');

  if (isOpen) {
    rowEl.classList.remove('open');
    chevron.textContent = '▶';
    return;
  }

  rowEl.classList.add('open');
  chevron.textContent = '▼';

  if (body.dataset.loaded) return;

  const filename = rowEl.dataset.filename as string;
  const docType = rowEl.dataset.doctype as string;
  body.innerHTML = '<div class="hierarchy-loading">Loading…</div>';

  try {
    const { content } = (await fetchJSON(
      `/api/doc/${docType}/${encodeURIComponent(filename)}`
    )) as { content: string };
    body.innerHTML = `<div class="markdown hierarchy-doc-content">${renderMarkdown(stripFrontmatter(content))}</div>`;
    body.dataset.loaded = '1';
  } catch {
    body.innerHTML = '<div class="hierarchy-loading">Failed to load content.</div>';
  }
}

export function toggleHierarchy(): void {
  toggleSection('hierarchy-body', 'hierarchy-chevron', 180);
}
