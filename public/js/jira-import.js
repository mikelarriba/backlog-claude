// ── JIRA import: selection modal + search/download flow ─────────
// Covers the generic "pick items from a list" modal (used by both the
// import flow here and by conflict/children prompts) and the full
// search → select → download import flow from the FAB's Import tab.
import { fetchJSON, postJSON, escHtml, setJiraStatus } from './state.js';
let _jiraSelectResolve = null;
let _jiraSelectItems = [];
export function showJiraSelectModal(title, items, confirmLabel, 
// Callers that only want to *import new* issues (e.g. the PI Config "Sync from
// JIRA" flow) pass a label here so already-local items render as informational
// (unchecked, distinct badge) instead of the default "select to update" behavior
// used by the conflict/children-download flows below.
localExistsLabel) {
    return new Promise(function (resolve) {
        _jiraSelectResolve = resolve;
        _jiraSelectItems = items;
        document.getElementById('jira-select-title').textContent = title;
        document.getElementById('jira-select-confirm-btn').textContent = confirmLabel || 'Confirm';
        const list = document.getElementById('jira-select-list');
        list.innerHTML = items
            .map(function (item, i) {
            const keyHtml = item.key
                ? '<span class="jira-select-key">' + escHtml(String(item.key)) + '</span>'
                : '';
            const typeClass = (item.type || '').replace(/\s+/g, '-');
            const typeHtml = item.type
                ? '<span class="jira-badge type-' +
                    escHtml(typeClass) +
                    '">' +
                    escHtml(item.type) +
                    '</span>'
                : '';
            const localHtml = item.localExists
                ? '<span class="jira-badge local-update">' +
                    escHtml(localExistsLabel || '↺ Update') +
                    '</span>'
                : '<span class="jira-badge local-new">+ New</span>';
            // Default-check everything, except already-local items in "new issues
            // only" mode (localExistsLabel set) — those are informational by default.
            const preChecked = !(item.localExists && localExistsLabel);
            return ('<label class="jira-select-item">' +
                '<input type="checkbox" ' +
                (preChecked ? 'checked ' : '') +
                'data-idx="' +
                i +
                '" />' +
                '<div class="jira-select-item-body">' +
                keyHtml +
                '<span class="jira-select-summary">' +
                escHtml(item.summary || '') +
                '</span>' +
                '<div class="jira-select-meta">' +
                typeHtml +
                localHtml +
                '</div>' +
                '</div>' +
                '</label>');
        })
            .join('');
        document.getElementById('jira-select-overlay').classList.add('show');
    });
}
export function jiraSelectAll(checked) {
    document
        .querySelectorAll('#jira-select-list input[type=checkbox]')
        .forEach(function (cb) {
        cb.checked = checked;
    });
}
export function jiraSelectCancel() {
    document.getElementById('jira-select-overlay').classList.remove('show');
    if (_jiraSelectResolve) {
        _jiraSelectResolve([]);
        _jiraSelectResolve = null;
    }
}
export function jiraSelectConfirm() {
    const selected = Array.from(document.querySelectorAll('#jira-select-list input[type=checkbox]:checked')).map(function (cb) {
        return _jiraSelectItems[parseInt(cb.dataset.idx)];
    });
    document.getElementById('jira-select-overlay').classList.remove('show');
    if (_jiraSelectResolve) {
        _jiraSelectResolve(selected);
        _jiraSelectResolve = null;
    }
}
export async function searchJira() {
    const type = document.getElementById('jira-type').value;
    const text = document.getElementById('jira-text').value.trim();
    const btn = document.getElementById('jira-search-btn');
    const resultsEl = document.getElementById('jira-results');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Searching…';
    }
    setJiraStatus('loading', 'Querying JIRA…');
    resultsEl.innerHTML = '';
    document.getElementById('jira-download-btn')?.classList.add('hidden');
    try {
        const params = new URLSearchParams({ type });
        if (text)
            params.set('text', text);
        const data = (await fetchJSON(`/api/jira/search?${params}`));
        jiraSearchResults = (data.issues || []);
        renderJiraResults(data.issues || []);
        setJiraStatus((data.issues || []).length ? 'hidden' : 'success', (data.issues || []).length ? '' : 'No issues found.');
    }
    catch (e) {
        setJiraStatus('error', e.message);
    }
    finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Search JIRA';
        }
    }
}
export function renderJiraResults(issues) {
    const el = document.getElementById('jira-results');
    if (!issues.length) {
        el.innerHTML = '<div class="jira-empty">No results</div>';
        document.getElementById('jira-download-btn')?.classList.add('hidden');
        return;
    }
    el.innerHTML = issues
        .map((issue, i) => `
    <div class="jira-result-item ${issue.localExists ? 'local-exists' : ''}" onclick="toggleJiraItem(${i})">
      <input type="checkbox" id="jira-cb-${i}" onclick="event.stopPropagation(); toggleJiraItem(${i})" />
      <div class="jira-result-body">
        <div class="jira-result-key">${escHtml(issue.key)}</div>
        <div class="jira-result-summary" title="${escHtml(issue.summary)}">${escHtml(issue.summary)}</div>
        <div class="jira-result-meta">
          <span class="jira-badge type-${escHtml(issue.issuetype)}">${escHtml(issue.issuetype)}</span>
          <span class="jira-badge status">${escHtml(issue.status)}</span>
          ${issue.localExists ? `<span class="jira-badge local" title="${escHtml(issue.localFilename || '')}">✓ Local</span>` : ''}
        </div>
      </div>
    </div>`)
        .join('');
    updateDownloadBtn();
}
export function toggleJiraItem(index) {
    const cb = document.getElementById(`jira-cb-${index}`);
    const item = cb.closest('.jira-result-item');
    cb.checked = !cb.checked;
    item.classList.toggle('selected', cb.checked);
    updateDownloadBtn();
}
export function updateDownloadBtn() {
    const count = document.querySelectorAll('#jira-results input[type=checkbox]:checked').length;
    const btn = document.getElementById('jira-download-btn');
    if (!btn)
        return;
    btn.classList.toggle('hidden', count === 0);
    btn.textContent = `⬇ Download ${count} issue${count !== 1 ? 's' : ''}`;
}
export async function downloadSelected() {
    const checked = [
        ...document.querySelectorAll('#jira-results input[type=checkbox]:checked'),
    ];
    const indices = checked.map((cb) => parseInt(cb.id.replace('jira-cb-', '')));
    const keys = indices.map((i) => jiraSearchResults[i].key);
    if (!keys.length)
        return;
    await performJiraPull(keys, []);
}
export async function performJiraPull(keys, overwriteKeys, _allPulled = [], parentLink = null) {
    const btn = document.getElementById('jira-download-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Downloading…';
    }
    setJiraStatus('loading', `Downloading ${keys.length} issue(s)…`);
    try {
        const data = (await postJSON('/api/jira/pull', { keys, overwriteKeys, parentLink }));
        const accumulatedPulled = [..._allPulled, ...(data.pulled || [])];
        let resolvedOverwrite = [...overwriteKeys];
        if (data.conflicts?.length) {
            const conflictItems = data.conflicts.map((c) => ({
                key: c.key,
                summary: c.existingFilename,
                type: c.existingDocType,
            }));
            const selectedOverwrite = await showJiraSelectModal(`${data.conflicts.length} issue(s) already exist locally — overwrite?`, conflictItems, 'Overwrite selected');
            if (selectedOverwrite.length) {
                resolvedOverwrite = [...resolvedOverwrite, ...selectedOverwrite.map((c) => c.key)];
                if (btn)
                    btn.disabled = false;
                return performJiraPull(keys, resolvedOverwrite, accumulatedPulled, parentLink);
            }
        }
        const pullCount = accumulatedPulled.length;
        if (pullCount > 0) {
            setJiraStatus('success', `✅ Downloaded ${pullCount} issue(s) successfully.`);
            // Offer to download children of pulled features/epics
            const parents = accumulatedPulled.filter((p) => p.docType === 'feature' || p.docType === 'epic');
            if (parents.length > 0)
                await offerChildrenDownload(parents);
            // Refresh search results
            try {
                const typeSel = document.getElementById('jira-type');
                const textInput = document.getElementById('jira-text');
                const updatedData = (await fetchJSON(`/api/jira/search?type=${typeSel.value}&text=${encodeURIComponent(textInput.value)}`));
                jiraSearchResults = (updatedData.issues || []);
                renderJiraResults(updatedData.issues || []);
            }
            catch {
                /* non-critical: search refresh after pull */
            }
        }
        else {
            setJiraStatus('success', 'No new issues downloaded.');
        }
    }
    catch (e) {
        setJiraStatus('error', e.message);
    }
    finally {
        if (btn)
            btn.disabled = false;
        updateDownloadBtn();
    }
}
// ── Import by key (bypasses label filter) ────────────────────
export async function pullByKey() {
    const input = document.getElementById('jira-key-input');
    if (!input)
        return;
    const raw = (input.value || '').trim();
    if (!raw) {
        input.focus();
        return;
    }
    const keys = raw
        .split(/[\s,]+/)
        .map((k) => k.trim().toUpperCase())
        .filter(Boolean);
    if (!keys.length)
        return;
    const btn = document.querySelector('.btn-jira-key');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Importing…';
    }
    setJiraStatus('loading', `Importing ${keys.join(', ')}…`);
    try {
        await performJiraPull(keys, []);
        input.value = '';
    }
    catch (e) {
        setJiraStatus('error', `❌ ${e.message}`);
    }
    finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '⬇ Import';
        }
    }
}
export async function offerChildrenDownload(parentIssues) {
    const allChildren = [];
    const childToParent = new Map(); // child.key → parent issue
    const seen = new Set();
    for (const parent of parentIssues) {
        try {
            const data = (await fetchJSON(`/api/jira/children/${encodeURIComponent(parent.key)}`));
            for (const child of data.children || []) {
                if (!seen.has(child.key)) {
                    seen.add(child.key);
                    allChildren.push({
                        key: child.key,
                        summary: child.summary,
                        type: child.issuetype,
                        localExists: child.localExists,
                    });
                    childToParent.set(child.key, parent);
                }
            }
        }
        catch (e) {
            console.warn(`Failed to fetch children for ${parent.key}:`, e.message);
        }
    }
    if (allChildren.length === 0)
        return;
    const newCount = allChildren.filter((c) => !c.localExists).length;
    const updateCount = allChildren.filter((c) => c.localExists).length;
    const parts = [];
    if (newCount)
        parts.push(`${newCount} new`);
    if (updateCount)
        parts.push(`${updateCount} to update`);
    const modalTitle = `Children in JIRA: ${parts.join(', ')}`;
    const selected = await showJiraSelectModal(modalTitle, allChildren, 'Import / Update selected');
    if (!selected.length)
        return;
    // Pull each group of children with their parent link so Epic_ID / Feature_ID is set.
    // Pre-include existing children in overwriteKeys so no second conflict dialog fires.
    for (const parent of parentIssues) {
        const childKeys = selected
            .filter((c) => childToParent.get(c.key)?.key === parent.key)
            .map((c) => c.key);
        const overwriteKeys = selected
            .filter((c) => childToParent.get(c.key)?.key === parent.key && c.localExists)
            .map((c) => c.key);
        if (childKeys.length) {
            await performJiraPull(childKeys, overwriteKeys, [], {
                filename: parent.filename,
                docType: parent.docType,
            });
        }
    }
}
//# sourceMappingURL=jira-import.js.map