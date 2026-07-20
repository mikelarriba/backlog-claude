// ── ES Module entry point ────────────────────────────────────────
import { fetchJSON, debounce } from './state.js';
import type { DocEntry } from './state.js';
import { on } from './store.js';
import {
  loadDocs,
  loadPiSettings,
  loadJiraVersions,
  contextSplitItem,
  closeIssueSplitModal,
  executeSplitIssue,
} from './list.js';
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
  applyFiltersDebounced,
  handleItemClick,
  handleItemContextMenu,
  showContextMenu,
  closeContextMenu,
  contextMoveToPI,
  contextDeleteSelected,
  contextAssignField,
  closeBulkAssignDialog,
} from './list-filters.js';
import { dismissWelcomeBanner } from './list-render.js';
import {
  saveTitle,
  cancelTitleEdit,
  updateDocStatus,
  showList,
  confirmDelete,
  closeDeleteDialog,
  executeDelete,
  toggleDropdown,
  closeDropdown,
  closeAllDropdowns,
  toggleOriginal,
  openDoc,
} from './detail.js';
import {
  saveStoryPoints,
  updateDocSprint,
  updateDocTeam,
  updateDocWorkCategory,
  addDocComment,
  startCommentEdit,
  cancelCommentEdit,
  saveCommentEdit,
  deleteDocComment,
} from './detail-fields.js';
import {
  toggleHierarchy,
  loadHierarchy,
  linkExistingChildren,
  toggleHierarchyChild,
} from './detail-links.js';
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
  toggleJiraItem,
} from './jira-import.js';
import {
  syncPreviewSelectAll,
  syncPreviewCancel,
  syncPreviewConfirm,
  pushToJira,
} from './jira-push.js';
import { pullFromJira, checkAllJira, submitUpdateFromJiraKey } from './jira-pull.js';
import {
  openBugForm,
  closeBugForm,
  onBugFilesSelected,
  submitBugReport,
  removeBugFile,
} from './bugcreate.js';
import { resetCanvasLayout } from './refine-canvas.js';
import {
  _showEdgePopup,
  _deleteCanvasLink,
  _changeCanvasLinkType,
  toggleManageLinks,
  _closeLinkPopup,
  _createCanvasLink,
} from './refine-edges.js';
import {
  _fpCreateChild,
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
  _executeCanvasSplit,
  _moveCardToEdge,
} from './refine-nodes.js';
import {
  onCanvasSearch,
  openManualRefine,
  closeRefineView,
  renderFeatureMultiPanel,
  _toggleEpicPanel,
  closeRefinePanel,
  openRefinePanel,
  _removeCanvasLink,
  saveRpTitle,
  cancelRpTitleEdit,
  saveRpStoryPoints,
  saveRpPriority,
  toggleRpUpgrade,
  executeRpUpgrade,
  confirmRpDelete,
  openCreatePanel,
  executeRpCreate,
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
  removeSprintRow,
  selectPiConfigTab,
  saveSprintConfig,
  saveSplitThreshold,
  loadAllSprintConfigs,
  renderPiConfigTabs,
  _updatePiFromConfig,
  syncPiFromJira,
  confirmJiraSprintImport,
  skipJiraSprintImport,
  dismissJiraImportBanner,
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
  filterRoadmapEpics,
  focusEpic,
  addDepLink,
  addParallelLink,
  removeDepLink,
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
  _sprintPushUpdateCount,
  pullFromJiraSprints,
  closePullSprintModal,
  pullSprintToggleAll,
  startPullSprintPreview,
  pullSprintSelectAllItems,
  _pullSprintUpdateCount,
  confirmPullSprint,
} from './roadmap-jira-sync.js';
import {
  handleEpicContextMenu,
  handleStoryContextMenu,
  rmCtxOpenEpic,
  rmCtxMoveEpic,
  rmCtxMoveStory,
  rmCtxSetSprint,
} from './roadmap-context-menus.js';
import {
  handleRoadmapCardClick,
  handleRoadmapEpicClick,
  clearRoadmapSelection,
} from './roadmap-select.js';
import {
  loadSkillsView,
  toggleSkillCard,
  saveSkill,
  resetSkill,
  improveSkill,
  saveProductContext,
  resetProductContext,
  handleSkillSSE,
} from './skills.js';
import { initDragDrop } from './dragdrop.js';
import {
  toggleModelSection,
  loadModelSetting,
  onProviderChange,
  refreshProviders,
  updateModelSetting,
  updateEffortSetting,
} from './provider-settings.js';
import { _connectSSE } from './sse-client.js';
import {
  toggleAiSavingsSection,
  loadAiSavingsSection,
  filterAiSavings,
  exportAiSavingsPdf,
  exportAiSavingsPptx,
} from './ai-savings.js';
import {
  loadBugsDashboard,
  refreshBugsDashboard,
  filterBugsTable,
  analyzeBugs,
  closeBugsAnalysis,
  bugToggleKey,
  bugToggleAll,
  toggleClosedBugs,
} from './bugs-dashboard.js';
import {
  loadDocumentationView,
  docFilterInput,
  docSetTypeFilter,
  docSetFixVersion,
  searchDocumentationIssues,
  docSetPage,
  docRowClick,
  docToggleKey,
  askAI,
  toggleSuggestionRow,
  toggleSuggestionCheck,
  selectAllSuggestions,
  deselectAllSuggestions,
  modifyDocumentation,
  undoChanges,
  setDocMode,
  docSearch,
  docSetSprint,
  docSetFixVersionBulk,
} from './documentation.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Split-panel mode ───────────────────────────────────────────
const SPLIT_MIN_WIDTH = 1280;

export function isSplitMode(): boolean {
  return (
    (document.querySelector('.right') as HTMLElement | null)?.classList.contains('split-mode') ??
    false
  );
}

function updateSplitMode(): void {
  const wide = window.innerWidth >= SPLIT_MIN_WIDTH;
  const right = document.querySelector('.right') as HTMLElement | null;
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

export function highlightSelectedItem(filename: string | null, docType: string): void {
  document
    .querySelectorAll<HTMLElement>('.epic-item, .roadmap-card')
    .forEach((el) => el.classList.remove('selected'));
  if (filename) {
    document
      .querySelector<HTMLElement>(
        `.epic-item[data-filename="${CSS.escape(filename)}"][data-doctype="${docType}"]`
      )
      ?.classList.add('selected');
    document
      .querySelector<HTMLElement>(
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
function toggleLeftPanel(): void {
  const app = document.getElementById('app-root');
  if (!app) return;
  const collapsed = app.classList.toggle('left-collapsed');
  try {
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  } catch {
    /* no-op */
  }
}

// ── Sidebar navigation ────────────────────────────────────────
type ViewName =
  | 'backlog'
  | 'roadmap'
  | 'settings'
  | 'skills'
  | 'documentation'
  | 'bugs'
  | 'suggestions';

function navigateTo(viewName: ViewName): void {
  // Update active state in sidebar
  document.querySelectorAll<HTMLElement>('.sidebar-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });

  // Hide all views
  const lv = document.getElementById('list-view');
  if (lv) lv.style.display = 'none';
  document.getElementById('detail-view')?.classList.remove('show');
  document.getElementById('refine-view')?.classList.remove('show');
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
function closeSettingsView(): void {
  navigateTo('backlog');
}

// ── FAB (Floating Action Button) ──────────────────────────────
function openFab(): void {
  document.getElementById('fab-panel')?.classList.add('open');
  document.getElementById('fab-btn')?.classList.add('open');
}

function closeFab(): void {
  document.getElementById('fab-panel')?.classList.remove('open');
  document.getElementById('fab-btn')?.classList.remove('open');
  closeBugForm();
}

function toggleFab(): void {
  const panel = document.getElementById('fab-panel');
  if (panel?.classList.contains('open')) {
    closeFab();
  } else {
    openFab();
  }
}

function switchFabTab(tabName: string): void {
  document.querySelectorAll('.fab-tab').forEach((btn) => {
    (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.tab === tabName);
  });
  document.querySelectorAll('.fab-tab-content').forEach((div) => {
    (div as HTMLElement).classList.toggle('active', div.id === `fab-tab-${tabName}`);
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

document.addEventListener('keydown', (e: KeyboardEvent) => {
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
async function loadAppConfig(): Promise<void> {
  try {
    const cfg = (await fetchJSON('/api/config')) as { jiraBase?: string };
    if (cfg.jiraBase) jiraBase = cfg.jiraBase;
  } catch (e) {
    console.warn('Failed to load app config:', (e as Error).message);
  }
}

async function loadMetadata(): Promise<void> {
  try {
    const data = (await fetchJSON('/api/config/metadata')) as {
      teams: string[];
      workCategories: string[];
    };
    const { teams, workCategories } = data;
    _metaTeams = teams;
    _metaWorkCategories = workCategories;
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

// ── Store subscriptions ───────────────────────────────────────
// Subscribe to domain event so any mutation (upsertDoc, removeDoc, setDocs,
// or direct allDocs assignment via window) triggers applyFilters.
on('docs:changed', ({ docs }: { docs: DocEntry[] }) => applyFilters(docs));

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
})();
initDragDrop();
updateSplitMode();

_connectSSE();

const deleteOverlay = document.getElementById('delete-overlay');
if (deleteOverlay) {
  deleteOverlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === e.currentTarget) closeDeleteDialog();
  });
}

const splitOverlay = document.getElementById('split-overlay');
if (splitOverlay) {
  splitOverlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === e.currentTarget) closeSplitModal();
  });
}

// ── Delegated click handler ───────────────────────────────────
// Replaces the ~150 inline onclick attributes that previously called
// into the _globals bridge. Each element now carries data-action="fn"
// (and optional data-* argument attributes). The FAB outside-click
// handler is merged in here too.
document.addEventListener('click', (e: MouseEvent) => {
  // FAB outside-click: close if clicking outside the fab container
  const fabContainer = document.getElementById('fab-container');
  if (fabContainer && !fabContainer.contains(e.target as Node)) {
    closeFab();
  }

  const target = e.target as HTMLElement;
  const btn = target.closest('[data-action]') as HTMLElement | null;
  if (!btn) return;

  const action = btn.dataset.action ?? '';

  switch (action) {
    // ── Sidebar navigation ──────────────────────────────────
    case 'navigateTo':
      navigateTo(btn.dataset.viewName as ViewName);
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
      filterAiSavings((btn.dataset.filterValue ?? 'all') as 'week' | 'month' | 'all');
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
      const fn = (window as unknown as Record<string, unknown>)['setDocMode'];
      if (typeof fn === 'function') (fn as (v: string) => void)(btn.dataset.filterValue ?? '');
      break;
    }
    case 'docSearch': {
      const fn = (window as unknown as Record<string, unknown>)['docSearch'];
      if (typeof fn === 'function') (fn as () => void)();
      break;
    }
    case 'docSetTypeFilter':
      docSetTypeFilter(btn.dataset.filterValue as 'all' | 'epic' | 'story' | 'bug');
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
    case 'closeBugsAnalysis':
      closeBugsAnalysis();
      break;

    default:
      break;
  }
});

// ── Delegated input handler ───────────────────────────────────
document.addEventListener('input', (e: Event) => {
  const target = e.target as HTMLElement;
  const inputAction = target.dataset.inputAction;
  if (!inputAction) return;
  const inputEl = target as HTMLInputElement;

  switch (inputAction) {
    case 'applyFiltersDebounced':
      applyFiltersDebounced();
      break;
    case 'onCanvasSearchInput':
      onCanvasSearch(inputEl.value);
      break;
    case 'filterRoadmapEpicsInput':
      filterRoadmapEpics(inputEl.value);
      break;
    case 'docFilterInputAction':
      docFilterInput(inputEl.value);
      break;
    default:
      break;
  }
});

// ── Delegated change handler ──────────────────────────────────
document.addEventListener('change', (e: Event) => {
  const target = e.target as HTMLElement;
  const changeAction = target.dataset.changeAction;
  if (!changeAction) return;
  const selectEl = target as HTMLSelectElement;
  const inputEl = target as HTMLInputElement;

  switch (changeAction) {
    case 'updateDocStatus':
      updateDocStatus(selectEl.value);
      break;
    case 'updateDocTeam':
      updateDocTeam(selectEl.value);
      break;
    case 'updateDocSprint':
      updateDocSprint(selectEl.value);
      break;
    case 'updateDocWorkCategory':
      updateDocWorkCategory(selectEl.value);
      break;
    case 'onProviderChange':
      onProviderChange(selectEl.value);
      break;
    case 'updateModelSetting':
      updateModelSetting(selectEl.value);
      break;
    case 'updateEffortSetting':
      updateEffortSetting(selectEl.value);
      break;
    case 'saveSplitThreshold':
      saveSplitThreshold(selectEl.value);
      break;
    case 'filterBugsTable':
      filterBugsTable();
      break;
    case 'toggleClosedBugsChange':
      toggleClosedBugs(inputEl.checked);
      break;
    case 'docSetSprint': {
      const fn = (window as unknown as Record<string, unknown>)['docSetSprint'];
      if (typeof fn === 'function') (fn as (v: string) => void)(selectEl.value);
      break;
    }
    case 'docSetFixVersionBulk': {
      const fn = (window as unknown as Record<string, unknown>)['docSetFixVersionBulk'];
      if (typeof fn === 'function') (fn as (v: string) => void)(selectEl.value);
      break;
    }
    default:
      break;
  }
});

// ── Window globals for dynamically-generated HTML ─────────────
// These functions are injected into inline event strings by TypeScript
// template literals in list-render.ts, roadmap-render.ts, refine.ts,
// detail-fields.ts, etc. They cannot yet be migrated to delegated
// listeners without refactoring each template — that is out of scope
// for this issue.
const _dynGlobals: Record<string, unknown> = {
  // list-render.ts / list-filters.ts
  toggleItemCollapse,
  toggleSwimlane,
  updatePiVersion,
  handleItemClick,
  handleItemContextMenu,
  showContextMenu,
  closeContextMenu,
  contextMoveToPI,
  contextDeleteSelected,
  contextAssignField,
  contextSplitItem,
  openDistributionModal,
  // detail.js — still used from template-generated HTML (detail-links, etc.)
  openDoc,
  closeAllDropdowns,
  loadHierarchy,
  addDocComment,
  startCommentEdit,
  cancelCommentEdit,
  saveCommentEdit,
  deleteDocComment,
  linkExistingChildren,
  toggleHierarchyChild,
  // detail-links.ts
  saveTitle,
  cancelTitleEdit,
  saveStoryPoints,
  // refine.js — rendered in refine-nodes, refine-edges, refine.ts templates
  openManualRefine,
  closeRefinePanel,
  openRefinePanel,
  _toggleEpicPanel,
  _removeCanvasLink,
  saveRpTitle,
  cancelRpTitleEdit,
  saveRpStoryPoints,
  saveRpPriority,
  toggleRpUpgrade,
  executeRpUpgrade,
  confirmRpDelete,
  openCreatePanel,
  executeRpCreate,
  // refine-edges.ts
  _showEdgePopup,
  _deleteCanvasLink,
  _changeCanvasLinkType,
  toggleManageLinks,
  _closeLinkPopup,
  _createCanvasLink,
  // refine-nodes.ts
  _fpCreateChild,
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
  _executeCanvasSplit,
  _moveCardToEdge,
  // roadmap.ts
  toggleRoadmapPi,
  removeDepLink,
  // roadmap-render.ts
  handleRoadmapCardClick,
  handleRoadmapEpicClick,
  // roadmap-context-menus.ts
  handleEpicContextMenu,
  handleStoryContextMenu,
  rmCtxOpenEpic,
  rmCtxMoveEpic,
  rmCtxMoveStory,
  rmCtxSetSprint,
  // roadmap-jira-sync.ts
  _sprintPushUpdateCount,
  pullSprintSelectAllItems,
  _pullSprintUpdateCount,
  // piconfig.ts
  removeSprintRow,
  selectPiConfigTab,
  _updatePiFromConfig,
  syncPiFromJira,
  confirmJiraSprintImport,
  skipJiraSprintImport,
  dismissJiraImportBanner,
  // jira-import.ts
  toggleJiraItem,
  // jira-pull.ts
  submitUpdateFromJiraKey,
  // bugcreate.ts
  onBugFilesSelected,
  removeBugFile,
  // skills.ts
  toggleSkillCard,
  saveSkill,
  resetSkill,
  improveSkill,
  saveProductContext,
  resetProductContext,
  // bugs-dashboard.ts
  bugToggleKey,
  bugToggleAll,
  // documentation.ts
  setDocMode,
  docSearch,
  docSetSprint,
  docSetFixVersionBulk,
  docRowClick,
  docToggleKey,
  docSetPage,
  toggleSuggestionRow,
  toggleSuggestionCheck,
  // onkeydown handlers remaining in index.html inputs
  searchJira,
  pullByKey,
  // modal overlay onclick (overlay backdrop clicks) still in index.html
  closeSprintPushModal,
  closePullSprintModal,
  closeRoadmapExportDialog,
  closeIssueSplitModal,
  // Exposed for cross-module calls (also in FRONTEND_GLOBALS eslint list)
  focusEpic,
  updateSplitMode,
};

Object.assign(window, _dynGlobals);
