// ── Export — delegates rendering to server-side endpoints ────────────────────
// Server generates print-ready HTML; client opens it in a new tab.
// The user then uses Cmd+P / Ctrl+P → "Save as PDF" in the browser.
import { showJiraToast, escHtml, openModal, closeModal } from './state.js';
import { getAllSprints } from './roadmap.js';

interface ExportSprint {
  name: string;
}

export interface RoadmapExportSelections {
  includeRoadmap: boolean;
  includeTitles: boolean;
  includeDescs: boolean;
  includeCharts: boolean;
  hideEmptyEpics: boolean;
  visiblePis: string[];
  sprints: string[];
  teams: string[];
}

// Pure: builds the `/api/export/roadmap` query string from the export dialog's
// selections, or null when nothing was selected to export (the caller shows
// the "select at least one section" error in that case).
export function buildRoadmapExportQuery(sel: RoadmapExportSelections): string | null {
  const includes = [
    sel.includeRoadmap && 'roadmap',
    sel.includeTitles && 'titles',
    sel.includeDescs && 'descriptions',
    sel.includeCharts && 'charts',
  ].filter(Boolean) as string[];

  if (!includes.length) return null;

  const params = new URLSearchParams({ includes: includes.join(',') });
  if (sel.visiblePis.length) params.set('pi', sel.visiblePis.join(','));
  if (sel.hideEmptyEpics) params.set('hideEmpty', '1');
  if (sel.sprints.length) params.set('sprints', sel.sprints.join(','));
  if (sel.teams.length) params.set('teams', sel.teams.join(','));

  return params.toString();
}

export async function exportEpicToPdf(filename: string, docType?: string): Promise<void> {
  docType = docType || 'epic';
  const url = `/api/export/doc/${docType}/${encodeURIComponent(filename)}`;
  const win = window.open(url, '_blank');
  if (!win) {
    showJiraToast('error', 'Pop-up blocked — please allow pop-ups for this site');
  }
}

export function openRoadmapExportDialog(): void {
  // Populate sprint checkboxes
  const sprints = getAllSprints() as ExportSprint[];
  const sprintList = document.getElementById('rexp-sprint-list') as HTMLElement;
  sprintList.innerHTML = sprints
    .map(
      (s) =>
        `<label><input type="checkbox" value="${escHtml(s.name)}" checked />${escHtml(s.name)}</label>`
    )
    .join('');

  // Populate team checkboxes from docs in visible PIs
  const leafTypes = new Set(['story', 'spike', 'bug']);
  const teams = new Set<string>();
  for (const d of allDocs) {
    if (
      leafTypes.has(d.docType) &&
      d.fixVersion &&
      _roadmapVisiblePis?.has(d.fixVersion) &&
      d.team
    ) {
      teams.add(d.team);
    }
  }
  const sorted = [...teams].sort();
  const teamList = document.getElementById('rexp-team-list') as HTMLElement;
  teamList.innerHTML = sorted
    .map(
      (t) => `<label><input type="checkbox" value="${escHtml(t)}" checked />${escHtml(t)}</label>`
    )
    .join('');

  openModal('roadmap-export-overlay');
}

export function rexpToggleAllSprints(checked: boolean): void {
  document
    .querySelectorAll<HTMLInputElement>('#rexp-sprint-list input[type="checkbox"]')
    .forEach((cb) => (cb.checked = checked));
}

export function rexpToggleAllTeams(checked: boolean): void {
  document
    .querySelectorAll<HTMLInputElement>('#rexp-team-list input[type="checkbox"]')
    .forEach((cb) => (cb.checked = checked));
}

export function closeRoadmapExportDialog(): void {
  closeModal('roadmap-export-overlay');
}

export async function executeRoadmapExport(): Promise<void> {
  const includeRoadmap = (
    document.getElementById('rexp-roadmap-graphic') as HTMLInputElement | null
  )?.checked;
  const includeTitles = (document.getElementById('rexp-issue-titles') as HTMLInputElement | null)
    ?.checked;
  const includeDescs = (
    document.getElementById('rexp-issue-descriptions') as HTMLInputElement | null
  )?.checked;
  const includeCharts = (
    document.getElementById('rexp-distribution-charts') as HTMLInputElement | null
  )?.checked;
  const hideEmptyEpics = (
    document.getElementById('rexp-hide-empty-epics') as HTMLInputElement | null
  )?.checked;

  // Read selected sprints from filter checkboxes
  const selectedSprintCbs = document.querySelectorAll<HTMLInputElement>(
    '#rexp-sprint-list input[type="checkbox"]:checked'
  );
  const selectedSprints = [...selectedSprintCbs].map((cb) => cb.value);

  // Read selected teams from filter checkboxes
  const selectedTeamCbs = document.querySelectorAll<HTMLInputElement>(
    '#rexp-team-list input[type="checkbox"]:checked'
  );
  const selectedTeams = [...selectedTeamCbs].map((cb) => cb.value);

  const query = buildRoadmapExportQuery({
    includeRoadmap: !!includeRoadmap,
    includeTitles: !!includeTitles,
    includeDescs: !!includeDescs,
    includeCharts: !!includeCharts,
    hideEmptyEpics: !!hideEmptyEpics,
    visiblePis: _roadmapVisiblePis ? [..._roadmapVisiblePis] : [],
    sprints: selectedSprints,
    teams: selectedTeams,
  });

  if (query === null) {
    showJiraToast('error', 'Select at least one section to export');
    return;
  }

  closeRoadmapExportDialog();

  const url = `/api/export/roadmap?${query}`;
  const win = window.open(url, '_blank');
  if (!win) {
    showJiraToast('error', 'Pop-up blocked — please allow pop-ups for this site');
  }
}
