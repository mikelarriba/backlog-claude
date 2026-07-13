// ── JIRA pull/update: sync a single doc's fields, status and children ────
// from JIRA, plus the "Check all" bulk status-sync sweep.
import { postJSON, showJiraToast } from './state.js';
import { openDoc, updateJiraStatus, closeAllDropdowns } from './detail.js';
import { loadDocs } from './list.js';
import { upsertDoc } from './store.js';
import { showSyncPreviewModal, updateJiraProgress, finishJiraProgress, updateJiraPushBtn, } from './jira-push.js';
import { offerChildrenDownload } from './jira-import.js';
// ── Pull from JIRA (consolidated: status + fields + children) ─
export async function pullFromJira() {
    // Delegates to updateFromJira which already handles the full pull flow:
    // preview modal → update title/desc/SP/status → retrieve children.
    // When no JIRA_ID is set, it prompts the user to enter a key inline.
    await updateFromJira();
}
export async function retrieveChildrenFromJira() {
    if (!currentFilename || !currentDocType)
        return;
    if (!currentJiraId || currentJiraId === 'TBD')
        return;
    await offerChildrenDownload([
        { key: currentJiraId, filename: currentFilename, docType: currentDocType },
    ]);
}
export async function syncJiraStatus() {
    if (!currentFilename || !currentDocType)
        return;
    if (!currentJiraId || currentJiraId === 'TBD')
        return;
    const btn = document.getElementById('jira-push-btn');
    if (btn)
        btn.disabled = true;
    try {
        const data = (await postJSON(`/api/jira/sync-status/${currentDocType}/${encodeURIComponent(currentFilename)}`, undefined));
        if (data.jiraStatus)
            updateJiraStatus(data.jiraStatus);
        if (data.storyPoints !== null && data.storyPoints !== undefined) {
            const spInput = document.getElementById('sp-input');
            if (spInput && spInput.style.display !== 'none') {
                spInput.value = String(data.storyPoints);
                spInput.dataset.original = String(data.storyPoints);
                const doc = allDocs.find((d) => d.filename === currentFilename && d.docType === currentDocType);
                if (doc)
                    upsertDoc({ ...doc, storyPoints: data.storyPoints });
            }
        }
        const spMsg = data.storyPoints !== null && data.storyPoints !== undefined
            ? `, SP: ${data.storyPoints}`
            : '';
        showJiraToast('success', `✅ Status synced: ${data.jiraStatus || '—'}${spMsg}`);
    }
    catch (e) {
        showJiraToast('error', `❌ ${e.message}`);
    }
    finally {
        updateJiraPushBtn();
    }
}
// ── Update from JIRA ─────────────────────────────────────────
const JIRA_CARET = ' <span class="toolbar-caret">▾</span>';
export async function updateFromJira(jiraKeyOverride) {
    if (!currentFilename || !currentDocType)
        return;
    const hasKey = currentJiraId && currentJiraId !== 'TBD';
    // If no JIRA_ID on the doc, show a small inline prompt in the dropdown
    if (!hasKey && !jiraKeyOverride) {
        showUpdateFromJiraKeyPrompt();
        return;
    }
    const key = jiraKeyOverride || currentJiraId;
    const btn = document.getElementById('jira-push-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Loading preview…' + JIRA_CARET;
    }
    closeAllDropdowns();
    // 1. Fetch pull preview (with children for epics/features)
    const isParent = currentDocType === 'feature' || currentDocType === 'epic';
    let previewItems;
    try {
        const preview = (await postJSON('/api/jira/pull-preview', {
            jiraKey: key,
            includeChildren: isParent,
        }));
        previewItems = preview.items || [];
    }
    catch (e) {
        showJiraToast('error', `❌ Preview failed: ${e.message}`);
        updateJiraPushBtn();
        return;
    }
    // 2. Show confirmation popup with checkboxes
    const selected = await showSyncPreviewModal('↓ Update from JIRA — Preview', previewItems, `Update ${previewItems.length} item${previewItems.length !== 1 ? 's' : ''}`);
    if (!selected || selected.length === 0) {
        updateJiraPushBtn();
        return;
    }
    // 3. Execute: update selected items with progress tracking
    const parentItem = previewItems[0];
    const parentSelected = selected.some((s) => s.jiraKey === parentItem.jiraKey && s.action !== 'delete');
    const selectedChildren = selected.filter((s) => s.jiraKey !== parentItem.jiraKey && s.action !== 'delete');
    const selectedDeletes = selected.filter((s) => s.action === 'delete');
    const totalSteps = (parentSelected ? 1 : 0) +
        (selectedChildren.length > 0 ? 1 : 0) +
        (selectedDeletes.length > 0 ? 1 : 0);
    let pullErrors = 0;
    let pullErrorMsg = '';
    let updatedKey = null;
    let childrenSynced = 0;
    let childrenDeleted = 0;
    let step = 0;
    try {
        if (parentSelected) {
            updateJiraProgress(step, totalSteps, `Fetching ${key}…`);
            const data = (await postJSON(`/api/jira/update-from-jira/${currentDocType}/${encodeURIComponent(currentFilename)}`, key !== currentJiraId ? { jiraKey: key } : {}));
            updatedKey = data.key;
            if (currentFilename)
                openDoc(currentFilename, currentDocType);
            step++;
        }
        if (selectedChildren.length > 0) {
            const childKeys = selectedChildren.map((c) => c.jiraKey);
            const overwriteKeys = selectedChildren
                .filter((c) => c.action === 'update')
                .map((c) => c.jiraKey);
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
                .filter((d) => d.localFilename && d.localDocType)
                .map((d) => ({ type: d.localDocType, filename: d.localFilename }));
            if (docsToDelete.length) {
                await postJSON('/api/docs/batch-delete', { docs: docsToDelete });
                childrenDeleted = docsToDelete.length;
            }
            step++;
        }
        if (childrenSynced || childrenDeleted) {
            await loadDocs();
        }
    }
    catch (e) {
        pullErrors++;
        pullErrorMsg = e.message;
        console.warn('Pull from JIRA failed:', e.message);
    }
    finally {
        const pullParts = [];
        if (updatedKey)
            pullParts.push(`Updated ${updatedKey}`);
        if (childrenSynced)
            pullParts.push(`${childrenSynced} child(ren) synced`);
        if (childrenDeleted)
            pullParts.push(`${childrenDeleted} closed item(s) deleted`);
        const errorDetail = pullErrorMsg ? '\n' + pullErrorMsg : '';
        finishJiraProgress((pullParts.join(', ') || 'No changes applied') + errorDetail, pullErrors > 0);
        updateJiraPushBtn();
    }
}
export function showUpdateFromJiraKeyPrompt() {
    // Swap the dropdown content to show an inline key input
    const menu = document.getElementById('jira-dropdown-menu');
    if (!menu)
        return;
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
    if (!input)
        return;
    const key = input.value.trim().toUpperCase();
    if (!key) {
        input.focus();
        return;
    }
    closeAllDropdowns();
    updateFromJira(key);
}
// ── Check All JIRA ───────────────────────────────────────────
export async function checkAllJira() {
    const btn = document.getElementById('jira-check-all-btn');
    if (!btn)
        return;
    btn.disabled = true;
    btn.textContent = '⏳ Checking…';
    let data;
    try {
        data = (await postJSON('/api/jira/check-all', {}));
    }
    catch (e) {
        showJiraToast('error', `❌ ${e.message}`);
        btn.disabled = false;
        btn.textContent = '↕ Check JIRA';
        return;
    }
    btn.disabled = false;
    btn.textContent = '↕ Check JIRA';
    // Response: { changed: [...], skipped: [...], errors: [...], total: N }
    const changed = data.changed || [];
    const total = data.total || 0;
    if (changed.length === 0) {
        showJiraToast('success', `✅ All ${total} JIRA-linked issues are up to date`);
        return;
    }
    // Map to the array-changes format expected by showSyncPreviewModal
    const modalItems = changed.map(function (item) {
        return Object.assign({}, item, { changes: item.changesArray || [] });
    });
    // Show preview modal with changes — reuse the sync preview
    const selected = await showSyncPreviewModal(`↕ JIRA Changes — ${changed.length} of ${total} differ`, modalItems, `Update ${changed.length} item${changed.length !== 1 ? 's' : ''}`);
    if (!selected || selected.length === 0)
        return;
    // Execute sync-status for each selected item with progress tracking
    btn.disabled = true;
    let synced = 0;
    const syncErrorMsgs = [];
    for (let i = 0; i < selected.length; i++) {
        const item = selected[i];
        if (!item.filename || !item.docType)
            continue;
        const jiraKey = item.jiraKey || item.filename;
        updateJiraProgress(i, selected.length, `Syncing ${jiraKey} (${i + 1}/${selected.length})…`);
        try {
            await postJSON(`/api/jira/sync-status/${item.docType}/${encodeURIComponent(item.filename)}`, undefined);
            synced++;
        }
        catch (e) {
            syncErrorMsgs.push(`${jiraKey}: ${e.message}`);
            console.warn(`Failed to sync ${item.filename}:`, e.message);
        }
    }
    const errorDetail = syncErrorMsgs.length ? '\n' + syncErrorMsgs.join('\n') : '';
    finishJiraProgress(`Synced ${synced} issue${synced !== 1 ? 's' : ''}` +
        (syncErrorMsgs.length ? `, ${syncErrorMsgs.length} error(s)` : '') +
        errorDetail, syncErrorMsgs.length > 0);
    if (synced > 0) {
        await loadDocs();
        if (currentFilename)
            openDoc(currentFilename, currentDocType);
    }
    btn.disabled = false;
    btn.textContent = '↕ Check JIRA';
}
//# sourceMappingURL=jira-pull.js.map