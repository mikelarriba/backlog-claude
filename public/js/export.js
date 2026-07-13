// ── Export — delegates rendering to server-side endpoints ────────────────────
// Server generates print-ready HTML; client opens it in a new tab.
// The user then uses Cmd+P / Ctrl+P → "Save as PDF" in the browser.
import { showJiraToast, escHtml } from './state.js';
import { getAllSprints } from './roadmap.js';
export async function exportEpicToPdf(filename, docType) {
    docType = docType || 'epic';
    const url = `/api/export/doc/${docType}/${encodeURIComponent(filename)}`;
    const win = window.open(url, '_blank');
    if (!win) {
        showJiraToast('error', 'Pop-up blocked — please allow pop-ups for this site');
    }
}
export function openRoadmapExportDialog() {
    // Populate sprint checkboxes
    const sprints = getAllSprints();
    const sprintList = document.getElementById('rexp-sprint-list');
    sprintList.innerHTML = sprints
        .map((s) => `<label><input type="checkbox" value="${escHtml(s.name)}" checked />${escHtml(s.name)}</label>`)
        .join('');
    // Populate team checkboxes from docs in visible PIs
    const leafTypes = new Set(['story', 'spike', 'bug']);
    const teams = new Set();
    for (const d of allDocs) {
        if (leafTypes.has(d.docType) &&
            d.fixVersion &&
            _roadmapVisiblePis?.has(d.fixVersion) &&
            d.team) {
            teams.add(d.team);
        }
    }
    const sorted = [...teams].sort();
    const teamList = document.getElementById('rexp-team-list');
    teamList.innerHTML = sorted
        .map((t) => `<label><input type="checkbox" value="${escHtml(t)}" checked />${escHtml(t)}</label>`)
        .join('');
    document.getElementById('roadmap-export-overlay').classList.add('show');
}
export function rexpToggleAllSprints(checked) {
    document
        .querySelectorAll('#rexp-sprint-list input[type="checkbox"]')
        .forEach((cb) => (cb.checked = checked));
}
export function rexpToggleAllTeams(checked) {
    document
        .querySelectorAll('#rexp-team-list input[type="checkbox"]')
        .forEach((cb) => (cb.checked = checked));
}
export function closeRoadmapExportDialog() {
    document.getElementById('roadmap-export-overlay').classList.remove('show');
}
export async function executeRoadmapExport() {
    const includeRoadmap = document.getElementById('rexp-roadmap-graphic')?.checked;
    const includeTitles = document.getElementById('rexp-issue-titles')
        ?.checked;
    const includeDescs = document.getElementById('rexp-issue-descriptions')?.checked;
    const includeCharts = document.getElementById('rexp-distribution-charts')?.checked;
    const hideEmptyEpics = document.getElementById('rexp-hide-empty-epics')?.checked;
    const includes = [
        includeRoadmap && 'roadmap',
        includeTitles && 'titles',
        includeDescs && 'descriptions',
        includeCharts && 'charts',
    ].filter(Boolean);
    if (!includes.length) {
        showJiraToast('error', 'Select at least one section to export');
        return;
    }
    // Read selected sprints from filter checkboxes
    const selectedSprintCbs = document.querySelectorAll('#rexp-sprint-list input[type="checkbox"]:checked');
    const selectedSprints = [...selectedSprintCbs].map((cb) => cb.value);
    // Read selected teams from filter checkboxes
    const selectedTeamCbs = document.querySelectorAll('#rexp-team-list input[type="checkbox"]:checked');
    const selectedTeams = [...selectedTeamCbs].map((cb) => cb.value);
    closeRoadmapExportDialog();
    // Pass currently visible PIs as comma-separated query param
    const visiblePis = _roadmapVisiblePis ? [..._roadmapVisiblePis].join(',') : '';
    const params = new URLSearchParams({ includes: includes.join(',') });
    if (visiblePis)
        params.set('pi', visiblePis);
    if (hideEmptyEpics)
        params.set('hideEmpty', '1');
    if (selectedSprints.length)
        params.set('sprints', selectedSprints.join(','));
    if (selectedTeams.length)
        params.set('teams', selectedTeams.join(','));
    const url = `/api/export/roadmap?${params.toString()}`;
    const win = window.open(url, '_blank');
    if (!win) {
        showJiraToast('error', 'Pop-up blocked — please allow pop-ups for this site');
    }
}
//# sourceMappingURL=export.js.map