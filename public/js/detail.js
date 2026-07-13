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
  renderMarkdown,
} from './state.js';
import { upsertDoc } from './store.js';
import { showJiraSelectModal } from './jira-import.js';
import { updateJiraPushBtn } from './jira-push.js';
import { resetStoriesSection } from './stories.js';
import { closeQuickCreate } from './quickcreate.js';
import { resetUpgradePanel } from './upgrade.js';
import { isSplitMode, highlightSelectedItem } from './main.js';
import { isRoadmapOpen } from './roadmap.js';
import {
  updateStoryPointsUI,
  updateSprintSelect,
  updateTeamWorkCatSelects,
  _renderComments,
  _parseComments,
} from './detail-fields.js';
import { loadHierarchy, renderDetailDeps } from './detail-links.js';
export function updateJiraLink(jiraId, jiraUrl) {
  const el = document.getElementById('detail-jira-link');
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
export function updateJiraStatus(jiraStatus) {
  const el = document.getElementById('detail-jira-status');
  if (!el) return;
  if (jiraStatus) {
    el.textContent = jiraStatus;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}
export function renderDocContent(doc, content) {
  document.getElementById('status-select').value = doc?.status || 'Draft';
  document.getElementById('detail-filename').textContent = doc?.filename || currentFilename;
  const titleInput = document.getElementById('detail-title-input');
  const stripped = stripFrontmatter(content).replace(/\n## Comments\b[\s\S]*$/, '');
  const tplMatch = stripped.match(/^## \w[\w ]* Title\s*\n+(.+)/m);
  const h2Match = stripped.match(/^##\s+(.+)$/m);
  const docTitle = doc?.title || (tplMatch ? tplMatch[1].trim() : h2Match ? h2Match[1].trim() : '');
  titleInput.value = docTitle;
  titleInput.dataset.original = docTitle;
  document.getElementById('detail-content').innerHTML = renderMarkdown(stripped);
  // JIRA Status badge (read-only, pulled from JIRA)
  const jiraStatusMatch = content.match(/^JIRA_Status:\s*(.+)$/m);
  updateJiraStatus(jiraStatusMatch ? jiraStatusMatch[1].trim() : null);
  // Render internal comments section
  _renderComments(
    _parseComments(content),
    doc?.filename || currentFilename,
    doc?.docType || currentDocType
  );
}
export function updateDocButtons(docType) {
  const isEpic = docType === 'epic';
  const isFeature = docType === 'feature';
  document
    .getElementById('create-dropdown-wrap')
    .classList.toggle('hidden', !(isEpic || isFeature));
  document.getElementById('create-epic-btn').classList.toggle('hidden', !isFeature);
  document.getElementById('create-story-btn').classList.toggle('hidden', !isEpic);
  document.getElementById('create-spike-btn').classList.toggle('hidden', !isEpic);
  document.getElementById('create-bug-btn').classList.toggle('hidden', !isEpic);
  document
    .getElementById('refine-dropdown-wrap')
    .classList.toggle('hidden', !(isEpic || isFeature));
  document.getElementById('export-pdf-btn').classList.toggle('hidden', !(isEpic || isFeature));
  const storiesBtn = document.getElementById('stories-btn');
  if (storiesBtn) {
    storiesBtn.disabled = false;
    storiesBtn.textContent = 'AI Story Generation';
  }
}
export async function openDoc(filename, docType) {
  if (_justDragged) return;
  try {
    const { content } = await fetchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
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
export async function loadOriginal(filename) {
  const section = document.getElementById('original-section');
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
export function toggleDropdown(id) {
  const menu = document.getElementById(id);
  const isOpen = menu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) menu.classList.add('open');
}
export function closeDropdown(id) {
  document.getElementById(id)?.classList.remove('open');
}
export function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu.open').forEach((m) => m.classList.remove('open'));
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown-wrap')) closeAllDropdowns();
});
// ── Inline title editing ───────────────────────────────────────
export async function saveTitle() {
  const input = document.getElementById('detail-title-input');
  const newTitle = input.value.trim();
  if (!newTitle || newTitle === input.dataset.original || !currentFilename || !currentDocType)
    return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      title: newTitle,
    });
    input.dataset.original = newTitle;
    // Re-render the heading inside the detail content without a full reload
    const contentEl = document.getElementById('detail-content');
    const h2 = contentEl.querySelector('h2');
    if (h2) h2.textContent = newTitle;
  } catch {
    input.value = input.dataset.original || '';
  }
}
export function cancelTitleEdit() {
  const input = document.getElementById('detail-title-input');
  input.value = input.dataset.original || '';
  input.blur();
}
export function toggleOriginal() {
  toggleSection('original-body', 'original-chevron', 180);
}
// ── Update status ──────────────────────────────────────────────
export async function updateDocStatus(status) {
  if (!currentFilename || !currentDocType) return;
  try {
    await patchJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`, {
      status,
    });
    const doc = allDocs.find((d) => d.filename === currentFilename && d.docType === currentDocType);
    if (doc) upsertDoc({ ...doc, status });
  } catch (e) {
    console.error('Failed to update status:', e.message);
  }
}
export function showList() {
  document.getElementById('detail-view').classList.remove('show');
  document.querySelector('.right').classList.remove('has-selection');
  document.getElementById('upgrade-panel').classList.remove('open');
  document.getElementById('original-section').classList.add('hidden');
  resetUpgradePanel();
  closeQuickCreate();
  resetStoriesSection();
  currentFilename = null;
  currentDocType = null;
  currentJiraId = null;
  updateJiraLink(null, null);
  updateJiraStatus(null);
  document.getElementById('sp-wrap').classList.add('hidden');
  document.getElementById('sp-sum-wrap').classList.add('hidden');
  if (isRoadmapOpen()) {
    // Roadmap stays visible; just clear the selection highlight
    highlightSelectedItem(null, '');
  } else if (isSplitMode()) {
    // List is already visible — just clear the selection highlight
    highlightSelectedItem(null, '');
  } else {
    document.getElementById('list-view').style.display = 'flex';
  }
}
// ── Delete ────────────────────────────────────────────────────
export async function confirmDelete() {
  if (!currentFilename || !currentDocType) return;
  // For epics/features: check for children and show selection modal
  if (currentDocType === 'epic' || currentDocType === 'feature') {
    try {
      const data = await fetchJSON(
        `/api/links/${currentDocType}/${encodeURIComponent(currentFilename)}`
      );
      const children = data.children || [];
      if (children.length) {
        const doc = allDocs.find((d) => d.filename === currentFilename);
        const title = doc?.title || currentFilename;
        const items = children.map((c) => ({
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
          selected.map((s) => {
            const child = children.find((c) => c.filename === s.key);
            return { filename: s.key, type: child?.docType || 'story' };
          })
        );
        return;
      }
    } catch (e) {
      console.warn('Failed to fetch children for delete:', e.message);
    }
  }
  // Simple delete for leaf items or if children fetch failed
  document.getElementById('delete-msg').textContent =
    `Delete "${currentFilename}"? This will permanently remove the file and cannot be undone.`;
  document.getElementById('delete-overlay').classList.add('show');
}
export function closeDeleteDialog() {
  document.getElementById('delete-overlay').classList.remove('show');
  const btn = document.getElementById('confirm-delete-btn');
  btn.disabled = false;
  btn.textContent = 'Delete';
}
export async function executeDeleteWithChildren(childDocs) {
  try {
    // Delete children first via batch endpoint
    if (childDocs.length) {
      await postJSON('/api/docs/batch-delete', {
        docs: childDocs.map((c) => ({ type: c.type, filename: c.filename })),
      });
    }
    // Delete the parent
    await deleteJSON(`/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}`);
    showList();
    showJiraToast('ok', `Deleted ${childDocs.length + 1} item${childDocs.length ? 's' : ''}`);
  } catch (e) {
    showJiraToast('error', `Delete failed: ${e.message}`);
  }
}
export async function executeDelete() {
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
//# sourceMappingURL=detail.js.map
