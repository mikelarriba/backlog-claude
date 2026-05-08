// ── Sprint Distribution Engine ─────────────────────────────────
let _distributionData = null;

async function openDistributionModal(piName) {
  if (!piName) return;
  const overlay = document.getElementById('distribution-overlay');
  const body    = document.getElementById('distribution-body');
  const msgs    = document.getElementById('distribution-messages');
  const applyBtn = document.getElementById('distribution-apply-btn');

  document.getElementById('distribution-title').textContent = `Sprint Distribution: ${piName}`;
  body.innerHTML = '<div class="distribution-loading"><div class="spinner"></div> Calculating distribution…</div>';
  msgs.innerHTML = '';
  applyBtn.disabled = true;
  overlay.classList.add('show');

  try {
    const data = await postJSON('/api/docs/distribute', { piName });

    _distributionData = data;
    renderDistributionPreview(data);
    applyBtn.disabled = false;
  } catch (e) {
    body.innerHTML = `<div class="distribution-error">${escHtml(e.message)}</div>`;
    _distributionData = null;
  }
}

function renderDistributionPreview(data) {
  const body = document.getElementById('distribution-body');
  const msgs = document.getElementById('distribution-messages');

  const totalItems = data.sprints.reduce((s, sp) => s + sp.assigned.length, 0) + data.overflow.length;
  if (totalItems === 0) {
    body.innerHTML = '<div class="distribution-empty">No stories found in this PI to distribute.</div>';
    document.getElementById('distribution-apply-btn').disabled = true;
    return;
  }

  // Sprint sections
  let html = data.sprints.map((sprint, si) => {
    const pct = sprint.capacity > 0 ? Math.round((sprint.usedPoints / sprint.capacity) * 100) : 0;
    const barClass = pct > 100 ? 'over' : pct > 90 ? 'warn' : '';
    const barWidth = Math.min(pct, 100);

    const itemsHtml = sprint.assigned.length
      ? sprint.assigned.map((item, ii) => {
          const alreadyClass = item.wasAlreadyAssigned ? ' already-assigned' : '';
          const priorityClass = (item.priority || 'Medium').toLowerCase();
          return `
            <label class="distribution-item${alreadyClass}">
              <input type="checkbox" ${item.wasAlreadyAssigned ? '' : 'checked'} data-sprint="${si}" data-item="${ii}" />
              <div class="distribution-item-body">
                <span class="distribution-item-title">${escHtml(item.title)}</span>
                <div class="distribution-item-meta">
                  <span class="dist-badge type-${item.docType}">${TYPE_LABEL[item.docType] || item.docType}</span>
                  <span class="dist-badge priority-${priorityClass}">${escHtml(item.priority)}</span>
                  ${item.storyPoints ? `<span class="dist-badge sp">${item.storyPoints} SP</span>` : '<span class="dist-badge no-sp">No SP</span>'}
                  ${item.wasAlreadyAssigned ? '<span class="dist-badge existing">Existing</span>' : ''}
                </div>
              </div>
            </label>`;
        }).join('')
      : '<div class="distribution-sprint-empty">No items assigned</div>';

    return `
      <div class="distribution-sprint-section">
        <div class="distribution-sprint-header">
          <span class="distribution-sprint-name">${escHtml(sprint.name)}</span>
          <span class="distribution-sprint-stats">${sprint.usedPoints} / ${sprint.capacity} SP (${pct}%)</span>
        </div>
        <div class="distribution-capacity-bar ${barClass}">
          <div class="distribution-capacity-fill" style="width:${barWidth}%"></div>
        </div>
        <div class="distribution-sprint-items">${itemsHtml}</div>
      </div>`;
  }).join('');

  // Overflow section
  if (data.overflow.length) {
    const overflowItems = data.overflow.map(item => {
      const priorityClass = (item.priority || 'Medium').toLowerCase();
      return `
        <div class="distribution-item overflow-item">
          <div class="distribution-item-body">
            <span class="distribution-item-title">${escHtml(item.title)}</span>
            <div class="distribution-item-meta">
              <span class="dist-badge type-${item.docType}">${TYPE_LABEL[item.docType] || item.docType}</span>
              <span class="dist-badge priority-${priorityClass}">${escHtml(item.priority)}</span>
              ${item.storyPoints ? `<span class="dist-badge sp">${item.storyPoints} SP</span>` : '<span class="dist-badge no-sp">No SP</span>'}
            </div>
          </div>
        </div>`;
    }).join('');
    html += `
      <div class="distribution-overflow-section">
        <div class="distribution-sprint-header overflow-header">
          <span class="distribution-sprint-name">Overflow</span>
          <span class="distribution-sprint-stats">${data.overflow.length} item(s) — no capacity</span>
        </div>
        <div class="distribution-sprint-items">${overflowItems}</div>
      </div>`;
  }

  body.innerHTML = html;

  // Warnings & suggestions
  let msgsHtml = '';
  if (data.warnings.length) {
    msgsHtml += data.warnings.map(w => `<div class="distribution-msg warning">${escHtml(w)}</div>`).join('');
  }
  if (data.suggestions.length) {
    msgsHtml += data.suggestions.map(s => `<div class="distribution-msg suggestion">${escHtml(s)}</div>`).join('');
  }
  msgs.innerHTML = msgsHtml;
}

async function applyDistribution() {
  if (!_distributionData) return;

  // Collect checked (newly assigned) items from the modal
  const assignments = [];
  const checkboxes = document.querySelectorAll('#distribution-body input[type=checkbox]:checked');
  for (const cb of checkboxes) {
    const si = parseInt(cb.dataset.sprint);
    const ii = parseInt(cb.dataset.item);
    const sprint = _distributionData.sprints[si];
    if (!sprint) continue;
    const item = sprint.assigned[ii];
    if (!item || item.wasAlreadyAssigned) continue; // skip items already in their sprint
    assignments.push({ filename: item.filename, docType: item.docType, sprint: sprint.name });
  }

  if (!assignments.length) {
    closeDistributionModal();
    showJiraToast('success', 'No new assignments to apply.');
    return;
  }

  const btn = document.getElementById('distribution-apply-btn');
  btn.disabled = true;
  btn.textContent = 'Applying…';

  try {
    const data = await postJSON('/api/docs/apply-distribution', { assignments });

    closeDistributionModal();

    if (data.depWarnings && data.depWarnings.length) {
      const msgs = data.depWarnings.map(w => w.message).join('\n');
      showJiraToast('warning', `Distributed ${data.updated} item(s). Dependency order warnings:\n${msgs}`);
    } else {
      showJiraToast('success', `Distributed ${data.updated} item(s) across sprints.`);
    }
  } catch (e) {
    showJiraToast('error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Apply Distribution';
  }
}

function closeDistributionModal() {
  document.getElementById('distribution-overlay').classList.remove('show');
  _distributionData = null;
}
