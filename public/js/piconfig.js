// ── PI Sprint Configuration ────────────────────────────────────
var _piConfigActivePi = null;

function togglePiConfigSection() {
  const body    = document.getElementById('pi-config-body');
  const chevron = document.getElementById('pi-config-chevron');
  const isOpen  = body.classList.toggle('open');
  chevron.style.transform = isOpen ? 'rotate(90deg)' : '';
  if (isOpen && !_piConfigActivePi) {
    renderPiConfigTabs();
  }
}

function renderPiConfigTabs() {
  const tabs = document.getElementById('pi-config-tabs');
  const pis = [];
  if (piSettings.currentPi) pis.push({ key: 'currentPi', label: 'Current PI', name: piSettings.currentPi });
  if (piSettings.nextPi)    pis.push({ key: 'nextPi',    label: 'Next PI',    name: piSettings.nextPi });

  if (!pis.length) {
    tabs.innerHTML = '<div class="pi-config-empty">Set PI versions in swimlane headers first.</div>';
    document.getElementById('pi-config-sprints').innerHTML = '';
    return;
  }

  tabs.innerHTML = pis.map(p =>
    `<button class="pi-config-tab${_piConfigActivePi === p.name ? ' active' : ''}"
             onclick="selectPiConfigTab('${escHtml(p.name)}')">${escHtml(p.label)}<span class="pi-config-tab-name">${escHtml(p.name)}</span></button>`
  ).join('');

  if (!_piConfigActivePi) selectPiConfigTab(pis[0].name);
}

async function selectPiConfigTab(piName) {
  _piConfigActivePi = piName;
  // Update active tab style
  document.querySelectorAll('.pi-config-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.includes(piName));
  });
  await loadSprintConfigForPi(piName);
}

async function loadSprintConfigForPi(piName) {
  try {
    const res = await fetch(`/api/settings/pi/sprints/${encodeURIComponent(piName)}`);
    const data = await res.json();
    const sprints = data.sprints && data.sprints.length ? data.sprints : [
      { name: 'Sprint 1', capacity: 40 },
      { name: 'Sprint 2', capacity: 40 },
      { name: 'Sprint 3', capacity: 40 },
      { name: 'Sprint 4', capacity: 40 },
    ];
    sprintConfig[piName] = sprints;
    renderSprintRows(sprints);
  } catch {
    renderSprintRows([]);
  }
}

function renderSprintRows(sprints) {
  const container = document.getElementById('pi-config-sprints');
  if (!sprints.length) {
    container.innerHTML = '<div class="pi-config-empty">No sprints defined. Click "+ Add Sprint".</div>';
    return;
  }
  container.innerHTML = sprints.map((s, i) => `
    <div class="pi-config-sprint-row" data-idx="${i}">
      <input class="pi-config-sprint-name" type="text" value="${escHtml(s.name)}" placeholder="Sprint name" />
      <div class="pi-config-capacity-wrap">
        <input class="pi-config-sprint-cap" type="number" min="0" max="999" value="${s.capacity}" placeholder="SP" />
        <span class="pi-config-cap-label">SP</span>
      </div>
      <button class="pi-config-remove-btn" onclick="removeSprintRow(${i})" title="Remove sprint">&times;</button>
    </div>
  `).join('');
}

function addSprintRow() {
  if (!_piConfigActivePi) return;
  const sprints = sprintConfig[_piConfigActivePi] || [];
  const nextNum = sprints.length + 1;
  sprints.push({ name: `Sprint ${nextNum}`, capacity: 40 });
  sprintConfig[_piConfigActivePi] = sprints;
  renderSprintRows(sprints);
}

function removeSprintRow(index) {
  if (!_piConfigActivePi) return;
  const sprints = sprintConfig[_piConfigActivePi] || [];
  if (sprints.length <= 1) return; // keep at least one
  sprints.splice(index, 1);
  sprintConfig[_piConfigActivePi] = sprints;
  renderSprintRows(sprints);
}

function collectSprintRows() {
  const rows = document.querySelectorAll('.pi-config-sprint-row');
  return Array.from(rows).map(row => ({
    name: row.querySelector('.pi-config-sprint-name').value.trim(),
    capacity: Number(row.querySelector('.pi-config-sprint-cap').value) || 0,
  })).filter(s => s.name);
}

async function saveSprintConfig() {
  if (!_piConfigActivePi) return;
  const sprints = collectSprintRows();
  if (!sprints.length) {
    setPiConfigStatus('error', 'At least one sprint with a name is required.');
    return;
  }

  const btn = document.getElementById('pi-config-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const res = await fetch(`/api/settings/pi/sprints/${encodeURIComponent(_piConfigActivePi)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprints }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    sprintConfig[_piConfigActivePi] = data.sprints;
    renderSprintRows(data.sprints);
    setPiConfigStatus('success', 'Sprint configuration saved.');
  } catch (e) {
    setPiConfigStatus('error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Configuration';
  }
}

function setPiConfigStatus(type, message) {
  const el = document.getElementById('pi-config-status');
  el.className = `pi-config-status${type !== 'hidden' ? ' show ' + type : ''}`;
  el.textContent = message || '';
  if (type === 'success') setTimeout(() => { el.className = 'pi-config-status'; }, 3000);
}

// Load sprint config for both PIs (called during init)
async function loadAllSprintConfigs() {
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean);
  for (const piName of pis) {
    try {
      const res = await fetch(`/api/settings/pi/sprints/${encodeURIComponent(piName)}`);
      const data = await res.json();
      if (data.sprints && data.sprints.length) {
        sprintConfig[piName] = data.sprints;
      }
    } catch {}
  }
  try {
    const res = await fetch('/api/settings/pi/split-threshold');
    const data = await res.json();
    splitThreshold = data.splitThreshold ?? 8;
    const el = document.getElementById('split-threshold-input');
    if (el) el.value = splitThreshold;
  } catch {}
}

async function saveSplitThreshold(value) {
  const val = parseInt(value, 10);
  if (!val || val < 1) return;
  try {
    const res = await fetch('/api/settings/pi/split-threshold', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ splitThreshold: val }),
    });
    if (res.ok) {
      splitThreshold = val;
      refreshRoadmapView();
      setPiConfigStatus('success', `Split threshold set to ${val} SP`);
    }
  } catch {}
}

// Get sprint names for a given PI version name
function getSprintsForPi(piVersionName) {
  return sprintConfig[piVersionName] || [];
}
