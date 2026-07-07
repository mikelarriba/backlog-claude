// ── Detail view: metadata field editors ─────────────────────────
// Comments, story points, sprint select, and team/category editing —
// the small per-field editors shown in the detail view's header/body.
import { fetchJSON, patchJSON, escHtml, showJiraToast } from './state.js';
import type { DocEntry } from './state.js';
import { upsertDoc } from './store.js';
import { getSprintsForPi } from './piconfig.js';

// ── Local types ──────────────────────────────────────────────
interface Comment {
  id: string;
  text: string;
}

// ── Internal comments ─────────────────────────────────────────
export function _parseComments(content: string): Comment[] {
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

export function _renderComments(
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
    const { content } = (await fetchJSON(
      `/api/doc/${docType}/${encodeURIComponent(filename)}`
    )) as { content: string };
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
    const { content } = (await fetchJSON(
      `/api/doc/${docType}/${encodeURIComponent(filename)}`
    )) as { content: string };
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
    const { content } = (await fetchJSON(
      `/api/doc/${docType}/${encodeURIComponent(filename)}`
    )) as { content: string };
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
