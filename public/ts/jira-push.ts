// ── JIRA push: sync-preview modal + push-to-JIRA flow ───────────
// The sync-preview confirmation modal is shared infrastructure used both
// here (push) and by the pull/update flow in jira-pull.ts.
import { fetchJSON, postJSON, escHtml, showJiraToast, TYPE_LABEL } from './state.js';
import { openDoc, closeAllDropdowns } from './detail.js';
import { logAiSaving } from './ai-savings.js';

// ── Sync preview confirmation modal ──────────────────────────
interface SyncPreviewChange {
  field: string;
  message?: string;
  from?: unknown;
  to?: unknown;
  pendingEpicTitle?: string;
  pendingFeatureTitle?: string;
}

export interface SyncPreviewItem {
  action?: 'create' | 'update' | 'delete';
  jiraKey?: string;
  jiraId?: string;
  jiraTitle?: string;
  title?: string;
  changes?: SyncPreviewChange[];
  reason?: string;
  docType?: string;
  localDocType?: string;
  autoIncluded?: boolean;
  filename?: string;
  localFilename?: string;
  localDocType2?: string;
  changesArray?: SyncPreviewChange[];
}

let _syncPreviewResolve: ((items: SyncPreviewItem[] | null) => void) | null = null;
let _syncPreviewItems: SyncPreviewItem[] = [];

export function showSyncPreviewModal(
  title: string,
  items: SyncPreviewItem[],
  confirmLabel?: string
): Promise<SyncPreviewItem[] | null> {
  return new Promise(function (resolve) {
    _syncPreviewResolve = resolve;
    _syncPreviewItems = items;

    document.getElementById('sync-preview-title')!.textContent = title;
    document.getElementById('sync-preview-confirm-btn')!.textContent = confirmLabel || 'Confirm';

    const createCount = items.filter((i) => i.action === 'create').length;
    const updateCount = items.filter((i) => i.action === 'update').length;
    const deleteCount = items.filter((i) => i.action === 'delete').length;
    const parts: string[] = [];
    if (createCount) parts.push(`${createCount} new`);
    if (updateCount) parts.push(`${updateCount} update`);
    if (deleteCount) parts.push(`${deleteCount} to delete`);
    document.getElementById('sync-preview-counts')!.textContent = parts.join(' · ');

    const list = document.getElementById('sync-preview-list')!;
    list.innerHTML = items
      .map(function (item, idx) {
        const isCreate = item.action === 'create';
        const isDelete = item.action === 'delete';
        const keyLabel = item.jiraKey || item.jiraId || '';
        const titleText = item.jiraTitle || item.title || '';

        let changesHtml = '';
        if (item.changes && item.changes.length > 0) {
          changesHtml =
            '<div class="sync-preview-changes">' +
            item.changes
              .map(function (c) {
                if (c.field === 'error')
                  return (
                    '<div class="sync-preview-change"><span class="sync-preview-field">error</span><span class="sync-preview-to" style="color:var(--error-text)">' +
                    escHtml(c.message || '') +
                    '</span></div>'
                  );
                if (c.field === 'description')
                  return (
                    '<div class="sync-preview-change"><span class="sync-preview-field">description</span><span class="sync-preview-to">' +
                    (isCreate ? 'new' : 'will sync') +
                    '</span></div>'
                  );
                const fromHtml =
                  c.from !== undefined && c.from !== null
                    ? '<span class="sync-preview-from">' +
                      escHtml(String(c.from)) +
                      '</span><span class="sync-preview-arrow">→</span>'
                    : '';
                let toHtml: string;
                if (c.pendingEpicTitle) {
                  toHtml =
                    '<span class="sync-preview-to" style="color:var(--accent)">[new] ' +
                    escHtml(c.pendingEpicTitle) +
                    '</span>';
                } else if (c.pendingFeatureTitle) {
                  toHtml =
                    '<span class="sync-preview-to" style="color:var(--accent)">[new] ' +
                    escHtml(c.pendingFeatureTitle) +
                    '</span>';
                } else if (c.to !== undefined && c.to !== null) {
                  toHtml = '<span class="sync-preview-to">' + escHtml(String(c.to)) + '</span>';
                } else {
                  toHtml = '<span class="sync-preview-to" style="color:var(--muted)">—</span>';
                }
                return (
                  '<div class="sync-preview-change"><span class="sync-preview-field">' +
                  escHtml(c.field) +
                  '</span>' +
                  fromHtml +
                  toHtml +
                  '</div>'
                );
              })
              .join('') +
            '</div>';
        } else if (!isCreate && !isDelete) {
          changesHtml = '<div class="sync-preview-no-changes">No field changes detected</div>';
        }
        if (isDelete && item.reason) {
          changesHtml +=
            '<div class="sync-preview-changes"><div class="sync-preview-change"><span class="sync-preview-field">reason</span><span class="sync-preview-to" style="color:var(--error-text)">' +
            escHtml(item.reason) +
            '</span></div></div>';
        }

        const typeLabel = item.docType || item.localDocType || '';
        const typeBadge = typeLabel
          ? '<span class="type-badge ' +
            escHtml(typeLabel) +
            '" style="font-size:0.6rem;padding:1px 6px">' +
            escHtml((TYPE_LABEL && TYPE_LABEL[typeLabel]) || typeLabel) +
            '</span>'
          : '';

        const actionClass = isDelete ? 'delete' : isCreate ? 'create' : 'update';
        const actionLabel = isDelete
          ? '✕ Delete'
          : isCreate
            ? item.autoIncluded
              ? '+ Create (auto)'
              : '+ Create'
            : '↺ Update';
        const unchecked = ' checked';

        return (
          '<div class="sync-preview-item' +
          (isDelete ? ' sync-preview-item--delete' : '') +
          '">' +
          '<label class="sync-preview-item-header">' +
          '<input type="checkbox"' +
          unchecked +
          ' data-idx="' +
          idx +
          '" class="sync-preview-cb" />' +
          '<span class="sync-preview-action ' +
          actionClass +
          '">' +
          actionLabel +
          '</span>' +
          typeBadge +
          '<span class="sync-preview-item-title">' +
          escHtml(titleText) +
          '</span>' +
          (keyLabel ? '<span class="sync-preview-item-key">' + escHtml(keyLabel) + '</span>' : '') +
          '</label>' +
          changesHtml +
          '</div>'
        );
      })
      .join('');

    document.getElementById('sync-preview-overlay')!.classList.add('show');
    document.querySelectorAll('#sync-preview-list .sync-preview-cb').forEach(function (cb) {
      cb.addEventListener('change', _syncPreviewUpdateCount);
    });
    _syncPreviewUpdateCount();
  });
}

function _syncPreviewUpdateCount(): void {
  const total = document.querySelectorAll('#sync-preview-list .sync-preview-cb').length;
  const checked = document.querySelectorAll('#sync-preview-list .sync-preview-cb:checked').length;
  const btn = document.getElementById('sync-preview-confirm-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.textContent = `Confirm (${checked}/${total})`;
  btn.disabled = checked === 0;
}

export function syncPreviewSelectAll(checked: boolean): void {
  document
    .querySelectorAll<HTMLInputElement>('#sync-preview-list .sync-preview-cb')
    .forEach(function (cb) {
      cb.checked = checked;
    });
  _syncPreviewUpdateCount();
}

export function syncPreviewCancel(): void {
  document.getElementById('sync-preview-overlay')!.classList.remove('show');
  if (_syncPreviewResolve) {
    _syncPreviewResolve(null);
    _syncPreviewResolve = null;
  }
}

export function syncPreviewConfirm(): void {
  const selected = Array.from(
    document.querySelectorAll<HTMLInputElement>('#sync-preview-list .sync-preview-cb:checked')
  ).map(function (cb) {
    return _syncPreviewItems[parseInt(cb.dataset.idx!)];
  });
  _enterSyncProgressMode();
  if (_syncPreviewResolve) {
    _syncPreviewResolve(selected);
    _syncPreviewResolve = null;
  }
}

function _enterSyncProgressMode(): void {
  (document.getElementById('sync-preview-list') as HTMLElement).style.display = 'none';
  const actionsEl = document.querySelector<HTMLElement>('#sync-preview-overlay .dialog-actions');
  if (actionsEl) actionsEl.style.display = 'none';
  const rightHeader = document.querySelector<HTMLElement>(
    '.sync-preview-header .sync-preview-header-right'
  );
  if (rightHeader) rightHeader.style.display = 'none';
  const progressArea = document.getElementById('sync-progress-area');
  if (progressArea) progressArea.style.display = '';
  const labelEl = document.getElementById('sync-progress-label');
  if (labelEl) labelEl.textContent = 'Starting…';
  const bar = document.getElementById('sync-progress-bar') as HTMLElement | null;
  if (bar) bar.style.width = '0%';
  const summary = document.getElementById('sync-progress-summary');
  if (summary) {
    summary.textContent = '';
    summary.className = 'sync-progress-summary';
  }
}

export function updateJiraProgress(current: number, total: number, label: string): void {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = document.getElementById('sync-progress-bar') as HTMLElement | null;
  if (bar) bar.style.width = pct + '%';
  const labelEl = document.getElementById('sync-progress-label');
  if (labelEl) labelEl.textContent = label;
}

export function finishJiraProgress(summaryText: string, hasError: boolean): void {
  const bar = document.getElementById('sync-progress-bar') as HTMLElement | null;
  if (bar) bar.style.width = '100%';
  const labelEl = document.getElementById('sync-progress-label');
  if (labelEl) labelEl.textContent = hasError ? 'Finished with errors' : 'All done ✅';
  const summary = document.getElementById('sync-progress-summary') as HTMLElement | null;
  if (summary) {
    summary.style.whiteSpace = 'pre-wrap';
    summary.textContent = summaryText;
    summary.className = 'sync-progress-summary' + (hasError ? ' error' : ' success');
  }
  setTimeout(_resetSyncProgressModal, hasError ? 5000 : 2500);
}

function _resetSyncProgressModal(): void {
  const overlay = document.getElementById('sync-preview-overlay');
  if (overlay) overlay.classList.remove('show');
  const list = document.getElementById('sync-preview-list') as HTMLElement | null;
  if (list) list.style.display = '';
  const actionsEl = document.querySelector<HTMLElement>('#sync-preview-overlay .dialog-actions');
  if (actionsEl) actionsEl.style.display = '';
  const rightHeader = document.querySelector<HTMLElement>(
    '.sync-preview-header .sync-preview-header-right'
  );
  if (rightHeader) rightHeader.style.display = '';
  const progressArea = document.getElementById('sync-progress-area') as HTMLElement | null;
  if (progressArea) progressArea.style.display = 'none';
  if (_syncPreviewResolve) {
    _syncPreviewResolve(null);
    _syncPreviewResolve = null;
  }
}

// ── Push to JIRA ──────────────────────────────────────────────
const JIRA_CARET = ' <span class="toolbar-caret">▾</span>';

export function updateJiraPushBtn(): void {
  const btn = document.getElementById('jira-push-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const isMultiStory = currentDocType === 'story' && currentFilename?.endsWith('-stories.md');
  btn.innerHTML = (isMultiStory ? '↑ Push Stories' : '↑ JIRA') + JIRA_CARET;
  btn.disabled = false;
}

export interface PushPreviewItem extends SyncPreviewItem {
  filename?: string;
  docType?: string;
}

export async function pushToJira(): Promise<void> {
  if (!currentFilename || !currentDocType) return;

  const btn = document.getElementById('jira-push-btn') as HTMLButtonElement | null;

  // 1. Collect all items: parent + all linked children (no pre-selection modal)
  const itemsToPush: { filename: string; docType: string }[] = [
    { filename: currentFilename, docType: currentDocType },
  ];

  if (currentDocType === 'feature' || currentDocType === 'epic') {
    try {
      const linksData = (await fetchJSON(
        `/api/links/${currentDocType}/${encodeURIComponent(currentFilename)}`
      )) as { children?: { filename: string; docType: string }[] };
      const localChildren = linksData.children || [];
      for (const c of localChildren) {
        itemsToPush.push({ filename: c.filename, docType: c.docType });
        // For feature push: also include grandchildren (stories/spikes/bugs under epics)
        if (currentDocType === 'feature' && c.docType === 'epic') {
          try {
            const epicLinks = (await fetchJSON(
              `/api/links/epic/${encodeURIComponent(c.filename)}`
            )) as { children?: { filename: string; docType: string }[] };
            for (const gc of epicLinks.children || []) {
              itemsToPush.push({ filename: gc.filename, docType: gc.docType });
            }
          } catch (e) {
            console.warn('Failed to load grandchildren for push:', (e as Error).message);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load children for push:', (e as Error).message);
    }
  }

  // 2. Fetch push preview for all items
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Loading preview…' + JIRA_CARET;
  }
  closeAllDropdowns();

  let previewItems: PushPreviewItem[];
  try {
    const preview = (await postJSON('/api/jira/push-preview', { items: itemsToPush })) as {
      items?: PushPreviewItem[];
    };
    previewItems = preview.items || [];
  } catch (e) {
    showJiraToast('error', `❌ Preview failed: ${(e as Error).message}`);
    updateJiraPushBtn();
    return;
  }

  // Sort: create-features first, then create-epics, then create-others,
  // then update-features, update-epics, update-others.
  // This ensures features are created before epics (for "Is Contained" links)
  // and epics before stories (for Epic Link fields).
  previewItems.sort(function (a, b) {
    const typeOrder: Record<string, number> = { feature: 0, epic: 1 };
    const aOrder = (a.action === 'create' ? 0 : 3) + (typeOrder[a.docType ?? ''] ?? 2);
    const bOrder = (b.action === 'create' ? 0 : 3) + (typeOrder[b.docType ?? ''] ?? 2);
    return aOrder - bOrder;
  });

  // 3. Show unified confirmation popup with checkboxes
  const selected = await showSyncPreviewModal(
    '↑ Push to JIRA — Preview',
    previewItems,
    `Push ${previewItems.length} item${previewItems.length !== 1 ? 's' : ''}`
  );

  if (!selected) {
    updateJiraPushBtn();
    return;
  }

  // 4. Execute push for each selected item with progress tracking
  const results: { key?: string; action?: string; docType?: string }[] = [];
  const errorMessages: string[] = [];
  for (let idx = 0; idx < selected.length; idx++) {
    const item = selected[idx] as PushPreviewItem;
    const fn = item.filename;
    const dt = item.docType;
    if (!fn || !dt) continue;
    const jiraKey = item.jiraKey || item.jiraId || item.title || fn;
    updateJiraProgress(idx, selected.length, `Pushing ${jiraKey} (${idx + 1}/${selected.length})…`);
    try {
      const data = (await postJSON(
        `/api/jira/push/${dt}/${encodeURIComponent(fn)}`,
        undefined
      )) as {
        type?: string;
        results?: { key?: string; action?: string }[];
        key?: string;
        action?: string;
      };
      if (data.type === 'multi-story') {
        for (const r of data.results || []) results.push({ ...r, docType: dt });
      } else {
        results.push({ key: data.key, action: data.action, docType: dt });
      }
    } catch (e) {
      console.warn(`Failed to push ${fn}:`, (e as Error).message);
      errorMessages.push(`${jiraKey}: ${(e as Error).message}`);
    }
  }

  const created = results.filter((r) => r.action === 'created').length;
  const updated = results.filter((r) => r.action !== 'created').length;
  const pushParts: string[] = [];
  if (created) pushParts.push(`${created} created`);
  if (updated) pushParts.push(`${updated} synced`);
  if (errorMessages.length) pushParts.push(`${errorMessages.length} failed`);
  if (currentFilename) openDoc(currentFilename, currentDocType!);
  const summaryText = pushParts.length ? `Pushed: ${pushParts.join(', ')}` : 'Nothing pushed';
  const errorDetail = errorMessages.length ? '\n' + errorMessages.join('\n') : '';
  finishJiraProgress(summaryText + errorDetail, errorMessages.length > 0);
  updateJiraPushBtn();

  // Log AI-assisted time savings for successfully pushed stories/spikes.
  const storyResults = results.filter((r) => r.docType === 'story' && r.key);
  const spikeResults = results.filter((r) => r.docType === 'spike' && r.key);
  if (storyResults.length) {
    void logAiSaving(
      'story_push',
      storyResults.length,
      storyResults.map((r) => r.key!)
    );
  }
  if (spikeResults.length) {
    void logAiSaving(
      'spike_push',
      spikeResults.length,
      spikeResults.map((r) => r.key!)
    );
  }
}
