// ── Sprint Distribution Engine ─────────────────────────────────
import { postJSON, escHtml, showJiraToast, TYPE_LABEL, openModal, closeModal } from './state.js';

interface DistributionItem {
  filename: string;
  docType: string;
  title: string;
  priority: string;
  storyPoints: number | null;
  wasAlreadyAssigned: boolean;
}

interface DistributionSprint {
  name: string;
  capacity: number;
  effectiveCapacity?: number;
  usedPoints: number;
  assigned: DistributionItem[];
}

interface DistributionData {
  sprints: DistributionSprint[];
  overflow: DistributionItem[];
  warnings: string[];
  suggestions: string[];
}

interface ApplyDistributionResult {
  updated: number;
  depWarnings?: Array<{ message: string }>;
}

let _distributionData: DistributionData | null = null;

export async function openDistributionModal(piName: string): Promise<void> {
  if (!piName) return;
  const body = document.getElementById('distribution-body') as HTMLElement;
  const msgs = document.getElementById('distribution-messages') as HTMLElement;
  const applyBtn = document.getElementById('distribution-apply-btn') as HTMLButtonElement;

  (document.getElementById('distribution-title') as HTMLElement).textContent =
    `Sprint Distribution: ${piName}`;
  body.innerHTML =
    '<div class="distribution-loading"><div class="spinner"></div> Calculating distribution…</div>';
  msgs.innerHTML = '';
  applyBtn.disabled = true;
  openModal('distribution-overlay');

  try {
    const data = (await postJSON('/api/docs/distribute', { piName })) as DistributionData;
    _distributionData = data;
    renderDistributionPreview(data);
    applyBtn.disabled = false;
  } catch (e) {
    body.innerHTML = `<div class="distribution-error">${escHtml(e instanceof Error ? e.message : String(e))}</div>`;
    _distributionData = null;
  }
}

export function renderDistributionPreview(data: DistributionData): void {
  const body = document.getElementById('distribution-body') as HTMLElement;
  const msgs = document.getElementById('distribution-messages') as HTMLElement;

  const totalItems =
    data.sprints.reduce((s, sp) => s + sp.assigned.length, 0) + data.overflow.length;
  if (totalItems === 0) {
    body.innerHTML =
      '<div class="distribution-empty">No stories found in this PI to distribute.</div>';
    (document.getElementById('distribution-apply-btn') as HTMLButtonElement).disabled = true;
    return;
  }

  let html = data.sprints
    .map((sprint, si) => {
      const effectiveCap = sprint.effectiveCapacity ?? sprint.capacity;
      const bufferPct =
        sprint.capacity > 0 && effectiveCap < sprint.capacity
          ? Math.round((1 - effectiveCap / sprint.capacity) * 100)
          : 0;
      const pct = effectiveCap > 0 ? Math.round((sprint.usedPoints / effectiveCap) * 100) : 0;
      const barClass = pct > 100 ? 'over' : pct > 90 ? 'warn' : '';
      const barWidth = Math.min(pct, 100);
      const statsText = bufferPct
        ? `${sprint.usedPoints} / ${effectiveCap} SP (${pct}%, ${bufferPct}% buffer)`
        : `${sprint.usedPoints} / ${sprint.capacity} SP (${pct}%)`;

      const itemsHtml = sprint.assigned.length
        ? sprint.assigned
            .map((item, ii) => {
              const alreadyClass = item.wasAlreadyAssigned ? ' already-assigned' : '';
              const priorityClass = (item.priority || 'Medium').toLowerCase();
              if (item.wasAlreadyAssigned) {
                return `
            <div class="distribution-item${alreadyClass}">
              <span class="already-assigned-icon" title="Already in this sprint">🔒</span>
              <div class="distribution-item-body">
                <span class="distribution-item-title">${escHtml(item.title)}</span>
                <div class="distribution-item-meta">
                  <span class="dist-badge type-${item.docType}">${TYPE_LABEL[item.docType] || item.docType}</span>
                  <span class="dist-badge priority-${priorityClass}">${escHtml(item.priority)}</span>
                  ${item.storyPoints ? `<span class="dist-badge sp">${item.storyPoints} SP</span>` : '<span class="dist-badge no-sp">No SP</span>'}
                  <span class="dist-badge existing">Existing</span>
                </div>
              </div>
            </div>`;
              }
              return `
            <label class="distribution-item">
              <input type="checkbox" checked data-sprint="${si}" data-item="${ii}" />
              <div class="distribution-item-body">
                <span class="distribution-item-title">${escHtml(item.title)}</span>
                <div class="distribution-item-meta">
                  <span class="dist-badge type-${item.docType}">${TYPE_LABEL[item.docType] || item.docType}</span>
                  <span class="dist-badge priority-${priorityClass}">${escHtml(item.priority)}</span>
                  ${item.storyPoints ? `<span class="dist-badge sp">${item.storyPoints} SP</span>` : '<span class="dist-badge no-sp">No SP</span>'}
                </div>
              </div>
            </label>`;
            })
            .join('')
        : '<div class="distribution-sprint-empty">No items assigned</div>';

      return `
      <div class="distribution-sprint-section">
        <div class="distribution-sprint-header">
          <span class="distribution-sprint-name">${escHtml(sprint.name)}</span>
          <span class="distribution-sprint-stats">${statsText}</span>
        </div>
        <div class="distribution-capacity-bar ${barClass}">
          <div class="distribution-capacity-fill" style="width:${barWidth}%"></div>
        </div>
        <div class="distribution-sprint-items">${itemsHtml}</div>
      </div>`;
    })
    .join('');

  if (data.overflow.length) {
    const overflowItems = data.overflow
      .map((item) => {
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
      })
      .join('');
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

  let msgsHtml = '';
  if (data.warnings.length) {
    msgsHtml += data.warnings
      .map((w) => `<div class="distribution-msg warning">${escHtml(w)}</div>`)
      .join('');
  }
  if (data.suggestions.length) {
    msgsHtml += data.suggestions
      .map((s) => `<div class="distribution-msg suggestion">${escHtml(s)}</div>`)
      .join('');
  }
  msgs.innerHTML = msgsHtml;
}

export async function applyDistribution(): Promise<void> {
  if (!_distributionData) return;

  const assignments: Array<{ filename: string; docType: string; sprint: string }> = [];
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    '#distribution-body input[type=checkbox]:checked'
  );
  for (const cb of checkboxes) {
    const si = parseInt(cb.dataset['sprint'] ?? '');
    const ii = parseInt(cb.dataset['item'] ?? '');
    const sprint = _distributionData.sprints[si];
    if (!sprint) continue;
    const item = sprint.assigned[ii];
    if (!item || item.wasAlreadyAssigned) continue;
    assignments.push({ filename: item.filename, docType: item.docType, sprint: sprint.name });
  }

  if (!assignments.length) {
    closeDistributionModal();
    showJiraToast('success', 'No new assignments to apply.');
    return;
  }

  const btn = document.getElementById('distribution-apply-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Applying…';

  try {
    const data = (await postJSON('/api/docs/apply-distribution', {
      assignments,
    })) as ApplyDistributionResult;

    closeDistributionModal();

    if (data.depWarnings && data.depWarnings.length) {
      const msgs = data.depWarnings.map((w) => w.message).join('\n');
      showJiraToast(
        'warning',
        `Distributed ${data.updated} item(s). Dependency order warnings:\n${msgs}`
      );
    } else {
      showJiraToast('success', `Distributed ${data.updated} item(s) across sprints.`);
    }
  } catch (e) {
    showJiraToast('error', e instanceof Error ? e.message : String(e));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Apply Distribution';
  }
}

export function closeDistributionModal(): void {
  closeModal('distribution-overlay');
  _distributionData = null;
}
