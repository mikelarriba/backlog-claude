// ── Push to JIRA ──────────────────────────────────────────────
function updateJiraPushBtn() {
  const btn = document.getElementById('jira-push-btn');
  if (!btn) return;
  const isMultiStory = currentDocType === 'story' && currentFilename?.endsWith('-stories.md');
  if (isMultiStory) {
    btn.textContent = '↑ Push Stories';
  } else if (currentJiraId && currentJiraId !== 'TBD') {
    btn.textContent = '↑ Sync to JIRA';
  } else {
    btn.textContent = '↑ Push to JIRA';
  }
  btn.disabled = false;
}

async function pushToJira() {
  if (!currentFilename || !currentDocType) return;
  const btn = document.getElementById('jira-push-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Pushing…';

  try {
    const res = await fetch(
      `/api/jira/push/${currentDocType}/${encodeURIComponent(currentFilename)}`,
      { method: 'POST' }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(getErrorMessage(data.error, 'Push failed'));

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
      if (data.action === 'created') {
        currentJiraId = data.key;
        document.getElementById('status-select').value = 'Created in JIRA';
        const doc = allDocs.find(d => d.filename === currentFilename && d.docType === currentDocType);
        if (doc) { doc.status = 'Created in JIRA'; doc.jiraId = data.key; }
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
    const res  = await fetch(`/api/jira/search?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(getErrorMessage(data.error, 'Search failed'));

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

async function performJiraPull(keys, overwriteKeys) {
  const btn = document.getElementById('jira-download-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Downloading…';
  setJiraStatus('loading', `Downloading ${keys.length} issue(s)…`);

  try {
    const res  = await fetch('/api/jira/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys, overwriteKeys })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(getErrorMessage(data.error, 'Download failed'));

    let resolvedOverwrite = [...overwriteKeys];
    if (data.conflicts?.length) {
      const conflictList = data.conflicts.map(c => `${c.key} (${c.existingFilename})`).join('\n');
      const confirm = window.confirm(
        `${data.conflicts.length} issue(s) already exist locally:\n\n${conflictList}\n\nOverwrite?`
      );
      if (confirm) {
        resolvedOverwrite = [...resolvedOverwrite, ...data.conflicts.map(c => c.key)];
        btn.disabled = false;
        return performJiraPull(keys, resolvedOverwrite);
      }
    }

    const pullCount = data.pulled?.length || 0;
    if (pullCount > 0) {
      setJiraStatus('success', `✅ Downloaded ${pullCount} issue(s) successfully.`);
      const updatedRes = await fetch(`/api/jira/search?type=${document.getElementById('jira-type').value}&text=${encodeURIComponent(document.getElementById('jira-text').value)}`);
      if (updatedRes.ok) {
        const updatedData = await updatedRes.json();
        jiraSearchResults = updatedData.issues || [];
        renderJiraResults(jiraSearchResults);
      }
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
