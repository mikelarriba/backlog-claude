// ── App config & metadata loaders ─────────────────────────────
// Extracted from main.ts (#699).
import { fetchJSON, setJiraBase, setMetaLists } from './state.js';

export async function loadAppConfig(): Promise<void> {
  try {
    const cfg = (await fetchJSON('/api/config')) as { jiraBase?: string };
    if (cfg.jiraBase) setJiraBase(cfg.jiraBase);
  } catch (e) {
    console.warn('Failed to load app config:', (e as Error).message);
  }
}

export async function loadMetadata(): Promise<void> {
  try {
    const data = (await fetchJSON('/api/config/metadata')) as {
      teams: string[];
      workCategories: string[];
    };
    const { teams, workCategories } = data;
    setMetaLists(teams, workCategories);
    _populateTeamSelects(teams);
    _populateWorkCatSelects(workCategories);
    _renderTeamFilterPills(teams);
    _renderWorkCatFilterPills(workCategories);
  } catch (e) {
    console.warn('Failed to load metadata config:', (e as Error).message);
  }
}

function _populateTeamSelects(teams: string[]): void {
  const selectIds = ['team', 'bug-team', 'detail-team-select'];
  for (const id of selectIds) {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (!sel) continue;
    const firstOpt = sel.querySelector<HTMLOptionElement>('option:first-child');
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

function _populateWorkCatSelects(cats: string[]): void {
  const selectIds = ['work-category', 'bug-work-category', 'detail-workcat-select'];
  for (const id of selectIds) {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (!sel) continue;
    const firstOpt = sel.querySelector<HTMLOptionElement>('option:first-child');
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

const WORKCAT_SHORT_LABELS: Record<string, string> = {
  'Platform Maintenance': 'Maint.',
  'Technical Debt': 'Tech Debt',
};

function _renderTeamFilterPills(teams: string[]): void {
  const container = document.querySelector<HTMLElement>(
    '.filter-group [data-team="all"]'
  )?.parentElement;
  if (!container) return;
  container
    .querySelectorAll<HTMLElement>('[data-team]:not([data-team="all"])')
    .forEach((el) => el.remove());
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

function _renderWorkCatFilterPills(cats: string[]): void {
  const container = document.querySelector<HTMLElement>(
    '.filter-group-workcat [data-workcat="all"]'
  )?.parentElement;
  if (!container) return;
  container
    .querySelectorAll<HTMLElement>('[data-workcat]:not([data-workcat="all"])')
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
