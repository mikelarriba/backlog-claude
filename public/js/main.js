// ── ES Module entry point ────────────────────────────────────────
import { fetchJSON, debounce } from './state.js';
import { on } from './store.js';
import {
  loadDocs,
  loadPiSettings,
  loadJiraVersions,
  closeIssueSplitModal,
  executeSplitIssue,
} from './list.js';
import {
  dispatchAction,
  dispatchChangeAction,
  dispatchInputAction,
  dispatchContextAction,
  dispatchKeydownAction,
} from './actions.js';
import {
  toggleItemCollapse,
  collapseAll,
  expandAll,
  toggleSwimlane,
  updatePiVersion,
  setTypeFilter,
  setStatusFilter,
  setTeamFilter,
  setWorkCatFilter,
  applyFilters,
  patchSingleDoc,
  handleItemClick,
  showContextMenu,
  closeContextMenu,
  closeBulkAssignDialog,
} from './list-filters.js';
import { dismissWelcomeBanner } from './list-render.js';
import {
  saveTitle,
  cancelTitleEdit,
  showList,
  confirmDelete,
  closeDeleteDialog,
  executeDelete,
  toggleDropdown,
  closeDropdown,
  toggleOriginal,
  openDoc,
} from './detail.js';
import { saveStoryPoints } from './detail-fields.js';
import { toggleHierarchy, loadHierarchy } from './detail-links.js';
import { toggleUpgradePanel, executeUpgrade } from './upgrade.js';
import {
  saveDraft,
  generateDoc,
  clearForm,
  toggleQuickCreate,
  closeQuickCreate,
  executeQuickCreate,
} from './quickcreate.js';
import { generateStories } from './stories.js';
import {
  jiraSelectAll,
  jiraSelectCancel,
  jiraSelectConfirm,
  searchJira,
  downloadSelected,
  pullByKey,
} from './jira-import.js';
import {
  syncPreviewSelectAll,
  syncPreviewCancel,
  syncPreviewConfirm,
  pushToJira,
} from './jira-push.js';
import { pullFromJira, checkAllJira } from './jira-pull.js';
import { openBugForm, closeBugForm, onBugFilesSelected, submitBugReport } from './bugcreate.js';
import { resetCanvasLayout } from './refine-canvas.js';
import { _showEdgePopup, _deleteCanvasLink, _changeCanvasLinkType } from './refine-edges.js';
import {
  _showCardContextMenu,
  _showFpCardContextMenu,
  _fpMoveToEpic,
  _showEpicContextMenu,
  _showEmptyCellMenu,
  _openCellCreateForm,
  _executeEmptyCellCreate,
  _showMultiCardContextMenu,
  _moveCardsToEdge,
  _openCanvasSplit,
  _moveCardToEdge,
} from './refine-nodes.js';
import {
  openManualRefine,
  closeRefineView,
  resetRefineViewState,
  saveRpTitle,
  saveRpStoryPoints,
} from './refine.js';
import {
  exportEpicToPdf,
  openRoadmapExportDialog,
  closeRoadmapExportDialog,
  executeRoadmapExport,
  rexpToggleAllSprints,
  rexpToggleAllTeams,
} from './export.js';
import {
  togglePiConfigSection,
  addSprintRow,
  saveSprintConfig,
  loadAllSprintConfigs,
  renderPiConfigTabs,
  _updatePiFromConfig,
} from './piconfig.js';
import {
  openDistributionModal,
  closeDistributionModal,
  applyDistribution,
} from './distribution.js';
import {
  openRoadmapView,
  closeRoadmapView,
  refreshRoadmapView,
  toggleRoadmapPi,
  toggleRoadmapPanel,
  focusEpic,
  addDepLink,
  addParallelLink,
  closeDepModal,
  closeSplitModal,
  executeSplit,
} from './roadmap.js';
import {
  pushSprintsToJira,
  closeSprintPushModal,
  toggleSprintPushFilter,
  sprintPushSelectAll,
  sprintPushToggleAllSprints,
  startSprintPushPreview,
  confirmSprintPush,
  pullFromJiraSprints,
  closePullSprintModal,
  pullSprintToggleAll,
  startPullSprintPreview,
  confirmPullSprint,
} from './roadmap-jira-sync.js';
import { loadSkillsView } from './skills.js';
import { initDragDrop } from './dragdrop.js';
import { toggleModelSection, loadModelSetting, refreshProviders } from './provider-settings.js';
import { _connectSSE } from './sse-client.js';
import {
  toggleAiSavingsSection,
  loadAiSavingsSection,
  loadSidebarSavings,
  filterAiSavings,
  exportAiSavingsPdf,
  exportAiSavingsPptx,
} from './ai-savings.js';
import {
  loadBugsDashboard,
  refreshBugsDashboard,
  setBugsEnvFilter,
  analyzeBugs,
  toggleBugsAnalysis,
  bugToggleKey,
  bugToggleAll,
} from './bugs-dashboard.js';
import {
  loadDocumentationView,
  docSetTypeFilter,
  searchDocumentationIssues,
  docToggleKey,
  askAI,
  toggleSuggestionCheck,
  selectAllSuggestions,
  deselectAllSuggestions,
  modifyDocumentation,
  undoChanges,
  setDocMode,
  docSearch,
  exportDocumentationPdf,
} from './documentation.js';
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
// ── Split-panel mode ───────────────────────────────────────────
const SPLIT_MIN_WIDTH = 1280;
export function isSplitMode() {
  return document.querySelector('.right')?.classList.contains('split-mode') ?? false;
}
function updateSplitMode() {
  const wide = window.innerWidth >= SPLIT_MIN_WIDTH;
  const right = document.querySelector('.right');
  if (!right) return;
  const wasOn = right.classList.contains('split-mode');
  if (wide === wasOn) return;
  right.classList.toggle('split-mode', wide);
  const _cf = currentFilename;
  const _cdt = currentDocType;
  if (!wide && _cf) {
    const listView = document.getElementById('list-view');
    if (listView) listView.style.display = 'none';
  } else if (wide && _cf) {
    const listView = document.getElementById('list-view');
    if (listView) listView.style.display = '';
    highlightSelectedItem(_cf, _cdt ?? '');
  }
}
export function highlightSelectedItem(filename, docType) {
  document
    .querySelectorAll('.epic-item, .roadmap-card')
    .forEach((el) => el.classList.remove('selected'));
  if (filename) {
    document
      .querySelector(
        `.epic-item[data-filename="${CSS.escape(filename)}"][data-doctype="${docType}"]`
      )
      ?.classList.add('selected');
    document
      .querySelector(
        `.roadmap-card[data-filename="${CSS.escape(filename)}"][data-doctype="${docType}"]`
      )
      ?.classList.add('selected');
  }
}
let _lastInnerWidth = window.innerWidth;
window.addEventListener(
  'resize',
  debounce(() => {
    if (window.innerWidth === _lastInnerWidth) return;
    _lastInnerWidth = window.innerWidth;
    updateSplitMode();
  }, 150)
);
// ── Sidebar collapse toggle (Ctrl+B) ─────────────────────────
function toggleLeftPanel() {
  const app = document.getElementById('app-root');
  if (!app) return;
  const collapsed = app.classList.toggle('left-collapsed');
  try {
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  } catch {
    /* no-op */
  }
}
function navigateTo(viewName) {
  // Update active state in sidebar
  document.querySelectorAll('.sidebar-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });
  // Hide all views
  const lv = document.getElementById('list-view');
  if (lv) lv.style.display = 'none';
  document.getElementById('detail-view')?.classList.remove('show');
  resetRefineViewState();
  document.getElementById('roadmap-view')?.classList.remove('show');
  document.getElementById('settings-view')?.classList.remove('show');
  document.getElementById('skills-view')?.classList.remove('show');
  document.getElementById('documentation-view')?.classList.remove('show');
  document.getElementById('bugs-view')?.classList.remove('show');
  document.getElementById('suggestions-view')?.classList.remove('show');
  // Hide FAB when not in backlog
  const fabContainer = document.getElementById('fab-container');
  if (fabContainer) fabContainer.style.display = viewName === 'backlog' ? '' : 'none';
  // Clean up roadmap-mode when leaving roadmap
  const right = document.querySelector('.right');
  if (viewName !== 'roadmap') {
    right?.classList.remove('roadmap-mode');
    right?.classList.remove('has-selection');
  }
  // Show the requested view
  switch (viewName) {
    case 'backlog':
      if (lv) lv.style.display = '';
      break;
    case 'roadmap':
      openRoadmapView();
      break;
    case 'settings':
      document.getElementById('settings-view')?.classList.add('show');
      openAllSettingsPanels();
      renderPiConfigTabs();
      void loadAiSavingsSection();
      break;
    case 'skills':
      document.getElementById('skills-view')?.classList.add('show');
      loadSkillsView();
      break;
    case 'documentation':
      document.getElementById('documentation-view')?.classList.add('show');
      void loadDocumentationView();
      break;
    case 'bugs':
      document.getElementById('bugs-view')?.classList.add('show');
      loadBugsDashboard();
      break;
    case 'suggestions':
      document.getElementById('suggestions-view')?.classList.add('show');
      break;
  }
}
// ── Settings view ─────────────────────────────────────────────
function closeSettingsView() {
  navigateTo('backlog');
}
// Settings collapsibles start expanded every time the view opens, so the user
// sees all configuration at a glance rather than three closed accordions.
function openAllSettingsPanels() {
  const panels = [
    ['model-section-body', 'model-chevron'],
    ['pi-config-body', 'pi-config-chevron'],
    ['ai-savings-section-body', 'ai-savings-chevron'],
  ];
  for (const [bodyId, chevronId] of panels) {
    const body = document.getElementById(bodyId);
    const chevron = document.getElementById(chevronId);
    if (body && !body.classList.contains('open')) {
      body.classList.add('open');
      if (chevron) chevron.style.transform = 'rotate(90deg)';
    }
  }
}
// ── FAB (Floating Action Button) ──────────────────────────────
function openFab() {
  document.getElementById('fab-panel')?.classList.add('open');
  document.getElementById('fab-btn')?.classList.add('open');
}
function closeFab() {
  document.getElementById('fab-panel')?.classList.remove('open');
  document.getElementById('fab-btn')?.classList.remove('open');
  closeBugForm();
}
function toggleFab() {
  const panel = document.getElementById('fab-panel');
  if (panel?.classList.contains('open')) {
    closeFab();
  } else {
    openFab();
  }
}
function switchFabTab(tabName) {
  document.querySelectorAll('.fab-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.fab-tab-content').forEach((div) => {
    div.classList.toggle('active', div.id === `fab-tab-${tabName}`);
  });
}
(function _restoreLeftPanel() {
  try {
    const collapsed =
      localStorage.getItem('sidebarCollapsed') === '1' ||
      localStorage.getItem('leftPanelCollapsed') === '1';
    if (collapsed) {
      const app = document.getElementById('app-root');
      if (app) app.classList.add('left-collapsed');
    }
  } catch {
    /* no-op */
  }
})();
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    toggleLeftPanel();
  }
  if (e.key === 'Escape') {
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
    )
      return;
    const overlays = document.querySelectorAll('.dialog-overlay.show');
    if (overlays.length) return;
    const fabPanel = document.getElementById('fab-panel');
    if (fabPanel?.classList.contains('open')) {
      closeFab();
      return;
    }
    const detail = document.getElementById('detail-view');
    if (detail && detail.classList.contains('show')) showList();
  }
});
// ── App config & metadata ─────────────────────────────────────
async function loadAppConfig() {
  try {
    const cfg = await fetchJSON('/api/config');
    if (cfg.jiraBase) jiraBase = cfg.jiraBase;
  } catch (e) {
    console.warn('Failed to load app config:', e.message);
  }
}
async function loadMetadata() {
  try {
    const data = await fetchJSON('/api/config/metadata');
    const { teams, workCategories } = data;
    _metaTeams = teams;
    _metaWorkCategories = workCategories;
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
// ── Store subscriptions ───────────────────────────────────────
// Subscribe to domain event so any mutation (upsertDoc, removeDoc, setDocs,
// or direct allDocs assignment via window) triggers a re-render. A single-doc
// upsertDoc() call that doesn't change the doc's tree position (see store.ts's
// `structural` flag) patches just that row instead of rebuilding the full
// swimlane tree; every other change (removeDoc, setDocs, a structural
// upsertDoc) falls back to the full applyFilters() rebuild.
on('docs:changed', ({ docs, changedFilename, structural }) => {
  // Keep the roadmap board in sync with edits made from the detail panel
  // (e.g. an epic's Estimated Sprint Size / placement) while it's open —
  // the list-only patch/rebuild below doesn't touch the roadmap DOM.
  refreshRoadmapView();
  if (changedFilename && !structural && patchSingleDoc(changedFilename)) return;
  applyFilters(docs);
});
// Bootstrap
(async () => {
  await Promise.all([
    loadPiSettings(),
    loadJiraVersions(),
    loadModelSetting(),
    loadAppConfig(),
    loadMetadata(),
  ]);
  await loadAllSprintConfigs();
  loadDocs();
  void loadSidebarSavings();
})();
initDragDrop();
updateSplitMode();
_connectSSE();
// Backdrop-click-to-close for all `.dialog-overlay` modals is wired
// automatically by openModal() in state.ts the first time each is opened —
// no per-modal listener needed here.
// ── Delegated click handler ───────────────────────────────────
// Replaces the ~150 inline onclick attributes that previously called
// into the _globals bridge. Each element now carries data-action="fn"
// (and optional data-* argument attributes). The FAB outside-click
// handler is merged in here too.
document.addEventListener('click', (e) => {
  // FAB outside-click: close if clicking outside the fab container
  const fabContainer = document.getElementById('fab-container');
  if (fabContainer && !fabContainer.contains(e.target)) {
    closeFab();
  }
  const target = e.target;
  const btn = target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action ?? '';
  // Typed self-registered actions (see actions.ts) take priority over the
  // legacy switch below — this is how a migrated view (currently: the list
  // multi-select context menu in list-filters.ts) reaches its handlers
  // without a case here. Falls through to the switch for everything else.
  if (dispatchAction(action, btn, e)) return;
  switch (action) {
    // ── Sidebar navigation ──────────────────────────────────
    case 'navigateTo':
      navigateTo(btn.dataset.viewName);
      break;
    // ── Theme ───────────────────────────────────────────────
    case 'setTheme':
      if (typeof window.setTheme === 'function') window.setTheme(btn.dataset.themeName ?? '');
      break;
    // ── List toolbar ────────────────────────────────────────
    case 'collapseAll':
      collapseAll();
      break;
    case 'expandAll':
      expandAll();
      break;
    case 'checkAllJira':
      checkAllJira();
      break;
    // ── Type / Status / Team / WorkCat filter pills ─────────
    case 'setTypeFilter':
      setTypeFilter(btn.dataset.filterValue ?? '');
      break;
    case 'setStatusFilter':
      setStatusFilter(btn.dataset.filterValue ?? '');
      break;
    case 'setTeamFilter':
      setTeamFilter(btn.dataset.filterValue ?? '');
      break;
    case 'setWorkCatFilter':
      setWorkCatFilter(btn.dataset.filterValue ?? '');
      break;
    // ── Detail view ─────────────────────────────────────────
    case 'showList':
      showList();
      break;
    case 'toggleUpgradePanel':
      toggleUpgradePanel();
      break;
    case 'executeUpgrade':
      executeUpgrade();
      break;
    case 'toggleDropdown':
      toggleDropdown(btn.dataset.dropdownId ?? '');
      break;
    case 'toggleQuickCreateAndClose': {
      toggleQuickCreate(btn.dataset.doctype ?? '');
      closeDropdown(btn.dataset.closeDropdown ?? '');
      break;
    }
    case 'generateStoriesAndClose':
      generateStories();
      closeDropdown(btn.dataset.closeDropdown ?? '');
      break;
    case 'openManualRefineAndClose': {
      const cf = currentFilename;
      const cdt = currentDocType;
      openManualRefine(cf ?? '', cdt ?? '');
      closeDropdown(btn.dataset.closeDropdown ?? '');
      break;
    }
    case 'pushToJiraAndClose':
      pushToJira();
      closeDropdown(btn.dataset.closeDropdown ?? '');
      break;
    case 'pullFromJira':
      pullFromJira();
      break;
    case 'exportEpicToPdfCurrent': {
      const cf = currentFilename;
      const cdt = currentDocType;
      exportEpicToPdf(cf ?? '', cdt ?? '');
      break;
    }
    case 'confirmDelete':
      confirmDelete();
      break;
    case 'closeDeleteDialog':
      closeDeleteDialog();
      break;
    case 'executeDelete':
      executeDelete();
      break;
    case 'executeQuickCreate':
      executeQuickCreate();
      break;
    case 'closeQuickCreate':
      closeQuickCreate();
      break;
    case 'toggleOriginal':
      toggleOriginal();
      break;
    case 'toggleHierarchy':
      toggleHierarchy();
      break;
    // ── Refine view ─────────────────────────────────────────
    case 'closeRefineView':
      closeRefineView();
      break;
    case 'resetCanvasLayoutCanvas':
      resetCanvasLayout(_canvasEpicFilename ?? '');
      break;
    case 'exportEpicToPdfCanvas':
      exportEpicToPdf(_canvasEpicFilename ?? '', _canvasDocType ?? '');
      break;
    // ── Settings view ────────────────────────────────────────
    case 'closeSettingsView':
      closeSettingsView();
      break;
    case 'toggleModelSection':
      toggleModelSection();
      break;
    case 'refreshProviders':
      refreshProviders();
      break;
    case 'togglePiConfigSection':
      togglePiConfigSection();
      break;
    case 'addSprintRow':
      addSprintRow();
      break;
    case 'saveSprintConfig':
      saveSprintConfig();
      break;
    case 'openDistributionModalPiConfig':
      openDistributionModal(_piConfigActivePi ?? '');
      break;
    case 'toggleAiSavingsSection':
      toggleAiSavingsSection();
      break;
    case 'filterAiSavings':
      filterAiSavings(btn.dataset.filterValue ?? 'all');
      break;
    case 'exportAiSavingsPdf':
      exportAiSavingsPdf();
      break;
    case 'exportAiSavingsPptx':
      exportAiSavingsPptx();
      break;
    // ── Roadmap view ─────────────────────────────────────────
    case 'closeRoadmapView':
      closeRoadmapView();
      break;
    case 'openDistributionModalRoadmap':
      openDistributionModal([..._roadmapVisiblePis][0] ?? '');
      break;
    case 'pushSprintsToJira':
      pushSprintsToJira();
      break;
    case 'pullFromJiraSprints':
      pullFromJiraSprints();
      break;
    case 'openRoadmapExportDialog':
      openRoadmapExportDialog();
      break;
    case 'toggleRoadmapPanel':
      toggleRoadmapPanel(btn.dataset.panel ?? '');
      break;
    // ── Welcome banner ───────────────────────────────────────
    case 'dismissWelcomeBanner':
      dismissWelcomeBanner();
      break;
    // ── FAB ──────────────────────────────────────────────────
    case 'toggleFab':
      toggleFab();
      break;
    case 'closeFab':
      closeFab();
      break;
    case 'switchFabTab':
      switchFabTab(btn.dataset.tabName ?? '');
      break;
    case 'clearForm':
      clearForm();
      break;
    case 'saveDraft':
      saveDraft();
      break;
    case 'generateDoc':
      generateDoc();
      break;
    case 'openBugForm':
      openBugForm();
      break;
    case 'searchJira':
      searchJira();
      break;
    case 'downloadSelected':
      downloadSelected();
      break;
    case 'pullByKey':
      pullByKey();
      break;
    // ── Bug form ─────────────────────────────────────────────
    case 'closeBugForm':
      closeBugForm();
      break;
    case 'submitBugReport':
      submitBugReport();
      break;
    case 'triggerBugFileInput':
      document.getElementById('bug-files')?.click();
      break;
    // ── Delete / Bulk assign dialog ──────────────────────────
    case 'closeBulkAssignDialog':
      closeBulkAssignDialog();
      break;
    // ── Sync preview modal ───────────────────────────────────
    case 'syncPreviewSelectAll':
      syncPreviewSelectAll(btn.dataset.selectAll === 'true');
      break;
    case 'syncPreviewCancel':
      syncPreviewCancel();
      break;
    case 'syncPreviewConfirm':
      syncPreviewConfirm();
      break;
    // ── JIRA select modal ─────────────────────────────────────
    case 'jiraSelectAll':
      jiraSelectAll(btn.dataset.selectAll === 'true');
      break;
    case 'jiraSelectCancel':
      jiraSelectCancel();
      break;
    case 'jiraSelectConfirm':
      jiraSelectConfirm();
      break;
    // ── Split modal ───────────────────────────────────────────
    case 'closeSplitModal':
      closeSplitModal();
      break;
    case 'executeSplit':
      executeSplit();
      break;
    // ── Distribution modal ────────────────────────────────────
    case 'closeDistributionModal':
      closeDistributionModal();
      break;
    case 'applyDistribution':
      applyDistribution();
      break;
    // ── Sprint push modal ─────────────────────────────────────
    case 'closeSprintPushModal':
      closeSprintPushModal();
      break;
    case 'sprintPushToggleAllSprints':
      sprintPushToggleAllSprints(btn.dataset.selectAll === 'true');
      break;
    case 'startSprintPushPreview':
      startSprintPushPreview();
      break;
    case 'confirmSprintPush':
      confirmSprintPush();
      break;
    case 'toggleSprintPushFilter':
      toggleSprintPushFilter(btn.dataset.filterValue ?? '');
      break;
    case 'sprintPushSelectAll':
      sprintPushSelectAll(btn.dataset.selectAll === 'true');
      break;
    // ── Pull sprint modal ─────────────────────────────────────
    case 'closePullSprintModal':
      closePullSprintModal();
      break;
    case 'pullSprintToggleAll':
      pullSprintToggleAll(btn.dataset.selectAll === 'true');
      break;
    case 'startPullSprintPreview':
      startPullSprintPreview();
      break;
    case 'confirmPullSprint':
      confirmPullSprint();
      break;
    // ── Roadmap export dialog ─────────────────────────────────
    case 'closeRoadmapExportDialog':
      closeRoadmapExportDialog();
      break;
    case 'rexpToggleAllSprints':
      rexpToggleAllSprints(btn.dataset.selectAll === 'true');
      break;
    case 'rexpToggleAllTeams':
      rexpToggleAllTeams(btn.dataset.selectAll === 'true');
      break;
    case 'executeRoadmapExport':
      executeRoadmapExport();
      break;
    // ── Dependency modal ──────────────────────────────────────
    case 'closeDepModal':
      closeDepModal();
      break;
    case 'addDepLink':
      addDepLink();
      break;
    case 'addParallelLink':
      addParallelLink();
      break;
    // ── Issue split modal (list view) ─────────────────────────
    case 'closeIssueSplitModal':
      closeIssueSplitModal();
      break;
    case 'executeSplitIssue':
      executeSplitIssue();
      break;
    // ── Documentation view ─────────────────────────────────────
    case 'setDocMode': {
      const fn = window['setDocMode'];
      if (typeof fn === 'function') fn(btn.dataset.filterValue ?? '');
      break;
    }
    case 'docSearch': {
      const fn = window['docSearch'];
      if (typeof fn === 'function') fn();
      break;
    }
    case 'docSetTypeFilter':
      docSetTypeFilter(btn.dataset.filterValue);
      break;
    case 'askAI':
      void askAI();
      break;
    case 'selectAllSuggestions':
      selectAllSuggestions();
      break;
    case 'deselectAllSuggestions':
      deselectAllSuggestions();
      break;
    case 'modifyDocumentation':
      modifyDocumentation();
      break;
    case 'exportDocumentationPdf':
      void exportDocumentationPdf();
      break;
    case 'undoChanges':
      void undoChanges();
      break;
    case 'searchDocumentationIssues':
      void searchDocumentationIssues();
      break;
    // ── Bugs view ─────────────────────────────────────────────
    case 'refreshBugsDashboard':
      refreshBugsDashboard();
      break;
    case 'analyzeBugs':
      analyzeBugs();
      break;
    case 'filterBugsEnv':
      setBugsEnvFilter(btn.dataset.env ?? 'all');
      break;
    case 'toggleBugsAnalysis':
      toggleBugsAnalysis();
      break;
    default:
      break;
  }
});
// ── Delegated input handler ───────────────────────────────────
document.addEventListener('input', (e) => {
  const target = e.target;
  const inputAction = target.dataset.inputAction;
  if (!inputAction) return;
  // All `data-input-action` sites are now typed self-registered input
  // actions (see actions.ts), the same migration the change handler above
  // already completed. dispatchInputAction() is a no-op (returns false) for
  // an action name nothing has registered, so a future `data-input-action`
  // added without a matching registerInputActions() call fails silently on
  // input rather than compiling — same tradeoff the click/change registries
  // already accept.
  dispatchInputAction(inputAction, target, e);
});
// ── Delegated contextmenu handler ───────────────────────────────
// Only the one migrated site (list-render.ts's row) emits
// `data-context-action` so far — see the "Context-menu-event registry"
// section of actions.ts. The remaining three `oncontextmenu="fn(event,...)"`
// sites (roadmap-render.ts's estimated-sprint placeholder card, epic row,
// and story card) are plain inline attributes, not delegated through this
// listener at all; `target.closest('[data-context-action]')` simply finds
// nothing for them and this listener no-ops, so they keep working exactly
// as before via main.ts's `_dynGlobals` bridge until a future increment
// migrates them too.
document.addEventListener('contextmenu', (e) => {
  const target = e.target;
  const btn = target.closest('[data-context-action]');
  if (!btn) return;
  const contextAction = btn.dataset.contextAction ?? '';
  dispatchContextAction(contextAction, btn, e);
});
// ── Delegated keydown handler ────────────────────────────────────
// Two migrated sites so far — refine.ts's title-edit input and
// jira-pull.ts's inline "update from JIRA key" prompt — see the
// "Keydown-event registry" section of actions.ts. This is a separate
// listener from the app-wide-shortcuts one above (Ctrl+B, global Escape):
// that one is a fixed set of document-level shortcuts, this one dispatches
// by `data-keydown-action` the same way the click/change/input/contextmenu
// listeners dispatch by their own `data-*-action` attribute. The remaining
// `onkeydown="if(event.key===...){...}"` sites are plain inline attributes,
// not delegated through this listener at all; `target.dataset.keydownAction`
// simply comes back undefined for them and this listener no-ops, so they
// keep working exactly as before via main.ts's `_dynGlobals` bridge until a
// future increment migrates them too.
document.addEventListener('keydown', (e) => {
  const target = e.target;
  const keydownAction = target.dataset.keydownAction;
  if (!keydownAction) return;
  dispatchKeydownAction(keydownAction, target, e);
});
// ── Delegated change handler ──────────────────────────────────
document.addEventListener('change', (e) => {
  const target = e.target;
  const changeAction = target.dataset.changeAction;
  if (!changeAction) return;
  // All `data-change-action` sites are now typed self-registered change
  // actions (see actions.ts) — the switch this listener used to fall
  // through to for unmigrated cases (saveSplitThreshold in piconfig.ts;
  // filterBugsTable / toggleClosedBugsChange in bugs-dashboard.ts, in
  // addition to the docSetSprint / docSetFixVersionBulk / updateDocStatus /
  // updateDocSprint / updateDocTeam / updateDocWorkCategory /
  // onProviderChange / updateModelSetting / updateEffortSetting migrated
  // earlier) has been removed. dispatchChangeAction() is a no-op (returns
  // false) for an action name nothing has registered, so a future
  // `data-change-action` added without a matching registerChangeActions()
  // call fails silently on change rather than compiling — same tradeoff the
  // click registry already accepts.
  dispatchChangeAction(changeAction, target, e);
});
// ── Window globals for dynamically-generated HTML ─────────────
// These functions are injected into inline event strings by TypeScript
// template literals in list-render.ts, roadmap-render.ts, refine.ts,
// detail-fields.ts, etc. They cannot yet be migrated to delegated
// listeners without refactoring each template — that is out of scope
// for this issue.
//
// Fifteen views have been migrated off this bridge so far (issue #461) —
// see actions.ts for the pattern:
//   - The list multi-select context menu (list-filters.ts's showContextMenu).
//     Its four handlers (contextMoveToPI, contextDeleteSelected,
//     contextAssignField, contextSplitItem) are intentionally absent below.
//   - The canvas edge "add link" popup (refine-edges.ts's _showLinkPopup).
//     Its two handlers (_createCanvasLink, _closeLinkPopup) are intentionally
//     absent below — see EDGE_ACTIONS in refine-edges.ts.
//   - The skills view's card buttons (skills.ts's renderSkillCard /
//     renderProductContext). Its six handlers (toggleSkillCard, saveSkill,
//     resetSkill, improveSkill, saveProductContext, resetProductContext) are
//     intentionally absent below — see SKILL_ACTIONS in skills.ts.
//   - The roadmap epic/story context menus' action buttons
//     (roadmap-context-menus.ts's handleEpicContextMenu / handleStoryContextMenu
//     submenus). Its four handlers (rmCtxOpenEpic, rmCtxMoveEpic, rmCtxMoveStory,
//     rmCtxSetSprint) are intentionally absent below — see RM_CTX_ACTIONS in
//     roadmap-context-menus.ts. The three menu *openers* themselves
//     (handleEstCardContextMenu/handleEpicContextMenu/handleStoryContextMenu)
//     are also absent below now — see the registerContextActions() call in
//     roadmap-context-menus.ts and ROADMAP_RENDER_CTX_ACTIONS in
//     roadmap-render.ts, the contextmenu-event registry migration that
//     replaced their `oncontextmenu="..."` strings.
//   - The Import tab's result-list toggle (jira-import.ts's renderJiraResults).
//     Its one handler (toggleJiraItem) is intentionally absent below — see
//     JIRA_IMPORT_ACTIONS in jira-import.ts.
//   - The bug-report file list's remove button (bugcreate.ts's
//     renderBugFileList). Its one handler (removeBugFile) is intentionally
//     absent below — see BUGCREATE_ACTIONS in bugcreate.ts.
//   - The PI sprint config's per-row remove button (piconfig.ts's
//     renderSprintRows), its JIRA sprint-import banner's three buttons
//     (renderJiraImportOffer's Import/Skip, renderJiraImportConfirmation's
//     dismiss ×), and its two PI-header "Sync from JIRA" buttons plus the PI
//     tab bar (renderPiConfigTabs / _renderPiTabButtons). Its six handlers
//     (removeSprintRow, confirmJiraSprintImport, skipJiraSprintImport,
//     dismissJiraImportBanner, syncPiFromJira, selectPiConfigTab) are
//     intentionally absent below — see PICONFIG_ACTIONS in piconfig.ts.
//     _updatePiFromConfig stays on this bridge: it backs the two version
//     `onchange="..."` selects, which the data-action click dispatcher
//     doesn't cover.
//   - The detail view's dependency chip "remove" button and its clickable
//     label (detail-links.ts's renderDetailDeps), and its hierarchy panel's
//     parent row, per-child expand/collapse header, and "Link existing"
//     button (detail-links.ts's loadHierarchy). Its four handlers
//     (deleteDepFromDetail, toggleHierarchyChild, linkExistingChildren, and —
//     added in a later pass — the dep chip label's and parent row's
//     onclick="openDoc(...)") are intentionally absent below — see
//     DETAIL_LINKS_ACTIONS in detail-links.ts. (deleteDepFromDetail was
//     previously unreachable at runtime: it was never added to this bridge,
//     so the button silently threw on click — that migration fixed it as a
//     side effect.)
//   - The detail view's comment CRUD buttons (detail-fields.ts's
//     _renderComments). Its five handlers (addDocComment, startCommentEdit,
//     cancelCommentEdit, saveCommentEdit, deleteDocComment) are intentionally
//     absent below — see DETAIL_COMMENT_ACTIONS in detail-fields.ts.
//   - The refine panel's epic/story/spike/bug create & edit forms
//     (refine.ts's openManualRefine/_renderEpicPanel/openRefinePanel/
//     openCreatePanel templates). Its twelve handlers (refineOpenCreatePanel,
//     refineToggleManageLinks [wraps refine-edges.ts's toggleManageLinks],
//     refineToggleEpicPanel [wraps _toggleEpicPanel], refineFpCreateChild
//     [wraps refine-nodes.ts's _fpCreateChild], refineOpenEpicPanel,
//     refineClosePanel, refineToggleUpgrade, refineOpenDocAndClose,
//     refineConfirmDelete, refineExecuteUpgrade, refineRemoveDep,
//     refineExecuteCreate) are intentionally absent below — see
//     REFINE_ACTIONS in refine.ts. (saveRpTitle and saveRpStoryPoints stay
//     on this bridge: the inline-edit inputs' onblur attributes are out of
//     scope for the data-action click dispatcher. cancelRpTitleEdit moved
//     off this bridge in a later pass — see the "Keydown-event registry"
//     paragraph below. The priority <select>'s onchange now calls
//     saveRpPriority directly via addEventListener instead of the bridge.)
//   - The empty-cell-create and split popups' close/confirm buttons
//     (refine-nodes.ts's _openCellCreateForm/_openCanvasSplit templates —
//     the last two sites that were still reached via
//     onclick="closeRefinePanel()" / onclick="_executeCanvasSplit(...)"
//     strings). Their handlers are intentionally absent below — see
//     REFINE_NODES_ACTIONS in refine-nodes.ts.
//   - The dependency modal's per-item "remove" button (roadmap.ts's
//     renderDepLists). Its one handler (removeDepLink) is intentionally
//     absent below — see ROADMAP_DEP_ACTIONS in roadmap.ts. This pass also
//     removed openRefinePanel from this bridge: an audit found no remaining
//     onclick="..." caller anywhere — every call site is a direct function
//     import — so it no longer needs to be here at all.
//   - The documentation panel's issue-row click, pager buttons, and
//     suggestion-row expand/collapse toggle (documentation.ts's
//     renderDocIssueRow / pager / suggestion templates). Its three handlers
//     (docRowClick, docSetPage, toggleSuggestionRow) are intentionally
//     absent below — see DOC_ACTIONS in documentation.ts. (This bullet was
//     missing from an earlier pass despite the migration having landed —
//     added here for an accurate count.)
//   - The roadmap board's epic-row click, story-card click, dependency-manage
//     button, and cross-PI "ghost card" (roadmap-render.ts's
//     renderRoadmapBoard / buildRoadmapCardHtml / injectGhostCards
//     templates). Its four handlers (handleRoadmapEpicClick,
//     handleRoadmapCardClick, openDepModal, and — added in a later pass —
//     the ghost card's onclick="openDoc(...)") are intentionally absent
//     below — see ROADMAP_RENDER_ACTIONS in roadmap-render.ts.
//     (openDepModal was previously unreachable at runtime: it was never
//     added to this bridge, so the dependency-manage button [⛓] silently
//     threw on click — this migration fixed it as a side effect, the same
//     class of latent bug the detail-links.ts and roadmap.ts passes above
//     each fixed in turn.) The ghost card's onclick="openDoc(...)" was the
//     last remaining onclick="openDoc(...)" site anywhere in public/ts/, so
//     openDoc itself still stays on this bridge below — not because of any
//     remaining onclick="..." string (there are none left), but because
//     list-filters.ts's handleItemClick and roadmap-select.ts's
//     handleRoadmapCardClick/handleRoadmapEpicClick call the bare
//     `openDoc(...)` global directly (as a plain function call, not an
//     onclick attribute) rather than importing it from detail.ts, the same
//     avoid-a-heavier-dependency-graph reasoning detail-links.ts and this
//     module document for their own ambient-global use of it. A first pass
//     at this migration removed openDoc from the bridge on the (incorrect)
//     assumption that "last onclick=openDoc(...) site gone" meant "no more
//     consumers" — CI's e2e suite caught the resulting regression (list/
//     roadmap item clicks silently failing to open the detail view) before
//     merge, so it's restored here.
//   - The inline "update from JIRA key" prompt's submit button
//     (jira-pull.ts's showUpdateFromJiraKeyPrompt). Its one handler
//     (submitUpdateFromJiraKey) is intentionally absent from the delegated
//     switch above — see JIRA_PULL_ACTIONS in jira-pull.ts. It no longer
//     appears below on this bridge at all: the same input's onkeydown
//     (Enter/Escape) moved off the bridge in a later pass too — see the
//     "Keydown-event registry" paragraph below.
// All fifteen views now self-register via registerActions() instead.
//
// The registry above is `click`-only; the delegated `change` handler defined
// earlier still has its own hand-written switch, same shape as this bridge
// used to have. As a proof-of-concept spike, one pair of sites has been
// migrated off it onto a new, separately-namespaced change-action registry
// (see the "Change-event registry" section of actions.ts):
//   - The documentation panel's Sprint and Fix Version mode <select>s
//     (index.html's #doc-sprint-select / #doc-filter-version, both already
//     emitting data-change-action). Their two handlers (docSetSprint,
//     docSetFixVersionBulk) are intentionally absent from both this bridge
//     and the change switch below — see the registerChangeActions() call in
//     documentation.ts. This migration also fixed an anti-pattern: the
//     change switch previously reached these two handlers via an untyped
//     `window` lookup even though main.ts already had them as direct
//     imports — the exact class of bridge indirection issue #461 exists to
//     remove.
// The `input` listener (defined just above the `change` one) has not been
// touched by this spike and remains a plain switch — a future increment can
// extend the same pattern to it once this one has proven out.
//
// A fourth, independent registry now covers `contextmenu` too (see the
// "Context-menu-event registry" section of actions.ts). What started as a
// one-site spike now covers all four `oncontextmenu="..."` sites that ever
// existed in public/ts/:
//   - The backlog list row's context-menu opener (list-render.ts's former
//     `oncontextmenu="handleItemContextMenu(...)"`, now
//     `data-context-action`). Its handler (handleItemContextMenu) is
//     intentionally absent below — see the registerContextActions() call in
//     list-filters.ts, where the handler is already defined.
//   - roadmap-render.ts's estimated-sprint placeholder card, epic row, and
//     story card (former `oncontextmenu="handleEstCardContextMenu(...)"` /
//     `handleEpicContextMenu(...)"` / `handleStoryContextMenu(...)"`, now
//     `data-context-action`). Their three handlers are intentionally absent
//     below — see the registerContextActions() call in
//     roadmap-context-menus.ts and ROADMAP_RENDER_CTX_ACTIONS in
//     roadmap-render.ts.
// A fresh `grep -rn 'oncontextmenu=' public/ts/` now returns nothing.
//
// A fifth, independent registry now covers `keydown` too (see the
// "Keydown-event registry" section of actions.ts) — a proof-of-concept spike
// on the two sites named most often in prior status comments as the leading
// candidates:
//   - refine.ts's title-edit input (former
//     `onkeydown="if(event.key==='Enter'){this.blur()}
//     if(event.key==='Escape'){cancelRpTitleEdit()}"`, now
//     `data-keydown-action`). cancelRpTitleEdit is intentionally absent
//     below — see the registerKeydownActions() call in refine.ts.
//   - jira-pull.ts's inline "update from JIRA key" prompt input (former
//     `onkeydown="if(event.key==='Enter'){...submitUpdateFromJiraKey()}
//     if(event.key==='Escape'){closeAllDropdowns()}"`, now
//     `data-keydown-action`). closeAllDropdowns and submitUpdateFromJiraKey
//     are intentionally absent below — see the registerKeydownActions() call
//     in jira-pull.ts.
// The remaining `onkeydown="..."` sites — refine.ts's story-points input
// (both branches just call `this.blur()`, nothing to remove from this
// bridge), and a handful of static fields in index.html (the detail title
// input, the SP input, the docs/JIRA search boxes) — are left as plain
// inline attributes for a future increment to migrate once this one has
// proven out, the same staged approach the change/input/contextmenu
// registries themselves followed.
const _dynGlobals = {
  // list-render.ts / list-filters.ts
  toggleItemCollapse,
  toggleSwimlane,
  updatePiVersion,
  handleItemClick,
  showContextMenu,
  closeContextMenu,
  openDistributionModal,
  // detail.js — openDoc still used from list-filters.ts / roadmap-select.ts
  // as a bare ambient global (see the narrative comment above this bridge).
  // closeAllDropdowns moved off this bridge (issue #461's keydown-registry
  // spike): its only inline-attribute caller was jira-pull.ts's JIRA-key
  // prompt onkeydown, now migrated to registerKeydownActions, and every
  // other call site already imports it directly.
  openDoc,
  loadHierarchy,
  // detail-links.ts
  saveTitle,
  // cancelTitleEdit backs the detail title input's onkeydown in index.html
  // (Escape branch) — a future increment can migrate that static site the
  // same way jira-pull.ts's and refine.ts's were this round.
  cancelTitleEdit,
  saveStoryPoints,
  // refine.js — saveRpTitle/saveRpStoryPoints back the refine panel's
  // inline-edit inputs' onblur attributes (out of scope for the data-action
  // click dispatcher — see REFINE_ACTIONS in refine.ts). cancelRpTitleEdit
  // moved off this bridge (issue #461's keydown-registry spike): its only
  // caller was the title input's onkeydown Escape branch, now migrated to
  // registerKeydownActions. openRefinePanel was audited and confirmed to
  // have no remaining onclick="..." caller anywhere — every call site is a
  // direct function import (refine-canvas.ts, refine-nodes.ts, refine.ts) —
  // so it's removed from this bridge rather than left pending.
  saveRpTitle,
  saveRpStoryPoints,
  // refine-edges.ts
  _showEdgePopup,
  _deleteCanvasLink,
  _changeCanvasLinkType,
  // refine-nodes.ts — closeRefinePanel/_executeCanvasSplit moved off this
  // bridge onto REFINE_NODES_ACTIONS (issue #461); see that module.
  _showCardContextMenu,
  _showFpCardContextMenu,
  _fpMoveToEpic,
  _showEpicContextMenu,
  _showEmptyCellMenu,
  _openCellCreateForm,
  _executeEmptyCellCreate,
  _showMultiCardContextMenu,
  _moveCardsToEdge,
  _openCanvasSplit,
  _moveCardToEdge,
  // roadmap.ts
  toggleRoadmapPi,
  // roadmap-render.ts — handleRoadmapCardClick/handleRoadmapEpicClick/
  // openDepModal moved off this bridge onto ROADMAP_RENDER_ACTIONS (issue
  // #461); see that module. openDepModal was in fact never on this bridge
  // in the first place — the dep-manage button's onclick was unreachable
  // at runtime before this migration.
  // roadmap-jira-sync.ts — _sprintPushUpdateCount/_pullSprintUpdateCount/
  // pullSprintSelectAllItems's onchange sites moved off this bridge onto
  // ROADMAP_JIRA_SYNC_CHANGE_ACTIONS (issue #461); see that module.
  // piconfig.ts
  _updatePiFromConfig,
  // jira-pull.ts — submitUpdateFromJiraKey's onclick moved to
  // JIRA_PULL_ACTIONS (issue #461) and its onkeydown moved to
  // registerKeydownActions in the same later pass, so it's gone from this
  // bridge entirely.
  // bugcreate.ts
  onBugFilesSelected,
  // bugs-dashboard.ts
  bugToggleKey,
  bugToggleAll,
  // documentation.ts — docRowClick/docSetPage/toggleSuggestionRow moved off
  // this bridge onto DOC_ACTIONS (issue #461); docSetSprint/
  // docSetFixVersionBulk moved off it too, onto the new change-action
  // registry (see the "Change-event registry" section of actions.ts and
  // the registerChangeActions() call in documentation.ts).
  setDocMode,
  docSearch,
  docToggleKey,
  toggleSuggestionCheck,
  // onkeydown handlers remaining in index.html inputs
  searchJira,
  pullByKey,
  // Exposed for cross-module calls (also in FRONTEND_GLOBALS eslint list)
  focusEpic,
  updateSplitMode,
};
Object.assign(window, _dynGlobals);
//# sourceMappingURL=main.js.map
