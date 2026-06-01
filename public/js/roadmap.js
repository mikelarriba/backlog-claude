// ── Roadmap View coordinator (Two-Panel: Epics + Stories) ──────
let _roadmapVisiblePis   = new Set();  // checked PI names (empty = show none)
let _roadmapPanelState   = { epics: true, stories: true }; // expanded/collapsed
let _roadmapFocusedFeature = null;  // filename of clicked feature (focus mode)

// ── Open / Close ─────────────────────────────────────────────
function openRoadmapView() {
  // Hide other views
  document.getElementById('list-view').style.display = 'none';
  document.getElementById('refine-view')?.classList.remove('show');
  document.getElementById('detail-view').classList.remove('show');
  document.querySelector('.right').classList.remove('has-selection');
  currentFilename = null;
  currentDocType  = null;

  // Show roadmap
  document.getElementById('roadmap-view').classList.add('show');
  document.querySelector('.right').classList.add('roadmap-mode');

  // Populate PI filter checkboxes
  populateRoadmapPiFilter();

  // Reset focus
  _roadmapFocusedFeature = null;

  renderRoadmapBoard();
}

function closeRoadmapView() {
  document.getElementById('roadmap-view').classList.remove('show');
  document.querySelector('.right').classList.remove('roadmap-mode');
  document.querySelector('.right').classList.remove('has-selection');
  document.getElementById('detail-view').classList.remove('show');
  currentFilename = null;
  currentDocType  = null;
  document.getElementById('list-view').style.display = '';
  _roadmapVisiblePis.clear();
  _roadmapFocusedFeature = null;
}

function isRoadmapOpen() {
  return document.getElementById('roadmap-view').classList.contains('show');
}

function refreshRoadmapView() {
  if (isRoadmapOpen()) renderRoadmapBoard();
}

// ── PI Filter (checkboxes) ───────────────────────────────────
function populateRoadmapPiFilter() {
  const container = document.getElementById('roadmap-pi-filter');
  if (!container) return;
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  // On first open, check all PIs
  if (!_roadmapVisiblePis.size) pis.forEach(p => _roadmapVisiblePis.add(p));
  let html = '';
  for (const pi of pis) {
    const checked = _roadmapVisiblePis.has(pi) ? ' checked' : '';
    html += `<label class="rm-pi-checkbox"><input type="checkbox"${checked} onchange="toggleRoadmapPi('${escHtml(pi)}', this.checked)"><span>${escHtml(pi)}</span></label>`;
  }
  container.innerHTML = html;
}

function toggleRoadmapPi(piName, checked) {
  if (checked) _roadmapVisiblePis.add(piName);
  else _roadmapVisiblePis.delete(piName);
  renderRoadmapBoard();
}

// ── Panel collapse ───────────────────────────────────────────
function toggleRoadmapPanel(panel) {
  _roadmapPanelState[panel] = !_roadmapPanelState[panel];
  const body    = document.getElementById(`rm-body-${panel}`);
  const chevron = document.getElementById(`rm-chevron-${panel}`);
  if (_roadmapPanelState[panel]) {
    body.classList.remove('collapsed');
    chevron.textContent = '▼';
  } else {
    body.classList.add('collapsed');
    chevron.textContent = '▶';
  }
}

// ── Feature focus (click on feature row) ────────────────────
function focusFeature(filename) {
  if (_roadmapFocusedFeature === filename) {
    _roadmapFocusedFeature = null; // toggle off
  } else {
    _roadmapFocusedFeature = filename;
  }
  applyFeatureFocus();
}

function applyFeatureFocus() {
  // Feature panel: highlight focused feature
  document.querySelectorAll('.rm-epic-card').forEach(card => {
    card.classList.toggle('rm-focused', card.dataset.filename === _roadmapFocusedFeature);
    card.classList.toggle('rm-dimmed', _roadmapFocusedFeature && card.dataset.filename !== _roadmapFocusedFeature);
  });

  // Story panel: dim stories not under the focused feature
  document.querySelectorAll('.roadmap-card').forEach(card => {
    if (!_roadmapFocusedFeature) {
      card.classList.remove('rm-dimmed');
      return;
    }
    const feature = card.dataset.feature || '';
    card.classList.toggle('rm-dimmed', feature !== _roadmapFocusedFeature);
  });
}

// ── Push Sprints to JIRA ────────────────────────────────────
async function pushSprintsToJira() {
  const leafTypes = new Set(['story', 'spike', 'bug']);
  const items = allDocs.filter(d =>
    leafTypes.has(d.docType) && d.sprint && d.jiraId
  ).map(d => ({ filename: d.filename, docType: d.docType, sprint: d.sprint }));

  if (!items.length) {
    showJiraToast('warn', 'No stories with both a sprint and JIRA ID found.');
    return;
  }

  if (!confirm(`Push sprint assignments for ${items.length} item(s) to JIRA?`)) return;

  try {
    const res = await postJSON('/api/jira/push-sprints', { items });
    const ok = (res.results || []).filter(r => r.status === 'ok').length;
    const skipped = (res.results || []).filter(r => r.status === 'skipped').length;
    const errors = (res.results || []).filter(r => r.status === 'error').length;
    let msg = `Sprints pushed: ${ok} updated`;
    if (skipped) msg += `, ${skipped} skipped`;
    if (errors) msg += `, ${errors} failed`;
    showJiraToast(errors ? 'warn' : 'success', msg);
  } catch (e) {
    showJiraToast('error', 'Failed to push sprints: ' + e.message);
  }
}

// ── Gather all sprints across visible PIs ────────────────────
function getAllSprints() {
  const all = [];
  const seen = new Set();
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  for (const pi of pis) {
    if (!_roadmapVisiblePis.has(pi)) continue; // skip unchecked PIs
    for (const s of (sprintConfig[pi] || [])) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        all.push(s);
      }
    }
  }
  return all;
}

// ── Dependency modal ─────────────────────────────────────────
let _depModalFilename = null;
let _depModalDocType  = null;

async function openDepModal(filename, docType) {
  _depModalFilename = filename;
  _depModalDocType  = docType;

  const doc = allDocs.find(d => d.filename === filename);
  document.getElementById('dep-modal-subtitle').textContent = doc?.title || filename;

  // Reset state
  document.getElementById('dep-blocks-list').innerHTML   = '<div class="dep-loading">Loading…</div>';
  document.getElementById('dep-blockedby-list').innerHTML = '';

  document.getElementById('dep-overlay').classList.add('show');

  try {
    const data = await fetch(`/api/links/${encodeURIComponent(docType)}/${encodeURIComponent(filename)}`).then(r => r.json());
    renderDepLists(data);
    populateDepTargetSelect(filename, data);
  } catch (e) {
    document.getElementById('dep-blocks-list').innerHTML = `<div class="dep-error">${escHtml(e.message)}</div>`;
  }
}

function renderDepLists(data) {
  function depItemHtml(item, direction) {
    return `
      <div class="dep-item">
        <span class="dep-item-title">${escHtml(item.title || item.filename)}</span>
        <button class="btn-ghost btn-xs dep-remove-btn"
                onclick="removeDepLink('${escHtml(item.filename)}','${escHtml(item.docType || _depModalDocType)}','${direction}')"
                title="Remove">&times;</button>
      </div>`;
  }

  const blocksList    = document.getElementById('dep-blocks-list');
  const blockedByList = document.getElementById('dep-blockedby-list');

  blocksList.innerHTML = (data.blocks || []).length
    ? (data.blocks || []).map(item => depItemHtml(item, 'blocks')).join('')
    : '<div class="dep-empty">None</div>';

  blockedByList.innerHTML = (data.blockedBy || []).length
    ? (data.blockedBy || []).map(item => depItemHtml(item, 'blockedBy')).join('')
    : '<div class="dep-empty">None</div>';

  const parallelList = document.getElementById('dep-parallel-list');
  if (parallelList) {
    parallelList.innerHTML = (data.parallel || []).length
      ? (data.parallel || []).map(item => depItemHtml(item, 'parallel')).join('')
      : '<div class="dep-empty">None</div>';
  }
}

function populateDepTargetSelect(excludeFilename, currentData) {
  const leafTypes = new Set(['story', 'spike', 'bug']);
  const alreadyBlocks   = new Set((currentData.blocks   || []).map(b => b.filename));
  const alreadyParallel = new Set((currentData.parallel || []).map(p => p.filename));
  alreadyBlocks.add(excludeFilename);
  alreadyParallel.add(excludeFilename);

  const allCandidates = allDocs
    .filter(d => leafTypes.has(d.docType))
    .sort((a, b) => (a.title || a.filename).localeCompare(b.title || b.filename));

  const blockCandidates    = allCandidates.filter(d => !alreadyBlocks.has(d.filename));
  const parallelCandidates = allCandidates.filter(d => !alreadyParallel.has(d.filename));

  const select = document.getElementById('dep-target-select');
  if (select) {
    select.innerHTML = blockCandidates.length
      ? blockCandidates.map(d => `<option value="${escHtml(d.filename)}" data-doctype="${d.docType}">${escHtml(d.title || d.filename)}</option>`).join('')
      : '<option value="" disabled>No candidates</option>';
  }

  const parallelSelect = document.getElementById('dep-parallel-select');
  if (parallelSelect) {
    parallelSelect.innerHTML = parallelCandidates.length
      ? parallelCandidates.map(d => `<option value="${escHtml(d.filename)}" data-doctype="${d.docType}">${escHtml(d.title || d.filename)}</option>`).join('')
      : '<option value="" disabled>No candidates</option>';
  }
}

async function addDepLink() {
  const select = document.getElementById('dep-target-select');
  const targetFilename = select.value;
  if (!targetFilename) return;
  const targetDocType  = select.selectedOptions[0]?.dataset.doctype || 'story';

  try {
    await postJSON('/api/link', {
      linkType: 'blocks',
      sourceType: _depModalDocType, sourceFilename: _depModalFilename,
      targetType: targetDocType,    targetFilename,
    });
    // Refresh modal
    const data = await fetch(`/api/links/${encodeURIComponent(_depModalDocType)}/${encodeURIComponent(_depModalFilename)}`).then(r => r.json());
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename, data);
    // Update allDocs entry
    const srcDoc = allDocs.find(d => d.filename === _depModalFilename);
    if (srcDoc) { srcDoc.blocks = srcDoc.blocks || []; if (!srcDoc.blocks.includes(targetFilename)) srcDoc.blocks.push(targetFilename); }
    const tgtDoc = allDocs.find(d => d.filename === targetFilename);
    if (tgtDoc) { tgtDoc.blockedBy = tgtDoc.blockedBy || []; if (!tgtDoc.blockedBy.includes(_depModalFilename)) tgtDoc.blockedBy.push(_depModalFilename); }
    renderRoadmapBoard();
  } catch (e) { showJiraToast('error', e.message); }
}

async function addParallelLink() {
  const select = document.getElementById('dep-parallel-select');
  if (!select) return;
  const targetFilename = select.value;
  if (!targetFilename) return;
  const targetDocType = select.selectedOptions[0]?.dataset.doctype || 'story';

  try {
    await postJSON('/api/link', {
      linkType: 'parallel',
      sourceType: _depModalDocType, sourceFilename: _depModalFilename,
      targetType: targetDocType,    targetFilename,
    });
    const data = await fetch(`/api/links/${encodeURIComponent(_depModalDocType)}/${encodeURIComponent(_depModalFilename)}`).then(r => r.json());
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename, data);
    renderRoadmapBoard();
  } catch (e) { showJiraToast('error', e.message); }
}

async function removeDepLink(targetFilename, targetDocType, direction) {
  try {
    let srcFilename, srcDocType, tgtFilename, tgtDocType, linkType;
    if (direction === 'parallel') {
      linkType    = 'parallel';
      srcFilename = _depModalFilename; srcDocType = _depModalDocType;
      tgtFilename = targetFilename;    tgtDocType = targetDocType;
    } else if (direction === 'blocks') {
      linkType    = 'blocks';
      srcFilename = _depModalFilename; srcDocType = _depModalDocType;
      tgtFilename = targetFilename;    tgtDocType = targetDocType;
    } else {
      linkType    = 'blocks';
      srcFilename = targetFilename;    srcDocType = targetDocType;
      tgtFilename = _depModalFilename; tgtDocType = _depModalDocType;
    }
    await fetch('/api/link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkType, sourceType: srcDocType, sourceFilename: srcFilename, targetType: tgtDocType, targetFilename: tgtFilename }),
    });
    // Refresh modal
    const data = await fetch(`/api/links/${encodeURIComponent(_depModalDocType)}/${encodeURIComponent(_depModalFilename)}`).then(r => r.json());
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename, data);
    // Update allDocs entries
    const srcDoc = allDocs.find(d => d.filename === srcFilename);
    if (srcDoc) srcDoc.blocks = (srcDoc.blocks || []).filter(f => f !== tgtFilename);
    const tgtDoc = allDocs.find(d => d.filename === tgtFilename);
    if (tgtDoc) tgtDoc.blockedBy = (tgtDoc.blockedBy || []).filter(f => f !== srcFilename);
    renderRoadmapBoard();
  } catch (e) { showJiraToast('error', e.message); }
}

function closeDepModal() {
  document.getElementById('dep-overlay').classList.remove('show');
  _depModalFilename = null;
  _depModalDocType  = null;
}

// ── Split modal (kept from old roadmap) ──────────────────────
let _splitModalFilename = null;
let _splitModalDocType  = null;
let _splitModalSprint1  = null;
let _splitModalSprint2  = null;

function openSplitModal(filename, docType, sprint1, sprint2) {
  _splitModalFilename = filename;
  _splitModalDocType  = docType;
  _splitModalSprint1  = sprint1 || null;
  _splitModalSprint2  = sprint2 || null;

  const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
  const sp  = Number(doc?.storyPoints) || 0;
  const sprints = getAllSprints();

  const sprintOptions = sprints.map(s =>
    `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`
  ).join('');

  const sel1 = sprint1 ? `<option value="${escHtml(sprint1)}" selected>${escHtml(sprint1)}</option>${sprintOptions}` : sprintOptions;
  const sel2 = sprint2 ? `<option value="${escHtml(sprint2)}" selected>${escHtml(sprint2)}</option>${sprintOptions}` : sprintOptions;

  document.getElementById('split-modal-title').textContent = doc?.title || filename;
  document.getElementById('split-modal-sp').textContent = sp ? `${sp} SP → ~${Math.round(sp / 2)} SP each` : 'No SP estimate';
  document.getElementById('split-sprint-1').innerHTML = sel1;
  document.getElementById('split-sprint-2').innerHTML = sel2;
  document.getElementById('split-modal-output').innerHTML = '';
  document.getElementById('split-modal-status').className = 'split-modal-status';

  const applyBtn = document.getElementById('split-apply-btn');
  applyBtn.disabled = false;
  applyBtn.textContent = 'Split with AI';

  document.getElementById('split-overlay').classList.add('show');
}

function closeSplitModal() {
  document.getElementById('split-overlay').classList.remove('show');
  _splitModalFilename = null;
  _splitModalDocType  = null;
}

async function executeSplit() {
  if (!_splitModalFilename) return;

  const sprint1 = document.getElementById('split-sprint-1').value;
  const sprint2 = document.getElementById('split-sprint-2').value;
  const btn     = document.getElementById('split-apply-btn');
  const output  = document.getElementById('split-modal-output');
  const status  = document.getElementById('split-modal-status');

  btn.disabled    = true;
  btn.textContent = 'Splitting…';
  output.textContent = '';
  status.className   = 'split-modal-status';

  try {
    const res = await fetch('/api/docs/split-story', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        filename:    _splitModalFilename,
        docType:     _splitModalDocType,
        targetCount: 2,
        sprints:     [sprint1, sprint2].filter(Boolean),
      }),
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done   = false;
    let result = null;

    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.error) throw new Error(payload.error.message || 'Split failed');
          if (payload.text)  output.textContent += payload.text;
          if (payload.done) { result = payload; done = true; }
        } catch (parseErr) {
          if (parseErr.message !== 'Split failed') continue;
          throw parseErr;
        }
      }
    }

    if (result) {
      status.className   = 'split-modal-status show success';
      status.textContent = `Created ${result.files.length} stories. Original deleted.`;
      btn.textContent    = 'Done';
      setTimeout(() => closeSplitModal(), 2000);
    }
  } catch (err) {
    status.className   = 'split-modal-status show error';
    status.textContent = err.message || 'Split failed';
    btn.disabled       = false;
    btn.textContent    = 'Retry';
  }
}
