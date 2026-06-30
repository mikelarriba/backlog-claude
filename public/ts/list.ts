// ── Doc list coordinator ───────────────────────────────────────
import { fetchJSON, postJSON, showJiraToast, TYPE_LABEL } from './state.js';
import type { DocEntry, PISettings } from './state.js';
import { openDoc } from './detail.js';
import { getSelectedDocs, closeContextMenu } from './list-filters.js';
import { _rankSortFn } from './list-render.js';

// Note: piSettings, jiraVersions, _swimlanesCollapsed, _collapsedItems are
// now declared as store-backed globals in state.js (moved from here).

export async function moveDocRank(filename: string, docType: string, delta: number): Promise<void> {
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
  } catch (e) {
    showJiraToast('error', e instanceof Error ? e.message : String(e));
  }
}

export async function loadDocs(): Promise<void> {
  try {
    allDocs = (await fetchJSON('/api/docs')) as DocEntry[];
    // store.subscribe('allDocs', applyFilters) in main.js drives the re-render
  } catch (e) {
    console.warn('Could not load docs:', e instanceof Error ? e.message : String(e));
  }
}

export async function loadPiSettings(): Promise<void> {
  try {
    piSettings = (await fetchJSON('/api/settings/pi')) as PISettings;
  } catch (e) {
    console.warn('Failed to load PI settings:', e instanceof Error ? e.message : String(e));
  }
}

export async function loadJiraVersions(): Promise<void> {
  try {
    const data = (await fetchJSON('/api/jira/versions')) as { versions?: string[] };
    jiraVersions = data.versions || [];
  } catch {
    jiraVersions = [];
  }
}

// ── Split Issue (list view) ───────────────────────────────────
export function contextSplitItem(): void {
  closeContextMenu();
  const docs = getSelectedDocs();
  if (docs.length !== 1) return;
  const doc = docs[0];

  const modal = document.getElementById('issue-split-modal');
  if (!modal) return;

  modal.dataset.filename = doc.filename;
  modal.dataset.doctype = doc.docType;
  const badge = modal.querySelector('#issue-split-badge') as HTMLElement;
  badge.className = `type-badge ${doc.docType}`;
  badge.textContent = TYPE_LABEL[doc.docType] || doc.docType;
  (modal.querySelector('#issue-split-title') as HTMLElement).textContent =
    doc.title || doc.filename;
  (modal.querySelector('#issue-split-idea') as HTMLTextAreaElement).value = '';
  (modal.querySelector('#issue-split-status') as HTMLElement).textContent = '';
  const genBtn = modal.querySelector('#issue-split-generate-btn') as HTMLButtonElement;
  genBtn.disabled = false;
  genBtn.textContent = 'Generate';
  modal.classList.add('show');
  (modal.querySelector('#issue-split-idea') as HTMLTextAreaElement).focus();
}

export function closeIssueSplitModal(): void {
  document.getElementById('issue-split-modal')?.classList.remove('show');
}

interface GenerateBody {
  idea: string;
  type: string;
  priority: string;
  fixVersion?: string;
  pi?: string;
  parentEpic?: string;
  parentFeature?: string;
}

export async function executeSplitIssue(): Promise<void> {
  const modal = document.getElementById('issue-split-modal');
  if (!modal) return;

  const filename = modal.dataset.filename as string;
  const docType = modal.dataset.doctype as string;
  const ideaInput = modal.querySelector('#issue-split-idea') as HTMLTextAreaElement;
  const idea = ideaInput.value.trim();
  if (!idea) {
    ideaInput.focus();
    return;
  }

  const btn = modal.querySelector('#issue-split-generate-btn') as HTMLButtonElement;
  const status = modal.querySelector('#issue-split-status') as HTMLElement;
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
      if (!splitRes.ok) {
        const errBody = (await splitRes.json()) as { error?: { message?: string } };
        throw new Error(errBody.error?.message || 'Split failed');
      }
      const result = (await splitRes.json()) as {
        newEpicFilename: string;
        featureCreated?: boolean;
        featureTitle?: string;
      };

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
    const { content: origContent } = (await origRes.json()) as { content: string };
    const origDoc = allDocs.find((d) => d.filename === filename && d.docType === docType);

    status.textContent = '⚙ Generating new issue…';

    const genBody: GenerateBody = {
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

    const genRes = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(genBody),
    });
    if (!genRes.ok) {
      const errBody = (await genRes.json()) as { error?: { message?: string } };
      throw new Error(errBody.error?.message || 'Generate failed');
    }
    const { filename: newFilename } = (await genRes.json()) as { filename: string };

    status.textContent = `✓ Created ${newFilename}`;

    // Link to same parent if original has one
    if (origDoc?.parentFilename) {
      const parentDoc = allDocs.find((d) => d.filename === origDoc.parentFilename);
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
    status.textContent = `❌ ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}
