// ── App config & metadata loaders ─────────────────────────────
// Extracted from main.ts (#699).
import { fetchJSON, setJiraBase, setMetaLists } from './state.js';
export async function loadAppConfig() {
  try {
    const cfg = await fetchJSON('/api/config');
    if (cfg.jiraBase) setJiraBase(cfg.jiraBase);
  } catch (e) {
    console.warn('Failed to load app config:', e.message);
  }
}
export async function loadMetadata() {
  try {
    const data = await fetchJSON('/api/config/metadata');
    const { teams, workCategories } = data;
    setMetaLists(teams, workCategories);
    _populateTeamSelects(teams);
    _populateWorkCatSelects(workCategories);
    _renderTeamFilterPills(teams);
    _renderWorkCatFilterPills(workCategories);
  } catch (e) {
    console.warn('Failed to load metadata config:', e.message);
  }
}
function _populateTeamSelects(teams) {
  const selectIds = ['team', 'bug-team', 'detail-team-select'];
  for (const id of selectIds) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const firstOpt = sel.querySelector('option:first-child');
    sel.innerHTML = '';
    if (firstOpt) sel.appendChild(firstOpt.cloneNode(true));
    for (const t of teams) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    }
  }
}
function _populateWorkCatSelects(cats) {
  const selectIds = ['work-category', 'bug-work-category', 'detail-workcat-select'];
  for (const id of selectIds) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const firstOpt = sel.querySelector('option:first-child');
    sel.innerHTML = '';
    if (firstOpt) sel.appendChild(firstOpt.cloneNode(true));
    for (const c of cats) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
  }
}
const WORKCAT_SHORT_LABELS = {
  'Platform Maintenance': 'Maint.',
  'Technical Debt': 'Tech Debt',
};
function _renderTeamFilterPills(teams) {
  const container = document.querySelector('.filter-group [data-team="all"]')?.parentElement;
  if (!container) return;
  container.querySelectorAll('[data-team]:not([data-team="all"])').forEach((el) => el.remove());
  for (const t of teams) {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.dataset.team = t;
    btn.dataset.action = 'setTeamFilter';
    btn.dataset.filterValue = t;
    btn.textContent = t;
    container.appendChild(btn);
  }
}
function _renderWorkCatFilterPills(cats) {
  const container = document.querySelector(
    '.filter-group-workcat [data-workcat="all"]'
  )?.parentElement;
  if (!container) return;
  container
    .querySelectorAll('[data-workcat]:not([data-workcat="all"])')
    .forEach((el) => el.remove());
  for (const c of cats) {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.dataset.workcat = c;
    btn.dataset.action = 'setWorkCatFilter';
    btn.dataset.filterValue = c;
    btn.textContent = WORKCAT_SHORT_LABELS[c] || c;
    container.appendChild(btn);
  }
}
//# sourceMappingURL=app-metadata.js.map
