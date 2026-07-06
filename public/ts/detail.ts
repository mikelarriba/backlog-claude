// ── Detail view ────────────────────────────────────────────────
import {
  fetchJSON,
  patchJSON,
  deleteJSON,
  postJSON,
  stripFrontmatter,
  escHtml,
  showJiraToast,
  toggleSection,
  TYPE_LABEL,
  STATUS_LABEL,
} from './state.js';
import type { DocEntry } from './state.js';
import { upsertDoc } from './store.js';
import { showJiraSelectModal, updateJiraPushBtn } from './jira.js';
import { getSprintsForPi } from './piconfig.js';
import { resetStoriesSection } from './stories.js';
import { closeQuickCreate } from './quickcreate.js';
import { resetUpgradePanel } from './upgrade.js';
import { isSplitMode, highlightSelectedItem } from './main.js';
import { isRoadmapOpen } from './roadmap.js';

// ── Local types ──────────────────────────────────────────────
interface Comment {
  id: string;
  text: string;
}

interface SelectModalItem {
  key: string;
  filename?: string;
  docType?: string;
  summary: string;
  type: string;
  localExists: boolean;
}

interface ChildLink {
  filename: string;
  docType: string;
  title?: string;
}

interface LinksResponse {
  parent: (DocEntry & { jiraId: string }) | null;
  children: ChildLink[];
}

export function updateJiraLink(jiraId: string | null, jiraUrl: string | null): void {
  const el = document.getElementById('detail-jira-link') as HTMLAnchorElement | null;
  if (!el) return;
  if (jiraId && jiraId !== 'TBD') {
    const resolvedUrl = jiraUrl || (jiraBase ? `${jiraBase}/browse/${jiraId}` : null);
    el.textContent = jiraId;
    el.href = resolvedUrl || '#';
    el.classList.remove('hidden');
    el.style.pointerEvents = resolvedUrl ? '' : 'none';
  } else {
    el.classList.add('hidden');
  }
}

export function updateJiraStatus(jiraStatus: string | null): void {
  const el = document.getElementById('detail-jira-status');
  if (!el) return;
  if (jiraStatus) {
    el.textContent = jiraStatus;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

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
      `<span class="dep-chip-text" onclick="openDoc('${escHtml(fn)}','${dtype}')">${icon} ${escHtml(short)}</span>` +
      `<button class="dep-chip-delete" onclick="event.stopPropagation(); deleteDepFromDetail('${escHtml(fn)}','${dtype}','${linkType}')" title="Remove dependency">&times;</button>` +
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
    const res = await fetch('/api/link', {
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
    if (!res.ok) {
      const d = (await res.json()) as { error?: { message?: string } };
      throw new Error(d.error?.message || 'Delete failed');
    }
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

export function renderDocContent(doc: DocEntry | undefined, content: string): void {
  (document.getElementById('status-select') as HTMLSelectElement).value = doc?.status || 'Draft';
  (document.getElementById('detail-filename') as HTMLElement).textContent =
    doc?.filename || currentFilename;

  const titleInput = document.getElementById('detail-title-input') as HTMLInputElement;
  const stripped = stripFrontmatter(content).replace(/\n## Comments\b[\s\S]*$/, '');
  const tplMatch = stripped.match(/^## \w[\w ]* Title\s*\n+(.+)/m);
  const h2Match = stripped.match(/^##\s+(.+)$/m);
  const docTitle = doc?.title || (tplMatch ? tplMatch[1].trim() : h2Match ? h2Match[1].trim() : '');
  titleInput.value = docTitle;
  titleInput.dataset.original = docTitle;
  (document.getElementById('detail-content') as HTMLElement).innerHTML = marked.parse(stripped);

  // JIRA Status badge (read-only, pulled from JIRA)
  const jiraStatusMatch = content.match(/^JIRA_Status:\s*(.+)$/m);
  updateJiraStatus(jiraStatusMatch ? jiraStatusMatch[1].trim() : null);

  // Render internal comments section
  _renderComments(
    _parseComments(content),
    doc?.filename || (currentFilename as string),
    doc?.docType || (currentDocType as string)
  );
}

// ── Internal comments ─────────────────────────────────────────
function _parseComments(content: string): Comment[] {
  const section = (content.match(/\n## Comments\b([\s\S]*)$/) || [])[1] || '';
  const comments: Comment[] = [];
  const re = /<!-- comment:([a-z0-9-]+) -->\n([\s\S]*?)<!-- \/comment:\1 -->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    comments.push({ id: m[1], text: m[2].trim() });
  }
  return comments;
}

function _serializeComments(comments: Comment[]): string {
  if (!comments.length) return '';
  const blocks = comments
    .map((c) => `<!-- comment:${c.id} -->\n${c.text}\n<!-- /comment:${c.id} -->`)
    .join('\n\n');
  return `## Comments\n\n${blocks}`;
}

function _renderComments(
  comments: Comment[],
  filename: string,
  docType: string,
  containerEl?: HTMLElement | null
): void {
  const section = containerEl || document.getElementById('comments-section');
  if (!section) return;

  const rows = comments
    .map(
      (c) => `
    <div class="comment-item" data-id="${escHtml(c.id)}">
      <div class="comment-body" id="comment-body-${escHtml(c.id)}">${escHtml(c.text)}</div>
      <div class="comment-edit-wrap hidden" id="comment-edit-${escHtml(c.id)}">
        <textarea class="comment-textarea" id="comment-edit-ta-${escHtml(c.id)}">${escHtml(c.text)}</textarea>
        <div class="comment-btn-row">
          <button class="btn-xs green" onclick="saveCommentEdit('${escHtml(c.id)}','${escHtml(filename)}','${escHtml(docType)}')">Save</button>
          <button class="btn-xs" onclick="cancelCommentEdit('${escHtml(c.id)}')">Cancel</button>
        </div>
      </div>
      <div class="comment-actions">
        <button class="btn-ghost btn-xs" onclick="startCommentEdit('${escHtml(c.id)}')">Edit</button>
        <button class="btn-ghost btn-xs danger-text" onclick="deleteDocComment('${escHtml(c.id)}','${escHtml(filename)}','${escHtml(docType)}')">Delete</button>
      </div>
    </div>`
    )
    .join('');

  section.innerHTML = `
    <div class="comments-header">💬 Comments</div>
    <div id="comment-list">${rows || '<div class="comment-empty">No comments yet.</div>'}</div>
    <div class="comment-add">
      <textarea class="comment-textarea" id="new-comment-ta" placeholder="Add a comment…"></textarea>
      <div class="comment-btn-row">
        <button class="btn-xs green" onclick="addDocComment('${escHtml(filename)}','${escHtml(docType)}')">Save</button>
      </div>
    </div>`;
  section.classList.remove('hidden');
}

export async function addDocComment(filename: string, docType: string): Promise<void> {
  const ta = document.getElementById('new-comment-ta') as HTMLTextAreaElement | null;
  const text = (ta?.value || '').trim();
  if (!text) {
    ta?.focus();
    return;
  }

  const id = crypto.randomUUID().split('-')[0] + Date.now().toString(36);
  const now = new Date()
    .toLocaleString('sv-SE', { timeZone: 'UTC' })
    .slice(0, 16)
    .replace('T', ' ');
  const fullText = `**${now}** — Me\n${text}`;

  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('Load failed');
    const { content } = (await res.json()) as { content: string };
    const existing = _parseComments(content);
    existing.push({ id, text: fullText });
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, {
      commentsSection: _serializeComments(existing),
    });
    (ta as HTMLTextAreaElement).value = '';
    _renderComments(existing, filename, docType);
    showJiraToast('ok', 'Comment saved');
  } catch (e) {
    showJiraToast('error', `Failed to save comment: ${(e as Error).message}`);
  }
}

export function startCommentEdit(id: string): void {
  document.getElementById(`comment-body-${id}`)?.classList.add('hidden');
  document.getElementById(`comment-edit-${id}`)?.classList.remove('hidden');
  document.getElementById(`comment-edit-ta-${id}`)?.focus();
}

export function cancelCommentEdit(id: string): void {
  document.getElementById(`comment-edit-${id}`)?.classList.add('hidden');
  document.getElementById(`comment-body-${id}`)?.classList.remove('hidden');
}

export async function saveCommentEdit(
  id: string,
  filename: string,
  docType: string
): Promise<void> {
  const ta = document.getElementById(`comment-edit-ta-${id}`) as HTMLTextAreaElement | null;
  const text = (ta?.value || '').trim();
  if (!text) return;
  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('Load failed');
    const { content } = (await res.json()) as { content: string };
    const comments = _parseComments(content).map((c) => (c.id === id ? { ...c, text } : c));
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, {
      commentsSection: _serializeComments(comments),
    });
    _renderComments(comments, filename, docType);
    showJiraToast('ok', 'Comment updated');
  } catch (e) {
    showJiraToast('error', `Failed to update comment: ${(e as Error).message}`);
  }
}

export async function deleteDocComment(
  id: string,
  filename: string,
  docType: string
): Promise<void> {
  if (!confirm('Delete this comment?')) return;
  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('Load failed');
    const { content } = (await res.json()) as { content: string };
    const comments = _parseComments(content).filter((c) => c.id !== id);
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, {
      commentsSection: _serializeComments(comments),
    });
    _renderComments(comments, filename, docType);
    showJiraToast('ok', 'Comment deleted');
  } catch (e) {
    showJiraToast('error', `Failed to delete comment: ${(e as Error).message}`);
  }
}

// ── Story points helpers ───────────────────────────────────────
export function computeChildPoints(filename: string, docType: string): number | null {
  // For epics: sum story/spike/bug children. For features: sum epic children.
  const children = allDocs.filter((d) => {
    if (docType === 'feature') return d.docType === 'epic' && d.parentFilename === filename;
    if (docType === 'epic')
      return (
        (d.docType === 'story' || d.docType === 'spike' || d.docType === 'bug') &&
        d.parentFilename === filename
      );
    return false;
  });
  if (!children.length) return null;
  let sum = 0;
  for (const c of children) {
    if (docType === 'feature') {
      // Sum the epic's own children points
      const epicChildren = allDocs.filter(
        (d) =>
          (d.docType === 'story' || d.docType === 'spike' || d.docType === 'bug') &&
          d.parentFilename === c.filename
      );
      for (const ec of epicChildren) sum += Number(ec.storyPoints) || 0;
    } else {
      sum += Number(c.storyPoints) || 0;
    }
  }
  return sum;
}

export function updateStoryPointsUI(docType: string, sp: number | null): void {
  const isLeaf = docType === 'story' || docType === 'spike' || docType === 'bug';
  const isAggr = docType === 'epic' || docType === 'feature';

  const spWrap = document.getElementById('sp-wrap') as HTMLElement;
  const spSumWrap = document.getElementById('sp-sum-wrap') as HTMLElement;
  const spInput = document.getElementById('sp-input') as HTMLInputElement;
  const spSum = document.getElementById('sp-sum') as HTMLElement;

  if (isLeaf) {
    spWrap.classList.remove('hidden');
    spSumWrap.classList.add('hidden');
    spInput.value = sp != null ? String(sp) : '';
    spInput.dataset.original = sp != null ? String(sp) : '';
  } else if (isAggr) {
    spWrap.classList.add('hidden');
    spSumWrap.classList.remove('hidden');
    const sum = computeChildPoints(currentFilename as string, docType);
    spSum.textContent = sum !== null ? String(sum) : '—';
  } else {
    spWrap.classList.add('hidden');
    spSumWrap.classList.add('hidden');
  }
}

export async function saveStoryPoints(): Promise<void> {
  const input = document.getElementById('sp-input') as HTMLInputElement;
  const newVal = input.value.trim();
  const orig = input.dataset.original || '';
  if (newVal === orig || !currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      storyPoints: newVal === '' ? null : Number(newVal),
    });
    input.dataset.original = newVal;
    const doc = allDocs.find((d) => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) upsertDoc({ ...doc, storyPoints: newVal === '' ? null : Number(newVal) });
  } catch {
    input.value = orig;
  }
}

// ── Sprint select helpers ─────────────────────────────────────
export function updateSprintSelect(
  docType: string,
  fixVersion: string | null | undefined,
  currentSprint: string | null | undefined
): void {
  const sel = document.getElementById('sprint-select') as HTMLSelectElement;
  const group = sel.closest('.detail-field-group');
  const isLeaf = docType === 'story' || docType === 'spike' || docType === 'bug';

  // Only show for leaf items that belong to a PI
  if (!isLeaf || !fixVersion) {
    sel.classList.add('hidden');
    if (group) group.classList.add('hidden');
    return;
  }

  const sprints = getSprintsForPi(fixVersion) as Array<{ name: string }>;
  if (!sprints.length) {
    sel.classList.add('hidden');
    if (group) group.classList.add('hidden');
    return;
  }

  sel.innerHTML =
    '<option value="">No Sprint</option>' +
    sprints
      .map(
        (s) =>
          `<option value="${escHtml(s.name)}"${s.name === currentSprint ? ' selected' : ''}>${escHtml(s.name)}</option>`
      )
      .join('');
  sel.value = currentSprint || '';
  sel.classList.remove('hidden');
  if (group) group.classList.remove('hidden');
}

export async function updateDocSprint(sprint: string): Promise<void> {
  if (!currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      sprint: sprint || null,
    });
    const doc = allDocs.find((d) => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) upsertDoc({ ...doc, sprint: sprint || null });
  } catch (e) {
    console.warn('Failed to save sprint:', (e as Error).message);
  }
}

// ── Team & Work Category helpers ──────────────────────────────
export function updateTeamWorkCatSelects(doc: DocEntry | undefined): void {
  (document.getElementById('detail-team-select') as HTMLSelectElement).value = doc?.team || '';
  (document.getElementById('detail-workcat-select') as HTMLSelectElement).value =
    doc?.workCategory || '';
}

export async function updateDocTeam(team: string): Promise<void> {
  if (!currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      team: team || null,
    });
    const doc = allDocs.find((d) => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) upsertDoc({ ...doc, team: team || null });
  } catch (e) {
    console.warn('Failed to save team:', (e as Error).message);
  }
}

export async function updateDocWorkCategory(workCategory: string): Promise<void> {
  if (!currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      workCategory: workCategory || null,
    });
    const doc = allDocs.find((d) => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) upsertDoc({ ...doc, workCategory: workCategory || null });
  } catch (e) {
    console.warn('Failed to save work category:', (e as Error).message);
  }
}

export function updateDocButtons(docType: string): void {
  const isEpic = docType === 'epic';
  const isFeature = docType === 'feature';
  document
    .getElementById('create-dropdown-wrap')!
    .classList.toggle('hidden', !(isEpic || isFeature));
  document.getElementById('create-epic-btn')!.classList.toggle('hidden', !isFeature);
  document.getElementById('create-story-btn')!.classList.toggle('hidden', !isEpic);
  document.getElementById('create-spike-btn')!.classList.toggle('hidden', !isEpic);
  document.getElementById('create-bug-btn')!.classList.toggle('hidden', !isEpic);
  document
    .getElementById('refine-dropdown-wrap')!
    .classList.toggle('hidden', !(isEpic || isFeature));
  document.getElementById('export-pdf-btn')!.classList.toggle('hidden', !(isEpic || isFeature));
  const storiesBtn = document.getElementById('stories-btn') as HTMLButtonElement | null;
  if (storiesBtn) {
    storiesBtn.disabled = false;
    storiesBtn.textContent = 'AI Story Generation';
  }
}

export async function openDoc(filename: string, docType: string): Promise<void> {
  if (_justDragged) return;
  try {
    const { content } = (await fetchJSON(
      `/api/doc/${docType}/${encodeURIComponent(filename)}`
    )) as { content: string };
    currentFilename = filename;
    currentDocType = docType;

    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    renderDocContent(doc, content);
    renderDetailDeps(doc);
    resetStoriesSection();
    closeQuickCreate();
    updateDocButtons(docType);

    const jiraMatch = content.match(/^JIRA_ID:\s*(.+)$/m);
    const jiraUrlMatch = content.match(/^JIRA_URL:\s*(.+)$/m);
    currentJiraId = jiraMatch ? jiraMatch[1].trim() : 'TBD';
    updateJiraLink(currentJiraId, jiraUrlMatch ? jiraUrlMatch[1].trim() : null);
    updateJiraPushBtn();
    updateStoryPointsUI(docType, doc?.storyPoints ?? null);
    updateSprintSelect(docType, doc?.fixVersion, doc?.sprint);
    updateTeamWorkCatSelects(doc);

    document.querySelector('.right')!.classList.add('has-selection');
    if (isSplitMode() || isRoadmapOpen()) {
      document.getElementById('detail-view')!.classList.add('show');
      highlightSelectedItem(filename, docType);
    } else {
      (document.getElementById('list-view') as HTMLElement).style.display = 'none';
      document.getElementById('detail-view')!.classList.add('show');
    }

    if (docType === 'epic' || docType === 'feature') loadHierarchy(filename, docType);
    else document.getElementById('hierarchy-section')!.classList.add('hidden');
    loadOriginal(filename);
  } catch (e) {
    console.error(e);
  }
}

export async function loadOriginal(filename: string): Promise<void> {
  const section = document.getElementById('original-section') as HTMLElement;
  const container = document.getElementById('original-content') as HTMLElement;

  // Reset collapsed state
  document.getElementById('original-body')!.classList.remove('open');
  (document.getElementById('original-chevron') as HTMLElement).style.transform = '';

  try {
    const { content } = (await fetchJSON(`/api/inbox/${encodeURIComponent(filename)}`)) as {
      content: string;
    };
    container.innerHTML = `<div class="original-content">${escHtml(content)}</div>`;
    section.classList.remove('hidden');
  } catch {
    section.classList.add('hidden');
  }
}

// ── Toolbar dropdowns ──────────────────────────────────────────
export function toggleDropdown(id: string): void {
  const menu = document.getElementById(id) as HTMLElement;
  const isOpen = menu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) menu.classList.add('open');
}
export function closeDropdown(id: string): void {
  document.getElementById(id)?.classList.remove('open');
}
export function closeAllDropdowns(): void {
  document.querySelectorAll('.dropdown-menu.open').forEach((m) => m.classList.remove('open'));
}
document.addEventListener('click', (e: MouseEvent) => {
  if (!(e.target as HTMLElement).closest('.dropdown-wrap')) closeAllDropdowns();
});

// ── Inline title editing ───────────────────────────────────────
export async function saveTitle(): Promise<void> {
  const input = document.getElementById('detail-title-input') as HTMLInputElement;
  const newTitle = input.value.trim();
  if (!newTitle || newTitle === input.dataset.original || !currentFilename || !currentDocType)
    return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      title: newTitle,
    });
    input.dataset.original = newTitle;
    // Re-render the heading inside the detail content without a full reload
    const contentEl = document.getElementById('detail-content') as HTMLElement;
    const h2 = contentEl.querySelector('h2');
    if (h2) h2.textContent = newTitle;
  } catch {
    input.value = input.dataset.original || '';
  }
}

export function cancelTitleEdit(): void {
  const input = document.getElementById('detail-title-input') as HTMLInputElement;
  input.value = input.dataset.original || '';
  input.blur();
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
      <div class="hierarchy-row" onclick="openDoc('${escHtml(node.filename)}','${node.docType}')">
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
    for (const child of children) rows.push(makeChildRow(child as DocEntry & { jiraId: string }));

    const parts: string[] = [];
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
    body.innerHTML = `<div class="markdown hierarchy-doc-content">${marked.parse(stripFrontmatter(content))}</div>`;
    body.dataset.loaded = '1';
  } catch {
    body.innerHTML = '<div class="hierarchy-loading">Failed to load content.</div>';
  }
}

export function toggleHierarchy(): void {
  toggleSection('hierarchy-body', 'hierarchy-chevron', 180);
}

export function toggleOriginal(): void {
  toggleSection('original-body', 'original-chevron', 180);
}

// ── Update status ──────────────────────────────────────────────
export async function updateDocStatus(status: string): Promise<void> {
  if (!currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      status,
    });
    const doc = allDocs.find((d) => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) upsertDoc({ ...doc, status });
  } catch (e) {
    console.error('Failed to update status:', (e as Error).message);
  }
}

export function showList(): void {
  document.getElementById('detail-view')!.classList.remove('show');
  document.querySelector('.right')!.classList.remove('has-selection');
  document.getElementById('upgrade-panel')!.classList.remove('open');
  document.getElementById('original-section')!.classList.add('hidden');
  resetUpgradePanel();
  closeQuickCreate();
  resetStoriesSection();
  currentFilename = null;
  currentDocType = null;
  currentJiraId = null;
  updateJiraLink(null, null);
  updateJiraStatus(null);
  document.getElementById('sp-wrap')!.classList.add('hidden');
  document.getElementById('sp-sum-wrap')!.classList.add('hidden');

  if (isRoadmapOpen()) {
    // Roadmap stays visible; just clear the selection highlight
    highlightSelectedItem(null, '');
  } else if (isSplitMode()) {
    // List is already visible — just clear the selection highlight
    highlightSelectedItem(null, '');
  } else {
    (document.getElementById('list-view') as HTMLElement).style.display = 'flex';
  }
}

// ── Delete ────────────────────────────────────────────────────
export async function confirmDelete(): Promise<void> {
  if (!currentFilename || !currentDocType) return;

  // For epics/features: check for children and show selection modal
  if (currentDocType === 'epic' || currentDocType === 'feature') {
    try {
      const data = (await fetchJSON(
        `/api/links/${currentDocType}/${encodeURIComponent(currentFilename)}`
      )) as LinksResponse;
      const children = data.children || [];
      if (children.length) {
        const doc = allDocs.find((d) => d.filename === currentFilename);
        const title = doc?.title || currentFilename;
        const items: SelectModalItem[] = children.map((c) => ({
          key: c.filename,
          summary: c.title || c.filename,
          type: TYPE_LABEL[c.docType] || c.docType,
          localExists: true,
        }));
        const selected = await showJiraSelectModal(
          `Delete "${title}" and ${children.length} child item${children.length !== 1 ? 's' : ''}?`,
          items,
          'Delete selected'
        );
        // User cancelled
        if (!selected.length && !confirm(`Delete only "${title}" without its children?`)) return;
        await executeDeleteWithChildren(
          (selected as SelectModalItem[]).map((s) => {
            const child = children.find((c) => c.filename === s.key);
            return { filename: s.key, type: child?.docType || 'story' };
          })
        );
        return;
      }
    } catch (e) {
      console.warn('Failed to fetch children for delete:', (e as Error).message);
    }
  }

  // Simple delete for leaf items or if children fetch failed
  (document.getElementById('delete-msg') as HTMLElement).textContent =
    `Delete "${currentFilename}"? This will permanently remove the file and cannot be undone.`;
  document.getElementById('delete-overlay')!.classList.add('show');
}

export function closeDeleteDialog(): void {
  document.getElementById('delete-overlay')!.classList.remove('show');
  const btn = document.getElementById('confirm-delete-btn') as HTMLButtonElement;
  btn.disabled = false;
  btn.textContent = 'Delete';
}

export async function executeDeleteWithChildren(
  childDocs: Array<{ filename: string; type: string }>
): Promise<void> {
  try {
    // Delete children first via batch endpoint
    if (childDocs.length) {
      await postJSON('/api/docs/batch-delete', {
        docs: childDocs.map((c) => ({ type: c.type, filename: c.filename })),
      });
    }
    // Delete the parent
    await deleteJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename as string)}`);
    showList();
    showJiraToast('ok', `Deleted ${childDocs.length + 1} item${childDocs.length ? 's' : ''}`);
  } catch (e) {
    showJiraToast('error', `Delete failed: ${(e as Error).message}`);
  }
}

export async function executeDelete(): Promise<void> {
  if (!currentFilename || !currentDocType) return;
  const btn = document.getElementById('confirm-delete-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    await deleteJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`);
    closeDeleteDialog();
    showList();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Delete';
    alert(`Failed to delete: ${(e as Error).message}`);
  }
}
