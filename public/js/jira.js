// ── JIRA selection modal ─────────────────────────────────────
import { fetchJSON, postJSON, escHtml, showJiraToast, setJiraStatus, TYPE_LABEL, STATUS_LABEL } from './state.js';
import { openDoc, updateJiraLink, renderDetailDeps, updateJiraStatus, updateStoryPointsUI } from './detail.js';
import { loadDocs } from './list.js';

let _jiraSelectResolve = null;
let _jiraSelectItems   = [];

export function showJiraSelectModal(title, items, confirmLabel) {
  return new Promise(function(resolve) {
    _jiraSelectResolve = resolve;
    _jiraSelectItems   = items;
    document.getElementById('jira-select-title').textContent       = title;
    document.getElementById('jira-select-confirm-btn').textContent = confirmLabel || 'Confirm';

    const list = document.getElementById('jira-select-list');
    list.innerHTML = items.map(function(item, i) {
      const keyHtml   = item.key  ? '<span class="jira-select-key">'  + escHtml(String(item.key))  + '</span>' : '';
      const typeClass = (item.type || '').replace(/\s+/g, '-');
      const typeHtml  = item.type ? '<span class="jira-badge type-' + escHtml(typeClass) + '">' + escHtml(item.type) + '</span>' : '';
      const localHtml = item.localExists ? '<span class="jira-badge local-update">↺ Update</span>' : '<span class="jira-badge local-new">+ New</span>';
      return '<label class="jira-select-item">' +
        '<input type="checkbox" checked data-idx="' + i + '" />' +
        '<div class="jira-select-item-body">' +
          keyHtml +
          '<span class="jira-select-summary">' + escHtml(item.summary || '') + '</span>' +
          '<div class="jira-select-meta">' + typeHtml + localHtml + '</div>' +
        '</div>' +
      '</label>';
    }).join('');

    document.getElementById('jira-select-overlay').classList.add('show');
  });
}

export function jiraSelectAll(checked) {
  document.querySelectorAll('#jira-select-list input[type=checkbox]').forEach(function(cb) { cb.checked = checked; });
}

export function jiraSelectCancel() {
  document.getElementById('jira-select-overlay').classList.remove('show');
  if (_jiraSelectResolve) { _jiraSelectResolve([]); _jiraSelectResolve = null; }
}

export function jiraSelectConfirm() {
  const selected = Array.from(
    document.querySelectorAll('#jira-select-list input[type=checkbox]:checked')
  ).map(function(cb) { return _jiraSelectItems[parseInt(cb.dataset.idx)]; });
  document.getElementById('jira-select-overlay').classList.remove('show');
  if (_jiraSelectResolve) { _jiraSelectResolve(selected); _jiraSelectResolve = null; }
}

// ── Sync preview confirmation modal ──────────────────────────
let _syncPreviewResolve = null;
let _syncPreviewItems   = [];

export function showSyncPreviewModal(title, items, confirmLabel) {
  return new Promise(function(resolve) {
    _syncPreviewResolve = resolve;
    _syncPreviewItems   = items;

    document.getElementById('sync-preview-title').textContent       = title;
    document.getElementById('sync-preview-confirm-btn').textContent = confirmLabel || 'Confirm';

    const createCount = items.filter(i => i.action === 'create').length;
    const updateCount = items.filter(i => i.action === 'update').length;
    const deleteCount = items.filter(i => i.action === 'delete').length;
    const parts = [];
    if (createCount) parts.push(`${createCount} new`);
    if (updateCount) parts.push(`${updateCount} update`);
    if (deleteCount) parts.push(`${deleteCount} to delete`);
    document.getElementById('sync-preview-counts').textContent = parts.join(' · ');

    const list = document.getElementById('sync-preview-list');
    list.innerHTML = items.map(function(item, idx) {
      const isCreate = item.action === 'create';
      const isDelete = item.action === 'delete';
      const keyLabel = item.jiraKey || item.jiraId || '';
      const titleText = item.jiraTitle || item.title || '';

      let changesHtml = '';
      if (item.changes && item.changes.length > 0) {
        changesHtml = '<div class="sync-preview-changes">' +
          item.changes.map(function(c) {
            if (c.field === 'error') return '<div class="sync-preview-change"><span class="sync-preview-field">error</span><span class="sync-preview-to" style="color:var(--error-text)">' + escHtml(c.message) + '</span></div>';
            if (c.field === 'description') return '<div class="sync-preview-change"><span class="sync-preview-field">description</span><span class="sync-preview-to">' + (isCreate ? 'new' : 'will sync') + '</span></div>';
            const fromHtml = c.from !== undefined && c.from !== null
              ? '<span class="sync-preview-from">' + escHtml(String(c.from)) + '</span><span class="sync-preview-arrow">→</span>'
              : '';
            var toHtml;
            if (c.pendingEpicTitle) {
              toHtml = '<span class="sync-preview-to" style="color:var(--accent)">[new] ' + escHtml(c.pendingEpicTitle) + '</span>';
            } else if (c.pendingFeatureTitle) {
              toHtml = '<span class="sync-preview-to" style="color:var(--accent)">[new] ' + escHtml(c.pendingFeatureTitle) + '</span>';
            } else if (c.to !== undefined && c.to !== null) {
              toHtml = '<span class="sync-preview-to">' + escHtml(String(c.to)) + '</span>';
            } else {
              toHtml = '<span class="sync-preview-to" style="color:var(--muted)">—</span>';
            }
            return '<div class="sync-preview-change"><span class="sync-preview-field">' + escHtml(c.field) + '</span>' + fromHtml + toHtml + '</div>';
          }).join('') +
        '</div>';
      } else if (!isCreate && !isDelete) {
        changesHtml = '<div class="sync-preview-no-changes">No field changes detected</div>';
      }
      if (isDelete && item.reason) {
        changesHtml += '<div class="sync-preview-changes"><div class="sync-preview-change"><span class="sync-preview-field">reason</span><span class="sync-preview-to" style="color:var(--error-text)">' + escHtml(item.reason) + '</span></div></div>';
      }

      const typeLabel = item.docType || item.localDocType || '';
      const typeBadge = typeLabel ? '<span class="type-badge ' + escHtml(typeLabel) + '" style="font-size:0.6rem;padding:1px 6px">' + escHtml((TYPE_LABEL && TYPE_LABEL[typeLabel]) || typeLabel) + '</span>' : '';

      const actionClass = isDelete ? 'delete' : isCreate ? 'create' : 'update';
      const actionLabel = isDelete ? '✕ Delete' : isCreate ? (item.autoIncluded ? '+ Create (auto)' : '+ Create') : '↺ Update';
      const unchecked = ' checked';

      return '<div class="sync-preview-item' + (isDelete ? ' sync-preview-item--delete' : '') + '">' +
        '<label class="sync-preview-item-header">' +
          '<input type="checkbox"' + unchecked + ' data-idx="' + idx + '" class="sync-preview-cb" />' +
          '<span class="sync-preview-action ' + actionClass + '">' + actionLabel + '</span>' +
          typeBadge +
          '<span class="sync-preview-item-title">' + escHtml(titleText) + '</span>' +
          (keyLabel ? '<span class="sync-preview-item-key">' + escHtml(keyLabel) + '</span>' : '') +
        '</label>' +
        changesHtml +
      '</div>';
    }).join('');

    document.getElementById('sync-preview-overlay').classList.add('show');
    document.querySelectorAll('#sync-preview-list .sync-preview-cb').forEach(function(cb) {
      cb.addEventListener('change', _syncPreviewUpdateCount);
    });
    _syncPreviewUpdateCount();
  });
}

function _syncPreviewUpdateCount() {
  const total   = document.querySelectorAll('#sync-preview-list .sync-preview-cb').length;
  const checked = document.querySelectorAll('#sync-preview-list .sync-preview-cb:checked').length;
  const btn = document.getElementById('sync-preview-confirm-btn');
  btn.textContent = `Confirm (${checked}/${total})`;
  btn.disabled = checked === 0;
}

export function syncPreviewSelectAll(checked) {
  document.querySelectorAll('#sync-preview-list .sync-preview-cb').forEach(function(cb) { cb.checked = checked; });
  _syncPreviewUpdateCount();
}

export function syncPreviewCancel() {
  document.getElementById('sync-preview-overlay').classList.remove('show');
  if (_syncPreviewResolve) { _syncPreviewResolve(null); _syncPreviewResolve = null; }
}

export function syncPreviewConfirm() {
  const selected = Array.from(
    document.querySelectorAll('#sync-preview-list .sync-preview-cb:checked')
  ).map(function(cb) { return _syncPreviewItems[parseInt(cb.dataset.idx)]; });
  _enterSyncProgressMode();
  if (_syncPreviewResolve) { _syncPreviewResolve(selected); _syncPreviewResolve = null; }
}

function _enterSyncProgressMode() {
  document.getElementById('sync-preview-list').style.display = 'none';
  const actionsEl = document.querySelector('#sync-preview-overlay .dialog-actions');
  if (actionsEl) actionsEl.style.display = 'none';
  const rightHeader = document.querySelector('.sync-preview-header .sync-preview-header-right');
  if (rightHeader) rightHeader.style.display = 'none';
  const progressArea = document.getElementById('sync-progress-area');
  if (progressArea) progressArea.style.display = '';
  const labelEl = document.getElementById('sync-progress-label');
  if (labelEl) labelEl.textContent = 'Starting…';
  const bar = document.getElementById('sync-progress-bar');
  if (bar) bar.style.width = '0%';
  const summary = document.getElementById('sync-progress-summary');
  if (summary) { summary.textContent = ''; summary.className = 'sync-progress-summary'; }
}

export function updateJiraProgress(current, total, label) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = document.getElementById('sync-progress-bar');
  if (bar) bar.style.width = pct + '%';
  const labelEl = document.getElementById('sync-progress-label');
  if (labelEl) labelEl.textContent = label;
}

export function finishJiraProgress(summaryText, hasError) {
  const bar = document.getElementById('sync-progress-bar');
  if (bar) bar.style.width = '100%';
  const labelEl = document.getElementById('sync-progress-label');
  if (labelEl) labelEl.textContent = hasError ? 'Finished with errors' : 'All done ✅';
  const summary = document.getElementById('sync-progress-summary');
  if (summary) {
    summary.style.whiteSpace = 'pre-wrap';
    summary.textContent = summaryText;
    summary.className = 'sync-progress-summary' + (hasError ? ' error' : ' success');
  }
  setTimeout(_resetSyncProgressModal, hasError ? 5000 : 2500);
}

function _resetSyncProgressModal() {
  const overlay = document.getElementById('sync-preview-overlay');
  if (overlay) overlay.classList.remove('show');
  const list = document.getElementById('sync-preview-list');
  if (list) list.style.display = '';
  const actionsEl = document.querySelector('#sync-preview-overlay .dialog-actions');
  if (actionsEl) actionsEl.style.display = '';
  const rightHeader = document.querySelector('.sync-preview-header .sync-preview-header-right');
  if (rightHeader) rightHeader.style.display = '';
  const progressArea = document.getElementById('sync-progress-area');
  if (progressArea) progressArea.style.display = 'none';
  if (_syncPreviewResolve) { _syncPreviewResolve(null); _syncPreviewResolve = null; }
}

// ── Push to JIRA ──────────────────────────────────────────────
const JIRA_CARET = ' <span class="toolbar-caret">▾</span>';

export function updateJiraPushBtn() {
  const btn = document.getElementById('jira-push-btn');
  if (!btn) return;
  const isMultiStory = currentDocType === 'story' && currentFilename?.endsWith('-stories.md');
  btn.innerHTML = (isMultiStory ? '↑ Push Stories' : '↑ JIRA') + JIRA_CARET;
  btn.disabled = false;
}

// ── Pull from JIRA (consolidated: status + fields + children) ─
export async function pullFromJira() {
  // Delegates to updateFromJira which already handles the full pull flow:
  // preview modal → update title/desc/SP/status → retrieve children.
  // When no JIRA_ID is set, it prompts the user to enter a key inline.
  await updateFromJira();
}

export async function retrieveChildrenFromJira() {
  if (!currentFilename || !currentDocType) return;
  if (!currentJiraId || currentJiraId === 'TBD') return;
  await offerChildrenDownload([{ key: currentJiraId, filename: currentFilename, docType: currentDocType }]);
}

export async function syncJiraStatus() {
  if (!currentFilename || !currentDocType) return;
  if (!currentJiraId || currentJiraId === 'TBD') return;

  const btn = document.getElementById('jira-push-btn');
  btn.disabled = true;
  try {
    const data = await postJSON(
      `/api/jira/sync-status/${currentDocType}/${encodeURIComponent(currentFilename)}`,
    );

    if (data.jiraStatus) updateJiraStatus(data.jiraStatus);

    if (data.storyPoints !== null && data.storyPoints !== undefined) {
      const spInput = document.getElementById('sp-input');
      if (spInput && spInput.style.display !== 'none') {
        spInput.value = data.storyPoints;
        spInput.dataset.original = data.storyPoints;
        const doc = allDocs.find(d => d.filename === currentFilename && d.docType === currentDocType);
        if (doc) doc.storyPoints = data.storyPoints;
      }
    }

    const spMsg = (data.storyPoints !== null && data.storyPoints !== undefined) ? `, SP: ${data.storyPoints}` : '';
    showJiraToast('success', `✅ Status synced: ${data.jiraStatus || '—'}${spMsg}`);
  } catch (e) {
    showJiraToast('error', `❌ ${e.message}`);
  } finally {
    updateJiraPushBtn();
  }
}

// ── Update from JIRA ─────────────────────────────────────────
export async function updateFromJira(jiraKeyOverride) {
  if (!currentFilename || !currentDocType) return;

  const hasKey = currentJiraId && currentJiraId !== 'TBD';

  // If no JIRA_ID on the doc, show a small inline prompt in the dropdown
  if (!hasKey && !jiraKeyOverride) {
    showUpdateFromJiraKeyPrompt();
    return;
  }

  const key = jiraKeyOverride || currentJiraId;
  const btn = document.getElementById('jira-push-btn');
  btn.disabled = true;
  btn.innerHTML = '⏳ Loading preview…' + JIRA_CARET;
  closeAllDropdowns();

  // 1. Fetch pull preview (with children for epics/features)
  const isParent = currentDocType === 'feature' || currentDocType === 'epic';
  let previewItems;
  try {
    const preview = await postJSON('/api/jira/pull-preview', {
      jiraKey: key,
      includeChildren: isParent,
    });
    previewItems = preview.items || [];
  } catch (e) {
    showJiraToast('error', `❌ Preview failed: ${e.message}`);
    updateJiraPushBtn();
    return;
  }

  // 2. Show confirmation popup with checkboxes
  const selected = await showSyncPreviewModal(
    '↓ Update from JIRA — Preview',
    previewItems,
    `Update ${previewItems.length} item${previewItems.length !== 1 ? 's' : ''}`
  );

  if (!selected || selected.length === 0) {
    updateJiraPushBtn();
    return;
  }

  // 3. Execute: update selected items with progress tracking
  const parentItem = previewItems[0];
  const parentSelected = selected.some(s => s.jiraKey === parentItem.jiraKey && s.action !== 'delete');
  const selectedChildren = selected.filter(s => s.jiraKey !== parentItem.jiraKey && s.action !== 'delete');
  const selectedDeletes  = selected.filter(s => s.action === 'delete');
  const totalSteps = (parentSelected ? 1 : 0) + (selectedChildren.length > 0 ? 1 : 0) + (selectedDeletes.length > 0 ? 1 : 0);
  let pullErrors = 0;
  let pullErrorMsg = '';
  let updatedKey = null;
  let childrenSynced = 0;
  let childrenDeleted = 0;
  let step = 0;

  try {
    if (parentSelected) {
      updateJiraProgress(step, totalSteps, `Fetching ${key}…`);
      const data = await postJSON(
        `/api/jira/update-from-jira/${currentDocType}/${encodeURIComponent(currentFilename)}`,
        key !== currentJiraId ? { jiraKey: key } : {},
      );
      updatedKey = data.key;
      if (currentFilename) openDoc(currentFilename, currentDocType);
      step++;
    }

    if (selectedChildren.length > 0) {
      const childKeys     = selectedChildren.map(c => c.jiraKey);
      const overwriteKeys = selectedChildren.filter(c => c.action === 'update').map(c => c.jiraKey);
      updateJiraProgress(step, totalSteps, `Syncing ${childKeys.length} child(ren)…`);
      await postJSON('/api/jira/pull', {
        keys: childKeys,
        overwriteKeys,
        parentLink: { filename: currentFilename, docType: currentDocType },
      });
      childrenSynced = childKeys.length;
      step++;
    }

    if (selectedDeletes.length > 0) {
      updateJiraProgress(step, totalSteps, `Deleting ${selectedDeletes.length} closed item(s)…`);
      const docsToDelete = selectedDeletes
        .filter(d => d.localFilename && d.localDocType)
        .map(d => ({ type: d.localDocType, filename: d.localFilename }));
      if (docsToDelete.length) {
        await postJSON('/api/docs/batch-delete', { docs: docsToDelete });
        childrenDeleted = docsToDelete.length;
      }
      step++;
    }

    if (childrenSynced || childrenDeleted) {
      await loadDocs();
    }
  } catch (e) {
    pullErrors++;
    pullErrorMsg = e.message;
    console.warn('Pull from JIRA failed:', e.message);
  } finally {
    const pullParts = [];
    if (updatedKey) pullParts.push(`Updated ${updatedKey}`);
    if (childrenSynced) pullParts.push(`${childrenSynced} child(ren) synced`);
    if (childrenDeleted) pullParts.push(`${childrenDeleted} closed item(s) deleted`);
    const errorDetail = pullErrorMsg ? '\n' + pullErrorMsg : '';
    finishJiraProgress((pullParts.join(', ') || 'No changes applied') + errorDetail, pullErrors > 0);
    updateJiraPushBtn();
  }
}

export function showUpdateFromJiraKeyPrompt() {
  // Swap the dropdown content to show an inline key input
  const menu = document.getElementById('jira-dropdown-menu');
  if (!menu) return;
  menu.innerHTML = `
    <div class="jira-key-prompt">
      <div class="jira-key-prompt-label">Enter JIRA key</div>
      <div class="jira-key-prompt-row">
        <input id="jira-update-key-input" class="jira-key-prompt-input" type="text"
               placeholder="e.g. EAMDM-1234"
               onkeydown="if(event.key==='Enter'){event.preventDefault();submitUpdateFromJiraKey()} if(event.key==='Escape'){closeAllDropdowns()}" />
        <button class="btn-jira-key" onclick="submitUpdateFromJiraKey()">→</button>
      </div>
    </div>`;
  // Keep dropdown open and focus the input
  setTimeout(() => document.getElementById('jira-update-key-input')?.focus(), 30);
}

export function submitUpdateFromJiraKey() {
  const input = document.getElementById('jira-update-key-input');
  if (!input) return;
  const key = input.value.trim().toUpperCase();
  if (!key) { input.focus(); return; }
  closeAllDropdowns();
  updateFromJira(key);
}

export async function pushToJira() {
  if (!currentFilename || !currentDocType) return;

  const btn = document.getElementById('jira-push-btn');

  // 1. Collect all items: parent + all linked children (no pre-selection modal)
  const itemsToPush = [{ filename: currentFilename, docType: currentDocType }];

  if (currentDocType === 'feature' || currentDocType === 'epic') {
    try {
      const linksData = await fetchJSON(`/api/links/${currentDocType}/${encodeURIComponent(currentFilename)}`);
      const localChildren = linksData.children || [];
      for (const c of localChildren) {
        itemsToPush.push({ filename: c.filename, docType: c.docType });
        // For feature push: also include grandchildren (stories/spikes/bugs under epics)
        if (currentDocType === 'feature' && c.docType === 'epic') {
          try {
            const epicLinks = await fetchJSON(`/api/links/epic/${encodeURIComponent(c.filename)}`);
            for (const gc of (epicLinks.children || [])) {
              itemsToPush.push({ filename: gc.filename, docType: gc.docType });
            }
          } catch (e) { console.warn('Failed to load grandchildren for push:', e.message); }
        }
      }
    } catch (e) { console.warn('Failed to load children for push:', e.message); }
  }

  // 2. Fetch push preview for all items
  btn.disabled = true;
  btn.innerHTML = '⏳ Loading preview…' + JIRA_CARET;
  closeAllDropdowns();

  let previewItems;
  try {
    const preview = await postJSON('/api/jira/push-preview', { items: itemsToPush });
    previewItems = preview.items || [];
  } catch (e) {
    showJiraToast('error', `❌ Preview failed: ${e.message}`);
    updateJiraPushBtn();
    return;
  }

  // Sort: create-features first, then create-epics, then create-others,
  // then update-features, update-epics, update-others.
  // This ensures features are created before epics (for "Is Contained" links)
  // and epics before stories (for Epic Link fields).
  previewItems.sort(function(a, b) {
    var typeOrder = { feature: 0, epic: 1 };
    var aOrder = (a.action === 'create' ? 0 : 3) + (typeOrder[a.docType] ?? 2);
    var bOrder = (b.action === 'create' ? 0 : 3) + (typeOrder[b.docType] ?? 2);
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
  const results = [];
  const errorMessages = [];
  for (let idx = 0; idx < selected.length; idx++) {
    const item = selected[idx];
    const fn = item.filename;
    const dt = item.docType;
    if (!fn || !dt) continue;
    const jiraKey = item.jiraKey || item.jiraId || item.title || fn;
    updateJiraProgress(idx, selected.length, `Pushing ${jiraKey} (${idx + 1}/${selected.length})…`);
    try {
      const data = await postJSON(`/api/jira/push/${dt}/${encodeURIComponent(fn)}`);
      if (data.type === 'multi-story') {
        for (const r of (data.results || [])) results.push(r);
      } else {
        results.push({ key: data.key, action: data.action });
      }
    } catch (e) {
      console.warn(`Failed to push ${fn}:`, e.message);
      errorMessages.push(`${jiraKey}: ${e.message}`);
    }
  }

  const created = results.filter(r => r.action === 'created').length;
  const updated = results.filter(r => r.action !== 'created').length;
  const pushParts = [];
  if (created) pushParts.push(`${created} created`);
  if (updated) pushParts.push(`${updated} synced`);
  if (errorMessages.length) pushParts.push(`${errorMessages.length} failed`);
  if (currentFilename) openDoc(currentFilename, currentDocType);
  const summaryText = pushParts.length ? `Pushed: ${pushParts.join(', ')}` : 'Nothing pushed';
  const errorDetail = errorMessages.length ? '\n' + errorMessages.join('\n') : '';
  finishJiraProgress(summaryText + errorDetail, errorMessages.length > 0);
  updateJiraPushBtn();
}

// ── Check All JIRA ───────────────────────────────────────────
export async function checkAllJira() {
  const btn = document.getElementById('jira-check-all-btn');
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = '⏳ Checking…';

  let data;
  try {
    data = await postJSON('/api/jira/check-all', {});
  } catch (e) {
    showJiraToast('error', `❌ ${e.message}`);
    btn.disabled = false;
    btn.textContent = '↕ Check JIRA';
    return;
  }

  btn.disabled = false;
  btn.textContent = '↕ Check JIRA';

  // Response: { changed: [...], skipped: [...], errors: [...], total: N }
  const changed = data.changed || [];
  const total   = data.total   || 0;
  if (changed.length === 0) {
    showJiraToast('success', `✅ All ${total} JIRA-linked issues are up to date`);
    return;
  }

  // Map to the array-changes format expected by showSyncPreviewModal
  const modalItems = changed.map(function(item) {
    return Object.assign({}, item, { changes: item.changesArray || [] });
  });

  // Show preview modal with changes — reuse the sync preview
  const selected = await showSyncPreviewModal(
    `↕ JIRA Changes — ${changed.length} of ${total} differ`,
    modalItems,
    `Update ${changed.length} item${changed.length !== 1 ? 's' : ''}`
  );

  if (!selected || selected.length === 0) return;

  // Execute sync-status for each selected item with progress tracking
  btn.disabled = true;
  let synced = 0;
  const syncErrorMsgs = [];

  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    if (!item.filename || !item.docType) continue;
    const jiraKey = item.jiraKey || item.filename;
    updateJiraProgress(i, selected.length, `Syncing ${jiraKey} (${i + 1}/${selected.length})…`);
    try {
      await postJSON(
        `/api/jira/sync-status/${item.docType}/${encodeURIComponent(item.filename)}`,
      );
      synced++;
    } catch (e) {
      syncErrorMsgs.push(`${jiraKey}: ${e.message}`);
      console.warn(`Failed to sync ${item.filename}:`, e.message);
    }
  }

  const errorDetail = syncErrorMsgs.length ? '\n' + syncErrorMsgs.join('\n') : '';
  finishJiraProgress(
    `Synced ${synced} issue${synced !== 1 ? 's' : ''}` + (syncErrorMsgs.length ? `, ${syncErrorMsgs.length} error(s)` : '') + errorDetail,
    syncErrorMsgs.length > 0,
  );

  if (synced > 0) {
    await loadDocs();
    if (currentFilename) openDoc(currentFilename, currentDocType);
  }

  btn.disabled = false;
  btn.textContent = '↕ Check JIRA';
}

// ── JIRA Import ───────────────────────────────────────────────
export function toggleJiraSection() {
  toggleSection('jira-section-body', 'jira-chevron');
}

export async function searchJira() {
  const type      = document.getElementById('jira-type').value;
  const text      = document.getElementById('jira-text').value.trim();
  const btn       = document.getElementById('jira-search-btn');
  const resultsEl = document.getElementById('jira-results');

  btn.disabled = true;
  btn.textContent = 'Searching…';
  setJiraStatus('loading', 'Querying JIRA…');
  resultsEl.innerHTML = '';
  document.getElementById('jira-download-btn').classList.add('hidden');

  try {
    const params = new URLSearchParams({ type });
    if (text) params.set('text', text);
    const data = await fetchJSON(`/api/jira/search?${params}`);

    jiraSearchResults = data.issues || [];
    renderJiraResults(jiraSearchResults);
    setJiraStatus(jiraSearchResults.length ? 'hidden' : 'success',
      jiraSearchResults.length ? '' : 'No issues found.');
  } catch (e) {
    setJiraStatus('error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search JIRA';
  }
}

export function renderJiraResults(issues) {
  const el = document.getElementById('jira-results');
  if (!issues.length) {
    el.innerHTML = '<div class="jira-empty">No results</div>';
    document.getElementById('jira-download-btn').classList.add('hidden');
    return;
  }

  el.innerHTML = issues.map((issue, i) => `
    <div class="jira-result-item ${issue.localExists ? 'local-exists' : ''}" onclick="toggleJiraItem(${i})">
      <input type="checkbox" id="jira-cb-${i}" onclick="event.stopPropagation(); toggleJiraItem(${i})" />
      <div class="jira-result-body">
        <div class="jira-result-key">${escHtml(issue.key)}</div>
        <div class="jira-result-summary" title="${escHtml(issue.summary)}">${escHtml(issue.summary)}</div>
        <div class="jira-result-meta">
          <span class="jira-badge type-${escHtml(issue.issuetype)}">${escHtml(issue.issuetype)}</span>
          <span class="jira-badge status">${escHtml(issue.status)}</span>
          ${issue.localExists ? `<span class="jira-badge local" title="${escHtml(issue.localFilename)}">✓ Local</span>` : ''}
        </div>
      </div>
    </div>`).join('');

  updateDownloadBtn();
}

export function toggleJiraItem(index) {
  const cb   = document.getElementById(`jira-cb-${index}`);
  const item = cb.closest('.jira-result-item');
  cb.checked = !cb.checked;
  item.classList.toggle('selected', cb.checked);
  updateDownloadBtn();
}

export function updateDownloadBtn() {
  const count = document.querySelectorAll('#jira-results input[type=checkbox]:checked').length;
  const btn   = document.getElementById('jira-download-btn');
  btn.classList.toggle('hidden', count === 0);
  btn.textContent   = `⬇ Download ${count} issue${count !== 1 ? 's' : ''}`;
}

export async function downloadSelected() {
  const checked = [...document.querySelectorAll('#jira-results input[type=checkbox]:checked')];
  const indices = checked.map(cb => parseInt(cb.id.replace('jira-cb-', '')));
  const keys    = indices.map(i => jiraSearchResults[i].key);
  if (!keys.length) return;
  await performJiraPull(keys, []);
}

export async function performJiraPull(keys, overwriteKeys, _allPulled = [], parentLink = null) {
  const btn = document.getElementById('jira-download-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Downloading…';
  setJiraStatus('loading', `Downloading ${keys.length} issue(s)…`);

  try {
    const data = await postJSON('/api/jira/pull', { keys, overwriteKeys, parentLink });

    const accumulatedPulled = [..._allPulled, ...(data.pulled || [])];

    let resolvedOverwrite = [...overwriteKeys];
    if (data.conflicts?.length) {
      const conflictItems = data.conflicts.map(c => ({
        key:     c.key,
        summary: c.existingFilename,
        type:    c.existingDocType,
      }));
      const selectedOverwrite = await showJiraSelectModal(
        `${data.conflicts.length} issue(s) already exist locally — overwrite?`,
        conflictItems,
        'Overwrite selected'
      );
      if (selectedOverwrite.length) {
        resolvedOverwrite = [...resolvedOverwrite, ...selectedOverwrite.map(c => c.key)];
        btn.disabled = false;
        return performJiraPull(keys, resolvedOverwrite, accumulatedPulled, parentLink);
      }
    }

    const pullCount = accumulatedPulled.length;
    if (pullCount > 0) {
      setJiraStatus('success', `✅ Downloaded ${pullCount} issue(s) successfully.`);

      // Offer to download children of pulled features/epics
      const parents = accumulatedPulled.filter(p => p.docType === 'feature' || p.docType === 'epic');
      if (parents.length > 0) await offerChildrenDownload(parents);

      // Refresh search results
      try {
        const updatedData = await fetchJSON(`/api/jira/search?type=${document.getElementById('jira-type').value}&text=${encodeURIComponent(document.getElementById('jira-text').value)}`);
        jiraSearchResults = updatedData.issues || [];
        renderJiraResults(jiraSearchResults);
      } catch { /* non-critical: search refresh after pull */ }
    } else {
      setJiraStatus('success', 'No new issues downloaded.');
    }
  } catch (e) {
    setJiraStatus('error', e.message);
  } finally {
    btn.disabled = false;
    updateDownloadBtn();
  }
}

// ── Import by key (bypasses label filter) ────────────────────
export async function pullByKey() {
  const input = document.getElementById('jira-key-input');
  const raw   = (input.value || '').trim();
  if (!raw) { input.focus(); return; }

  const keys = raw.split(/[\s,]+/).map(k => k.trim().toUpperCase()).filter(Boolean);
  if (!keys.length) return;

  const btn = document.querySelector('.btn-jira-key');
  btn.disabled    = true;
  btn.textContent = '⏳ Importing…';
  setJiraStatus('loading', `Importing ${keys.join(', ')}…`);

  try {
    await performJiraPull(keys, []);
    input.value = '';
  } catch (e) {
    setJiraStatus('error', `❌ ${e.message}`);
  } finally {
    btn.disabled    = false;
    btn.textContent = '⬇ Import';
  }
}

export async function offerChildrenDownload(parentIssues) {
  const allChildren  = [];
  const childToParent = new Map(); // child.key → parent issue
  const seen = new Set();

  for (const parent of parentIssues) {
    try {
      const data = await fetchJSON(`/api/jira/children/${encodeURIComponent(parent.key)}`);
      for (const child of (data.children || [])) {
        if (!seen.has(child.key)) {
          seen.add(child.key);
          allChildren.push({
            key:        child.key,
            summary:    child.summary,
            type:       child.issuetype,
            localExists: child.localExists,
          });
          childToParent.set(child.key, parent);
        }
      }
    } catch (e) { console.warn(`Failed to fetch children for ${parent.key}:`, e.message); }
  }

  if (allChildren.length === 0) return;

  const newCount    = allChildren.filter(c => !c.localExists).length;
  const updateCount = allChildren.filter(c =>  c.localExists).length;
  const parts = [];
  if (newCount)    parts.push(`${newCount} new`);
  if (updateCount) parts.push(`${updateCount} to update`);
  const modalTitle = `Children in JIRA: ${parts.join(', ')}`;

  const selected = await showJiraSelectModal(modalTitle, allChildren, 'Import / Update selected');

  if (!selected.length) return;

  // Pull each group of children with their parent link so Epic_ID / Feature_ID is set.
  // Pre-include existing children in overwriteKeys so no second conflict dialog fires.
  for (const parent of parentIssues) {
    const childKeys     = selected
      .filter(c => childToParent.get(c.key)?.key === parent.key)
      .map(c => c.key);
    const overwriteKeys = selected
      .filter(c => childToParent.get(c.key)?.key === parent.key && c.localExists)
      .map(c => c.key);
    if (childKeys.length) {
      await performJiraPull(childKeys, overwriteKeys, [], {
        filename: parent.filename,
        docType:  parent.docType,
      });
    }
  }
}
