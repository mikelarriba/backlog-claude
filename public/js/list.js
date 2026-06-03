// ── Doc list coordinator ───────────────────────────────────────
import { fetchJSON, postJSON, showJiraToast, TYPE_LABEL } from './state.js';
import { openDoc } from './detail.js';
import { getSelectedDocs, closeContextMenu } from './list-filters.js';
import { _rankSortFn } from './list-render.js';

// Note: piSettings, jiraVersions, _swimlanesCollapsed, _collapsedItems are
// now declared as store-backed globals in state.js (moved from here).

export async function moveDocRank(filename, docType, delta) {
  const group  = allDocs.filter(d => d.docType === docType);
  const sorted = [...group].sort(_rankSortFn);
  const idx    = sorted.findIndex(d => d.filename === filename);
  if (idx < 0) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= sorted.length) return;

  // Swap the two items in the ordered list
  [sorted[idx], sorted[newIdx]] = [sorted[newIdx], sorted[idx]];

  try {
    await postJSON('/api/docs/rerank', { type: docType, orderedFilenames: sorted.map(d => d.filename) });
  } catch (e) {
    showJiraToast('error', e.message);
  }
}

export async function loadDocs() {
  try {
    allDocs = await fetchJSON('/api/docs');
    // store.subscribe('allDocs', applyFilters) in main.js drives the re-render
  } catch (e) {
    console.warn('Could not load docs:', e.message);
  }
}

export async function loadPiSettings() {
  try {
    piSettings = await fetchJSON('/api/settings/pi');
  } catch (e) { console.warn('Failed to load PI settings:', e.message); }
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
  modal.dataset.doctype  = doc.docType;
  modal.querySelector('#issue-split-badge').className = `type-badge ${doc.docType}`;
  modal.querySelector('#issue-split-badge').textContent = TYPE_LABEL[doc.docType] || doc.docType;
  modal.querySelector('#issue-split-title').textContent = doc.title || doc.filename;
  modal.querySelector('#issue-split-idea').value = '';
  modal.querySelector('#issue-split-status').textContent = '';
  modal.querySelector('#issue-split-generate-btn').disabled = false;
  modal.querySelector('#issue-split-generate-btn').textContent = 'Generate';
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
  const docType  = modal.dataset.doctype;
  const idea     = modal.querySelector('#issue-split-idea').value.trim();
  if (!idea) { modal.querySelector('#issue-split-idea').focus(); return; }

  const btn    = modal.querySelector('#issue-split-generate-btn');
  const status = modal.querySelector('#issue-split-status');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  status.textContent = '⚙ Generating…';

  try {
    // Epic splitting uses the composite /api/split-epic endpoint
    if (docType === 'epic') {
      status.textContent = '⚙ Splitting epic…';
      const splitRes = await fetch('/api/split-epic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epicFilename: filename, description: idea }),
      });
      if (!splitRes.ok) throw new Error((await splitRes.json()).error?.message || 'Split failed');
      const result = await splitRes.json();

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
    const origRes = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    if (!origRes.ok) throw new Error('Could not load original issue');
    const { content: origContent } = await origRes.json();
    const origDoc = allDocs.find(d => d.filename === filename && d.docType === docType);

    status.textContent = '⚙ Generating new issue…';

    const genBody = {
      idea: `${idea}\n\n---\nContext from original issue:\n${origContent}`,
      type: docType,
      priority: origDoc?.priority || 'Medium',
    };
    if (origDoc?.fixVersion) genBody.fixVersion = origDoc.fixVersion;
    if (origDoc?.pi && origDoc.pi !== 'TBD') genBody.pi = origDoc.pi;
    if (origDoc?.parentFilename) {
      const parentDoc = allDocs.find(d => d.filename === origDoc.parentFilename);
      if (parentDoc?.docType === 'epic')    genBody.parentEpic    = origDoc.parentFilename;
      if (parentDoc?.docType === 'feature') genBody.parentFeature = origDoc.parentFilename;
    }

    const genRes = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(genBody),
    });
    if (!genRes.ok) throw new Error((await genRes.json()).error?.message || 'Generate failed');
    const { filename: newFilename } = await genRes.json();

    status.textContent = `✓ Created ${newFilename}`;

    // Link to same parent if original has one
    if (origDoc?.parentFilename) {
      const parentDoc = allDocs.find(d => d.filename === origDoc.parentFilename);
      if (parentDoc) {
        await fetch('/api/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceType: docType,
            sourceFilename: newFilename,
            targetType: parentDoc.docType,
            targetFilename: origDoc.parentFilename,
          }),
        });
      }
    }

    showJiraToast('ok', `Created ${newFilename}`);
    await loadDocs();
    closeIssueSplitModal();

    // Open new issue in detail view
    setTimeout(() => openDoc(newFilename, docType), 100);
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}
