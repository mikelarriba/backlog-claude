// ── JIRA selection modal ─────────────────────────────────────
var _jiraSelectResolve = null;
var _jiraSelectItems   = [];

function showJiraSelectModal(title, items, confirmLabel) {
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

function jiraSelectAll(checked) {
  document.querySelectorAll('#jira-select-list input[type=checkbox]').forEach(function(cb) { cb.checked = checked; });
}

function jiraSelectCancel() {
  document.getElementById('jira-select-overlay').classList.remove('show');
  if (_jiraSelectResolve) { _jiraSelectResolve([]); _jiraSelectResolve = null; }
}

function jiraSelectConfirm() {
  const selected = Array.from(
    document.querySelectorAll('#jira-select-list input[type=checkbox]:checked')
  ).map(function(cb) { return _jiraSelectItems[parseInt(cb.dataset.idx)]; });
  document.getElementById('jira-select-overlay').classList.remove('show');
  if (_jiraSelectResolve) { _jiraSelectResolve(selected); _jiraSelectResolve = null; }
}

// ── Push to JIRA ──────────────────────────────────────────────
const JIRA_CARET = ' <span class="toolbar-caret">▾</span>';

function updateJiraPushBtn() {
  const btn = document.getElementById('jira-push-btn');
  if (!btn) return;
  const isMultiStory = currentDocType === 'story' && currentFilename?.endsWith('-stories.md');
  btn.innerHTML = (isMultiStory ? '↑ Push Stories' : '↑ JIRA') + JIRA_CARET;
  btn.disabled = false;

  const hasJiraId     = !!(currentJiraId && currentJiraId !== 'TBD');
  const isParentType  = currentDocType === 'epic' || currentDocType === 'feature';

  const syncBtn = document.getElementById('jira-sync-status-btn');
  if (syncBtn) syncBtn.disabled = !hasJiraId;

  const childrenBtn = document.getElementById('jira-get-children-btn');
  if (childrenBtn) {
    childrenBtn.style.display = isParentType ? '' : 'none';
    childrenBtn.disabled = !hasJiraId;
  }
}

async function retrieveChildrenFromJira() {
  if (!currentFilename || !currentDocType) return;
  if (!currentJiraId || currentJiraId === 'TBD') return;
  await offerChildrenDownload([{ key: currentJiraId, filename: currentFilename, docType: currentDocType }]);
}

async function syncJiraStatus() {
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
async function updateFromJira(jiraKeyOverride) {
  if (!currentFilename || !currentDocType) return;

  const hasKey = currentJiraId && currentJiraId !== 'TBD';

  // If no JIRA_ID on the doc, show a small inline prompt in the dropdown
  if (!hasKey && !jiraKeyOverride) {
    showUpdateFromJiraKeyPrompt();
    return;
  }

  const key = jiraKeyOverride || currentJiraId;
  const btn = document.getElementById('jira-push-btn');
  btn.disabled    = true;
  btn.textContent = '⏳ Updating…';
  closeAllDropdowns();

  try {
    const data = await postJSON(
      `/api/jira/update-from-jira/${currentDocType}/${encodeURIComponent(currentFilename)}`,
      key !== currentJiraId ? { jiraKey: key } : {},
    );
    showJiraToast('success', `✅ Updated from ${data.key}`);
    // Reload the open doc to show new content
    if (currentFilename) openDoc(currentFilename, currentDocType);
    // Offer to sync children if this is a feature or epic
    if (currentDocType === 'feature' || currentDocType === 'epic') {
      await offerChildrenDownload([{ key: data.key, filename: currentFilename, docType: currentDocType }]);
    }
  } catch (e) {
    showJiraToast('error', `❌ ${e.message}`);
  } finally {
    updateJiraPushBtn();
  }
}

function showUpdateFromJiraKeyPrompt() {
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

function submitUpdateFromJiraKey() {
  const input = document.getElementById('jira-update-key-input');
  if (!input) return;
  const key = input.value.trim().toUpperCase();
  if (!key) { input.focus(); return; }
  closeAllDropdowns();
  updateFromJira(key);
}

async function pushToJira() {
  if (!currentFilename || !currentDocType) return;

  // For features/epics: let user select which children to also push
  let selectedChildren = [];
  if (currentDocType === 'feature' || currentDocType === 'epic') {
    try {
      const linksData = await fetchJSON(`/api/links/${currentDocType}/${encodeURIComponent(currentFilename)}`);
      const localChildren = linksData.children || [];
      if (localChildren.length > 0) {
        const modalItems = localChildren.map(c => ({
          key:      c.jiraId && c.jiraId !== 'TBD' ? c.jiraId : 'New',
          summary:  c.title,
          type:     TYPE_LABEL[c.docType] || c.docType,
          filename: c.filename,
          docType:  c.docType,
        }));
        selectedChildren = await showJiraSelectModal(
          `${localChildren.length} linked child issue(s) — select to push`,
          modalItems,
          'Push selected'
        );
      }
    } catch (e) { console.warn('Failed to load children for push:', e.message); }
  }

  const btn = document.getElementById('jira-push-btn');
  btn.disabled    = true;
  btn.textContent = '⏳ Pushing…';

  try {
    // Push the parent doc
    const data = await postJSON(
      `/api/jira/push/${currentDocType}/${encodeURIComponent(currentFilename)}`,
    );

    if (data.type === 'multi-story') {
      const created = data.results.filter(r => r.action === 'created').length;
      const updated = data.results.filter(r => r.action === 'updated').length;
      const parts = [];
      if (created) parts.push(`${created} created`);
      if (updated) parts.push(`${updated} synced`);
      showJiraToast('success', `✅ Stories pushed: ${parts.join(', ')}`);
      if (currentFilename) openDoc(currentFilename, currentDocType);
    } else {
      showJiraToast('success', `✅ ${data.action === 'created' ? 'Created' : 'Synced'} ${data.key} in JIRA`);
      if (currentFilename) openDoc(currentFilename, currentDocType);
    }

    // Push selected children
    if (selectedChildren.length > 0) {
      const childResults = [];
      for (const child of selectedChildren) {
        try {
          btn.textContent = `⏳ Pushing ${child.summary}…`;
          const childData = await postJSON(
            `/api/jira/push/${child.docType}/${encodeURIComponent(child.filename)}`,
          );
          if (childData.key) childResults.push({ key: childData.key, action: childData.action });
        } catch (e) { console.warn(`Failed to push child ${child.filename}:`, e.message); }
      }
      if (childResults.length > 0) {
        const created = childResults.filter(r => r.action === 'created').length;
        const updated = childResults.filter(r => r.action === 'updated').length;
        const parts = [];
        if (created) parts.push(`${created} created`);
        if (updated) parts.push(`${updated} synced`);
        showJiraToast('success', `✅ Children pushed: ${parts.join(', ')}`);
      }
    }

    updateJiraPushBtn();
  } catch (e) {
    showJiraToast('error', `❌ ${e.message}`);
    btn.disabled = false;
    updateJiraPushBtn();
  }
}

// ── JIRA Import ───────────────────────────────────────────────
function toggleJiraSection() {
  const body    = document.getElementById('jira-section-body');
  const chevron = document.getElementById('jira-chevron');
  const isOpen  = body.classList.toggle('open');
  chevron.style.transform = isOpen ? 'rotate(90deg)' : '';
}

async function searchJira() {
  const type      = document.getElementById('jira-type').value;
  const text      = document.getElementById('jira-text').value.trim();
  const btn       = document.getElementById('jira-search-btn');
  const resultsEl = document.getElementById('jira-results');

  btn.disabled = true;
  btn.textContent = 'Searching…';
  setJiraStatus('loading', 'Querying JIRA…');
  resultsEl.innerHTML = '';
  document.getElementById('jira-download-btn').style.display = 'none';

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

function renderJiraResults(issues) {
  const el = document.getElementById('jira-results');
  if (!issues.length) {
    el.innerHTML = '<div class="jira-empty">No results</div>';
    document.getElementById('jira-download-btn').style.display = 'none';
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

function toggleJiraItem(index) {
  const cb   = document.getElementById(`jira-cb-${index}`);
  const item = cb.closest('.jira-result-item');
  cb.checked = !cb.checked;
  item.classList.toggle('selected', cb.checked);
  updateDownloadBtn();
}

function updateDownloadBtn() {
  const count = document.querySelectorAll('#jira-results input[type=checkbox]:checked').length;
  const btn   = document.getElementById('jira-download-btn');
  btn.style.display = count > 0 ? 'block' : 'none';
  btn.textContent   = `⬇ Download ${count} issue${count !== 1 ? 's' : ''}`;
}

async function downloadSelected() {
  const checked = [...document.querySelectorAll('#jira-results input[type=checkbox]:checked')];
  const indices = checked.map(cb => parseInt(cb.id.replace('jira-cb-', '')));
  const keys    = indices.map(i => jiraSearchResults[i].key);
  if (!keys.length) return;
  await performJiraPull(keys, []);
}

async function performJiraPull(keys, overwriteKeys, _allPulled = [], parentLink = null) {
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
async function pullByKey() {
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

async function offerChildrenDownload(parentIssues) {
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
