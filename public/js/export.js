// ── Export — delegates rendering to server-side endpoints ────────────────────
// Server generates print-ready HTML; client opens it in a new tab.
// The user then uses Cmd+P / Ctrl+P → "Save as PDF" in the browser.
import { showJiraToast } from './state.js';

export async function exportEpicToPdf(filename, docType) {
  docType = docType || 'epic';
  const url = `/api/export/doc/${docType}/${encodeURIComponent(filename)}`;
  const win = window.open(url, '_blank');
  if (!win) {
    showJiraToast('error', 'Pop-up blocked — please allow pop-ups for this site');
  }
}

export function openRoadmapExportDialog() {
  document.getElementById('roadmap-export-overlay').classList.add('show');
}

export function closeRoadmapExportDialog() {
  document.getElementById('roadmap-export-overlay').classList.remove('show');
}

export async function executeRoadmapExport() {
  const includeRoadmap = document.getElementById('rexp-roadmap-graphic')?.checked;
  const includeTitles = document.getElementById('rexp-issue-titles')?.checked;
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

  closeRoadmapExportDialog();

  // Pass currently visible PIs as comma-separated query param
  const visiblePis = window._roadmapVisiblePis ? [...window._roadmapVisiblePis].join(',') : '';
  const params = new URLSearchParams({ includes: includes.join(',') });
  if (visiblePis) params.set('pi', visiblePis);
  if (hideEmptyEpics) params.set('hideEmpty', '1');

  const url = `/api/export/roadmap?${params.toString()}`;
  const win = window.open(url, '_blank');
  if (!win) {
    showJiraToast('error', 'Pop-up blocked — please allow pop-ups for this site');
  }
}
