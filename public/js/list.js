// ── Doc list coordinator ───────────────────────────────────────
import { fetchJSON, postJSON, showJiraToast, TYPE_LABEL } from './state.js';
import { openDoc } from './detail.js';
import { getSelectedDocs, closeContextMenu } from './list-filters.js';
import { _rankSortFn } from './list-render.js';
import { upsertDoc } from './store.js';
// Note: piSettings, jiraVersions, _swimlanesCollapsed, _collapsedItems are
// now declared as store-backed globals in state.js (moved from here).
export async function moveDocRank(filename, docType, delta) {
  const group = allDocs.filter((d) => d.docType === docType);
  const sorted = [...group].sort(_rankSortFn);
  const idx = sorted.findIndex((d) => d.filename === filename);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= sorted.length) return;
  // Swap the two items in the ordered list
  [sorted[idx], sorted[newIdx]] = [sorted[newIdx], sorted[idx]];
  try {
    await postJSON('/api/docs/rerank', {
      type: docType,
      orderedFilenames: sorted.map((d) => d.filename),
    });
    // The server assigns rank = index + 1 for every entry in orderedFilenames —
    // apply that same deterministic update locally instead of refetching the
    // full doc list.
    sorted.forEach((d, i) => upsertDoc({ ...d, rank: i + 1 }));
  } catch (e) {
    showJiraToast('error', e instanceof Error ? e.message : String(e));
  }
}
export async function loadDocs() {
  try {
    allDocs = await fetchJSON('/api/docs');
    // store.subscribe('allDocs', applyFilters) in main.js drives the re-render
  } catch (e) {
    console.warn('Could not load docs:', e instanceof Error ? e.message : String(e));
  }
}
export async function loadPiSettings() {
  try {
    piSettings = await fetchJSON('/api/settings/pi');
  } catch (e) {
    console.warn('Failed to load PI settings:', e instanceof Error ? e.message : String(e));
  }
}
export async function loadJiraVersions() {
  try {
    const data = await fetchJSON('/api/jira/versions');
    jiraVersions = data.versions || [];
  } catch {
    jiraVersions = [];
  }
}
// ── Split Issue (list view) ───────────────────────────────────
export function contextSplitItem() {
  closeContextMenu();
  const docs = getSelectedDocs();
  if (docs.length !== 1) return;
  const doc = docs[0];
  const modal = document.getElementById('issue-split-modal');
  if (!modal) return;
  modal.dataset.filename = doc.filename;
  modal.dataset.doctype = doc.docType;
  const badge = modal.querySelector('#issue-split-badge');
  badge.className = `type-badge ${doc.docType}`;
  badge.textContent = TYPE_LABEL[doc.docType] || doc.docType;
  modal.querySelector('#issue-split-title').textContent = doc.title || doc.filename;
  modal.querySelector('#issue-split-idea').value = '';
  modal.querySelector('#issue-split-status').textContent = '';
  const genBtn = modal.querySelector('#issue-split-generate-btn');
  genBtn.disabled = false;
  genBtn.textContent = 'Generate';
  modal.classList.add('show');
  modal.querySelector('#issue-split-idea').focus();
}
export function closeIssueSplitModal() {
  document.getElementById('issue-split-modal')?.classList.remove('show');
}
export async function executeSplitIssue() {
  const modal = document.getElementById('issue-split-modal');
  if (!modal) return;
  const filename = modal.dataset.filename;
  const docType = modal.dataset.doctype;
  const ideaInput = modal.querySelector('#issue-split-idea');
  const idea = ideaInput.value.trim();
  if (!idea) {
    ideaInput.focus();
    return;
  }
  const btn = modal.querySelector('#issue-split-generate-btn');
  const status = modal.querySelector('#issue-split-status');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  status.textContent = '⚙ Generating…';
  try {
    // Epic splitting uses the composite /api/split-epic endpoint
    if (docType === 'epic') {
      status.textContent = '⚙ Splitting epic…';
      const result = await postJSON('/api/split-epic', {
        epicFilename: filename,
        description: idea,
      });
      status.textContent = `✓ Created ${result.newEpicFilename}`;
      if (result.featureCreated) {
        showJiraToast('ok', `Created feature "${result.featureTitle}" and new epic`);
      } else {
        showJiraToast('ok', `Created ${result.newEpicFilename}`);
      }
      await loadDocs();
      closeIssueSplitModal();
      setTimeout(() => openDoc(result.newEpicFilename, 'epic'), 100);
      return;
    }
    // Non-epic splitting: existing generate + link flow
    status.textContent = '⚙ Fetching original…';
    const { content: origContent } = await fetchJSON(
      `/api/doc/${docType}/${encodeURIComponent(filename)}`
    );
    const origDoc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    status.textContent = '⚙ Generating new issue…';
    const genBody = {
      idea: `${idea}\n\n---\nContext from original issue:\n${origContent}`,
      type: docType,
      priority: origDoc?.priority || 'Medium',
    };
    if (origDoc?.fixVersion) genBody.fixVersion = origDoc.fixVersion;
    if (origDoc?.pi && origDoc.pi !== 'TBD') genBody.pi = origDoc.pi;
    if (origDoc?.parentFilename) {
      const parentDoc = allDocs.find((d) => d.filename === origDoc.parentFilename);
      if (parentDoc?.docType === 'epic') genBody.parentEpic = origDoc.parentFilename;
      if (parentDoc?.docType === 'feature') genBody.parentFeature = origDoc.parentFilename;
    }
    const { filename: newFilename } = await postJSON('/api/generate', genBody);
    status.textContent = `✓ Created ${newFilename}`;
    // Link to same parent if original has one
    if (origDoc?.parentFilename) {
      const parentDoc = allDocs.find((d) => d.filename === origDoc.parentFilename);
      if (parentDoc) {
        await postJSON('/api/link', {
          sourceType: docType,
          sourceFilename: newFilename,
          targetType: parentDoc.docType,
          targetFilename: origDoc.parentFilename,
        });
      }
    }
    showJiraToast('ok', `Created ${newFilename}`);
    await loadDocs();
    closeIssueSplitModal();
    // Open new issue in detail view
    setTimeout(() => openDoc(newFilename, docType), 100);
  } catch (e) {
    status.textContent = `❌ ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}
//# sourceMappingURL=list.js.map
