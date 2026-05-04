// ── PI Roadmap View ────────────────────────────────────────────
var _roadmapPiName = null;
var _roadmapView   = 'stories'; // 'stories' | 'epics'

// Palette for epic bars — consistent hash-based colour
const _EPIC_COLORS = [
  '#3B82F6','#8B5CF6','#10B981','#14B8A6',
  '#F59E0B','#EC4899','#06B6D4','#6366F1',
];
function epicColor(key) {
  let h = 0;
  for (const c of (key || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return _EPIC_COLORS[h % _EPIC_COLORS.length];
}

function setRoadmapView(view) {
  _roadmapView = view;
  document.getElementById('rm-view-stories').classList.toggle('active', view === 'stories');
  document.getElementById('rm-view-epics').classList.toggle('active', view === 'epics');
  renderRoadmapBoard();
}

function openRoadmapView(piName) {
  if (!piName) return;
  _roadmapPiName = piName;

  // Hide other views
  document.getElementById('list-view').style.display = 'none';
  document.getElementById('refine-view')?.classList.remove('show');

  // Close any open detail without restoring list-view
  document.getElementById('detail-view').classList.remove('show');
  document.querySelector('.right').classList.remove('has-selection');
  currentFilename = null;
  currentDocType  = null;

  // Show roadmap — always start on Stories view
  _roadmapView = 'stories';
  document.getElementById('rm-view-stories').classList.add('active');
  document.getElementById('rm-view-epics').classList.remove('active');

  document.getElementById('roadmap-pi-name').textContent = piName;
  document.getElementById('roadmap-view').classList.add('show');
  document.querySelector('.right').classList.add('roadmap-mode');

  renderRoadmapBoard();
  closeAllDropdowns();
}

function closeRoadmapView() {
  document.getElementById('roadmap-view').classList.remove('show');
  document.querySelector('.right').classList.remove('roadmap-mode');
  document.querySelector('.right').classList.remove('has-selection');
  document.getElementById('detail-view').classList.remove('show');
  currentFilename = null;
  currentDocType  = null;
  document.getElementById('list-view').style.display = '';
  _roadmapPiName = null;
}

function isRoadmapOpen() {
  return document.getElementById('roadmap-view').classList.contains('show');
}

function refreshRoadmapView() {
  if (isRoadmapOpen() && _roadmapPiName) renderRoadmapBoard();
}

function renderRoadmapBoard() {
  const body   = document.getElementById('roadmap-body');
  const piName = _roadmapPiName;
  if (!piName) { body.innerHTML = ''; return; }

  const sprints = sprintConfig[piName];
  if (!sprints || !sprints.length) {
    body.classList.remove('et-mode');
    body.innerHTML = '<div class="roadmap-empty">No sprints configured for this PI. Open the PI Sprint Config panel to set them up.</div>';
    return;
  }

  if (_roadmapView === 'epics') {
    body.classList.add('et-mode');
    renderEpicTimeline(body, piName, sprints);
    return;
  }

  body.classList.remove('et-mode');

  // Get leaf docs in this PI
  const leafTypes = new Set(['story', 'spike', 'bug']);
  const piDocs = allDocs.filter(d => leafTypes.has(d.docType) && d.fixVersion === piName);

  // Group by sprint
  const grouped = new Map();
  const unassigned = [];
  for (const s of sprints) grouped.set(s.name, []);

  for (const d of piDocs) {
    if (d.sprint && grouped.has(d.sprint)) {
      grouped.get(d.sprint).push(d);
    } else {
      unassigned.push(d);
    }
  }

  // Build ghost-continuation map: sprintName → [{ doc, fromSprint }]
  // A card is a "split candidate" if SP >= splitThreshold
  const ghosts = new Map(); // sprintName → array of ghost entries
  for (const s of sprints) ghosts.set(s.name, []);

  for (let i = 0; i < sprints.length; i++) {
    const sprint = sprints[i];
    const docs   = grouped.get(sprint.name) || [];
    for (const d of docs) {
      const sp = Number(d.storyPoints) || 0;
      if (sp >= splitThreshold && i < sprints.length - 1) {
        const nextSprint = sprints[i + 1].name;
        ghosts.get(nextSprint).push({ doc: d, fromSprint: sprint.name });
      }
    }
  }

  // Capacity accounting: split-candidate cards contribute half SP to each sprint
  function effectiveSP(docs, sprintIndex) {
    return docs.reduce((sum, d) => {
      const sp = Number(d.storyPoints) || 0;
      const isCandidate = sp >= splitThreshold;
      // Half SP in assigned sprint, half shows in next sprint
      return sum + (isCandidate ? Math.ceil(sp / 2) : sp);
    }, 0);
  }

  // Render columns
  let html = '';
  for (let i = 0; i < sprints.length; i++) {
    const s     = sprints[i];
    const docs  = grouped.get(s.name) || [];
    const ghostList = ghosts.get(s.name) || [];
    // Effective SP: own items (halved if candidate) + ghost continuations (other half)
    const ownSP   = effectiveSP(docs, i);
    const ghostSP = ghostList.reduce((sum, g) => sum + Math.floor((Number(g.doc.storyPoints) || 0) / 2), 0);
    const usedSP  = ownSP + ghostSP;
    html += renderRoadmapColumn(s.name, docs, s.capacity, usedSP, ghostList);
  }
  // Unassigned column
  html += renderRoadmapColumn(null, unassigned, 0, 0, []);

  body.innerHTML = html;
  initRoadmapDragDrop();
}

function renderRoadmapColumn(sprintName, docs, capacity, usedSP, ghostList) {
  const isUnassigned = !sprintName;
  const label        = isUnassigned ? 'Unassigned' : escHtml(sprintName);
  const columnClass  = isUnassigned ? 'roadmap-column roadmap-unassigned' : 'roadmap-column';

  let statsHtml = '';
  let barHtml   = '';
  if (!isUnassigned && capacity > 0) {
    const pct      = Math.round((usedSP / capacity) * 100);
    const barClass = pct > 100 ? 'over' : pct > 90 ? 'warn' : '';
    const barWidth = Math.min(pct, 100);
    statsHtml = `<span class="roadmap-col-stats">${usedSP} / ${capacity} SP</span>`;
    barHtml   = `<div class="roadmap-capacity-bar ${barClass}"><div class="roadmap-capacity-fill" style="width:${barWidth}%"></div></div>`;
  } else if (!isUnassigned) {
    statsHtml = `<span class="roadmap-col-stats">${usedSP} SP</span>`;
  } else {
    statsHtml = `<span class="roadmap-col-stats">${docs.length} item(s)</span>`;
  }

  // Ghost cards come first (they're continuations from the previous sprint)
  const ghostsHtml = ghostList.map(g => renderGhostCard(g.doc, g.fromSprint, sprintName)).join('');

  const cardsHtml = docs.length
    ? docs.map(d => renderRoadmapCard(d, sprintName)).join('')
    : '';

  const emptyHtml = !docs.length && !ghostList.length
    ? '<div class="roadmap-card-empty">No items</div>'
    : '';

  return `
    <div class="${columnClass}" data-sprint="${sprintName ? escHtml(sprintName) : ''}">
      <div class="roadmap-column-header">
        <span class="roadmap-col-name">${label}</span>
        ${statsHtml}
      </div>
      ${barHtml}
      <div class="roadmap-card-list" data-sprint="${sprintName ? escHtml(sprintName) : ''}">
        ${ghostsHtml}${cardsHtml}${emptyHtml}
      </div>
    </div>`;
}

function renderRoadmapCard(d, sprintName) {
  const priorityClass = (d.priority || 'Medium').replace(/\s+/g, '-').toLowerCase();
  const sp            = Number(d.storyPoints) || 0;
  const spLabel       = sp ? `${sp} SP` : 'No SP';
  const spClass       = sp ? 'rm-badge rm-sp' : 'rm-badge rm-no-sp';
  const isCandidate   = sp >= splitThreshold;

  // Find parent epic title
  let parentHtml = '';
  if (d.parentFilename) {
    const parent = allDocs.find(p => p.filename === d.parentFilename);
    if (parent) parentHtml = `<div class="roadmap-card-parent">${escHtml(parent.title)}</div>`;
  }

  const candidateBadge = isCandidate
    ? `<span class="rm-badge rm-split-candidate" title="This card spans 2 sprints (${sp} SP ≥ ${splitThreshold} SP threshold)">↔ 2 sprints</span>`
    : '';

  const splitBtn = isCandidate
    ? `<button class="rm-split-btn" onclick="event.stopPropagation(); openSplitModal('${escHtml(d.filename)}','${d.docType}','${escHtml(sprintName || '')}')">Split with AI</button>`
    : '';

  const cardClass = `roadmap-card${isCandidate ? ' rm-split-candidate-card' : ''}`;

  return `
    <div class="${cardClass}" draggable="true"
         onclick="openDoc('${escHtml(d.filename)}','${d.docType}')"
         data-filename="${escHtml(d.filename)}"
         data-doctype="${d.docType}"
         data-sprint="${d.sprint ? escHtml(d.sprint) : ''}">
      ${parentHtml}
      <div class="roadmap-card-title">${escHtml(d.title)}</div>
      <div class="roadmap-card-meta">
        <span class="rm-badge rm-type-${d.docType}">${TYPE_LABEL[d.docType] || d.docType}</span>
        <span class="rm-badge rm-priority-${priorityClass}">${escHtml(d.priority || 'Medium')}</span>
        <span class="${spClass}">${spLabel}</span>
        ${candidateBadge}
      </div>
      ${splitBtn}
    </div>`;
}

function renderGhostCard(d, fromSprint, inSprint) {
  const sp = Number(d.storyPoints) || 0;
  return `
    <div class="roadmap-card rm-ghost-card"
         onclick="openDoc('${escHtml(d.filename)}','${d.docType}')"
         data-filename="${escHtml(d.filename)}"
         data-doctype="${d.docType}"
         data-sprint="${d.sprint ? escHtml(d.sprint) : ''}">
      <div class="rm-ghost-label">↩ Continued from ${escHtml(fromSprint)}</div>
      <div class="roadmap-card-title">${escHtml(d.title)}</div>
      <div class="roadmap-card-meta">
        <span class="rm-badge rm-sp">${sp} SP (cont.)</span>
      </div>
      <button class="rm-split-btn" onclick="event.stopPropagation(); openSplitModal('${escHtml(d.filename)}','${d.docType}','${escHtml(fromSprint)}','${escHtml(inSprint)}')">Split with AI</button>
    </div>`;
}

// ── Drag and drop ─────────────────────────────────────────────
function initRoadmapDragDrop() {
  const cards    = document.querySelectorAll('.roadmap-card[draggable]');
  const dropZones = document.querySelectorAll('.roadmap-card-list');

  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        filename:   card.dataset.filename,
        docType:    card.dataset.doctype,
        fromSprint: card.dataset.sprint,
      }));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      dropZones.forEach(z => z.classList.remove('drag-over'));
    });
  });

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      try {
        const data     = JSON.parse(e.dataTransfer.getData('text/plain'));
        const toSprint = zone.dataset.sprint || null;
        if (data.fromSprint === (toSprint || '')) return;

        const res = await fetch(`/api/doc/${data.docType}/${encodeURIComponent(data.filename)}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ sprint: toSprint }),
        });
        if (!res.ok) return;

        const doc = allDocs.find(d => d.filename === data.filename && d.docType === data.docType);
        if (doc) doc.sprint = toSprint;

        renderRoadmapBoard();
      } catch {}
    });
  });
}

// ── Roadmap dropdown population ───────────────────────────────
function populateRoadmapDropdown() {
  const menu = document.getElementById('roadmap-dropdown-menu');
  if (!menu) return;
  let html = '';
  if (piSettings.currentPi) {
    html += `<button class="dropdown-item" onclick="openRoadmapView('${escHtml(piSettings.currentPi)}');closeDropdown('roadmap-dropdown-menu')">
      <span class="di-badge">Current</span>${escHtml(piSettings.currentPi)}</button>`;
  }
  if (piSettings.nextPi) {
    html += `<button class="dropdown-item" onclick="openRoadmapView('${escHtml(piSettings.nextPi)}');closeDropdown('roadmap-dropdown-menu')">
      <span class="di-badge">Next</span>${escHtml(piSettings.nextPi)}</button>`;
  }
  if (!html) {
    html = '<div class="dropdown-item" style="opacity:0.5;cursor:default">No PIs configured</div>';
  }
  menu.innerHTML = html;
}

// ── AI Split modal ────────────────────────────────────────────
var _splitModalFilename = null;
var _splitModalDocType  = null;
var _splitModalSprint1  = null;
var _splitModalSprint2  = null;

function openSplitModal(filename, docType, sprint1, sprint2) {
  _splitModalFilename = filename;
  _splitModalDocType  = docType;
  _splitModalSprint1  = sprint1 || null;
  _splitModalSprint2  = sprint2 || null;

  const doc = allDocs.find(d => d.filename === filename && d.docType === docType);
  const sp  = Number(doc?.storyPoints) || 0;
  const sprints = _roadmapPiName ? (sprintConfig[_roadmapPiName] || []) : [];

  // Build sprint selectors
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

// ── Epic Timeline View ────────────────────────────────────────
function renderEpicTimeline(body, piName, sprints) {
  const N = sprints.length;
  const leafTypes = new Set(['story', 'spike', 'bug']);
  const piLeafs   = allDocs.filter(d => leafTypes.has(d.docType) && d.fixVersion === piName);

  // Sprint index lookup
  const sprintIdx = new Map(sprints.map((s, i) => [s.name, i]));

  // Group leaves by their epic/feature parent (or __none__ if unlinked)
  const epicGroups = new Map(); // epicFilename | '__none__' → { epicDoc, stories }

  for (const leaf of piLeafs) {
    const key = leaf.parentFilename || '__none__';
    if (!epicGroups.has(key)) {
      const epicDoc = leaf.parentFilename
        ? allDocs.find(d => d.filename === leaf.parentFilename)
        : null;
      epicGroups.set(key, { epicDoc, stories: [] });
    }
    epicGroups.get(key).stories.push(leaf);
  }

  if (!epicGroups.size) {
    body.innerHTML = '<div class="roadmap-empty">No stories assigned to this PI yet.</div>';
    return;
  }

  // Sort groups: named epics first (by title), then unlinked
  const sorted = [...epicGroups.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === '__none__') return 1;
    if (kb === '__none__') return -1;
    return (a.epicDoc?.title || ka).localeCompare(b.epicDoc?.title || kb);
  });

  // ── Header row ─────────────────────────────────────────────
  const sprintHeaderCells = sprints.map(s => `
    <div class="et-sprint-header">
      <div class="et-sprint-name">${escHtml(s.name)}</div>
      ${s.capacity ? `<div class="et-sprint-cap">${s.capacity} SP</div>` : ''}
    </div>`).join('');

  // ── Epic rows ───────────────────────────────────────────────
  let rowsHtml = '';
  for (const [key, { epicDoc, stories }] of sorted) {
    const isNone  = key === '__none__';
    const title   = epicDoc?.title || (isNone ? 'No Epic' : key);
    const epicFn  = epicDoc?.filename || null;
    const color   = isNone ? 'var(--muted)' : epicColor(key);

    // Compute sprint range from assigned stories
    const indices = stories
      .filter(s => s.sprint && sprintIdx.has(s.sprint))
      .map(s => sprintIdx.get(s.sprint));
    const minIdx     = indices.length ? Math.min(...indices) : -1;
    const maxIdx     = indices.length ? Math.max(...indices) : -1;
    const sprintSpan = maxIdx >= 0 ? maxIdx - minIdx + 1 : 0;

    const totalSP        = stories.reduce((sum, s) => sum + (Number(s.storyPoints) || 0), 0);
    const assignedCount  = stories.filter(s => s.sprint).length;
    const unassignedCount = stories.length - assignedCount;

    // Meta line shown in the name column
    const metaParts = [];
    if (sprintSpan)       metaParts.push(`${sprintSpan} sprint${sprintSpan !== 1 ? 's' : ''}`);
    if (stories.length)   metaParts.push(`${stories.length} item${stories.length !== 1 ? 's' : ''}`);
    if (totalSP)          metaParts.push(`${totalSP} SP`);
    if (unassignedCount)  metaParts.push(`${unassignedCount} unscheduled`);

    // Bar geometry (as percentage of the sprint row width)
    let barHtml = '';
    if (minIdx >= 0) {
      const leftPct  = ((minIdx / N) * 100).toFixed(2);
      const widthPct = (((maxIdx - minIdx + 1) / N) * 100).toFixed(2);
      const label    = `${sprintSpan} sprint${sprintSpan !== 1 ? 's' : ''} · ${stories.length} item${stories.length !== 1 ? 's' : ''}${totalSP ? ' · ' + totalSP + ' SP' : ''}`;
      const click    = epicFn ? `onclick="event.stopPropagation(); openDoc('${escHtml(epicFn)}','${epicDoc.docType || 'epic'}')"` : '';
      barHtml = `
        <div class="et-bar" style="left:${leftPct}%;width:${widthPct}%;background:${color};" ${click}
             title="${escHtml(title)}">
          <span class="et-bar-label">${escHtml(label)}</span>
        </div>`;
    } else {
      barHtml = `
        <div class="et-bar et-bar-unscheduled">
          <span class="et-bar-label">All unscheduled (${stories.length})</span>
        </div>`;
    }

    // Sprint grid cells (background lines)
    const cells = sprints.map((_, i) =>
      `<div class="et-sprint-cell${i === N - 1 ? ' et-last' : ''}"></div>`
    ).join('');

    const rowClick = epicFn ? `onclick="openDoc('${escHtml(epicFn)}','${epicDoc.docType || 'epic'}')"` : '';

    rowsHtml += `
      <div class="et-epic-row" ${rowClick} style="cursor:${epicFn ? 'pointer' : 'default'}">
        <div class="et-name-col">
          <div class="et-epic-dot" style="background:${isNone ? 'var(--muted)' : color}"></div>
          <div class="et-name-text">
            <div class="et-epic-title">${escHtml(title)}</div>
            <div class="et-epic-meta">${escHtml(metaParts.join(' · '))}</div>
          </div>
        </div>
        <div class="et-sprints-row">
          ${cells}
          ${barHtml}
        </div>
      </div>`;
  }

  body.innerHTML = `
    <div class="et-timeline">
      <div class="et-header-row">
        <div class="et-name-col et-header-label">Epic / Feature</div>
        <div class="et-sprints-row et-header-sprints">${sprintHeaderCells}</div>
      </div>
      ${rowsHtml}
    </div>`;
}
