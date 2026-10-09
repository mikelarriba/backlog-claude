// ── ES Module entry point ────────────────────────────────────────
import { fetchJSON, debounce, setJiraBase } from './state.js';
import type { DocEntry } from './state.js';
import { on } from './store.js';
import { isSplitMode, highlightSelectedItem, updateSplitMode } from './split-mode.js';
import {
  loadDocs,
  loadPiSettings,
  loadJiraVersions,
  closeIssueSplitModal,
  executeSplitIssue,
} from './list.js';
import {
  registerActions,
  dispatchAction,
  dispatchChangeAction,
  dispatchInputAction,
  dispatchContextAction,
  dispatchKeydownAction,
  dispatchBlurAction,
} from './actions.js';
import {
  toggleItemCollapse,
  collapseAll,
  expandAll,
  toggleSwimlane,
  setTypeFilter,
  setStatusFilter,
  setTeamFilter,
  setWorkCatFilter,
  applyFilters,
  patchSingleDoc,
  handleItemClick,
  closeBulkAssignDialog,
} from './list-filters.js';
import { dismissWelcomeBanner } from './list-render.js';
import {
  showList,
  confirmDelete,
  closeDeleteDialog,
  executeDelete,
  toggleDropdown,
  closeDropdown,
  toggleOriginal,
  openDoc,
} from './detail.js';
import { toggleHierarchy } from './detail-links.js';
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
  downloadSelected,
} from './jira-import.js';
import {
  syncPreviewSelectAll,
  syncPreviewCancel,
  syncPreviewConfirm,
  pushToJira,
} from './jira-push.js';
import { pullFromJira, checkAllJira } from './jira-pull.js';
import { openBugForm, closeBugForm, submitBugReport } from './bugcreate.js';
import { resetCanvasLayout } from './refine-canvas.js';
import {
  openManualRefine,
  closeRefineView,
  resetRefineViewState,
  renderFeatureMultiPanel,
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
  addSprintRow,
  saveSprintConfig,
  loadAllSprintConfigs,
  renderPiConfigTabs,
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
import { clearRoadmapSelection } from './roadmap-select.js';
import { loadSkillsView, handleSkillSSE } from './skills.js';
import { initDragDrop } from './dragdrop.js';
import { loadModelSetting } from './provider-settings.js';
import { _connectSSE } from './sse-client.js';
import {
  toggleAiSavingsSection,
  loadAiSavingsSection,
  loadSidebarSavings,
  filterAiSavings,
  exportAiSavingsPdf,
  exportAiSavingsPptx,
} from './ai-savings.js';
import { loadBugsDashboard } from './bugs-dashboard.js';
import { loadDocumentationView, docSetFixVersion } from './documentation.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Split-panel mode ───────────────────────────────────────────
// Lives in split-mode.ts; re-exported here for existing importers.
export { isSplitMode, highlightSelectedItem, updateSplitMode };

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
  'backlog' | 'roadmap' | 'settings' | 'skills' | 'documentation' | 'bugs' | 'suggestions';

function navigateTo(viewName: ViewName): void {
  // Update active state in sidebar
  document.querySelectorAll<HTMLElement>('.sidebar-item').forEach((el) => {
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
function closeSettingsView(): void {
  navigateTo('backlog');
}

// Settings collapsibles start expanded every time the view opens, so the user
// sees all configuration at a glance rather than three closed accordions.
function openAllSettingsPanels(): void {
  const panels: Array<[string, string]> = [
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
    if (cfg.jiraBase) setJiraBase(cfg.jiraBase);
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
// or direct allDocs assignment via window) triggers a re-render. A single-doc
// upsertDoc() call that doesn't change the doc's tree position (see store.ts's
// `structural` flag) patches just that row instead of rebuilding the full
// swimlane tree; every other change (removeDoc, setDocs, a structural
// upsertDoc) falls back to the full applyFilters() rebuild.
on(
  'docs:changed',
  ({
    docs,
    changedFilename,
    structural,
  }: {
    docs: DocEntry[];
    changedFilename?: string;
    structural?: boolean;
  }) => {
    // Keep the roadmap board in sync with edits made from the detail panel
    // (e.g. an epic's Estimated Sprint Size / placement) while it's open —
    // the list-only patch/rebuild below doesn't touch the roadmap DOM.
    refreshRoadmapView();
    if (changedFilename && !structural && patchSingleDoc(changedFilename)) return;
    applyFilters(docs);
  }
);

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

// ── Core app-shell click actions ───────────────────────────────
// Navigation, theme, list toolbar, filter pills, the detail/refine/
// settings/roadmap views' own chrome, the FAB, and the app's various
// modals — the last actions still reached through main.ts's own switch
// (every view-owned action had already migrated to its own module's
// registerActions() call). These belong to main.ts itself rather than to
// any single view module, so they self-register here instead (issue
// #461's final increment) following the same two-step pattern as every
// other migrated module: a `const` object of action names, then one
// registerActions() call.
export const MAIN_ACTIONS = {
  navigateTo: 'navigateTo',
  setTheme: 'setTheme',
  collapseAll: 'collapseAll',
  expandAll: 'expandAll',
  checkAllJira: 'checkAllJira',
  setTypeFilter: 'setTypeFilter',
  setStatusFilter: 'setStatusFilter',
  setTeamFilter: 'setTeamFilter',
  setWorkCatFilter: 'setWorkCatFilter',
  showList: 'showList',
  toggleDropdown: 'toggleDropdown',
  toggleQuickCreateAndClose: 'toggleQuickCreateAndClose',
  generateStoriesAndClose: 'generateStoriesAndClose',
  openManualRefineAndClose: 'openManualRefineAndClose',
  pushToJiraAndClose: 'pushToJiraAndClose',
  pullFromJira: 'pullFromJira',
  exportEpicToPdfCurrent: 'exportEpicToPdfCurrent',
  confirmDelete: 'confirmDelete',
  closeDeleteDialog: 'closeDeleteDialog',
  executeDelete: 'executeDelete',
  executeQuickCreate: 'executeQuickCreate',
  closeQuickCreate: 'closeQuickCreate',
  toggleOriginal: 'toggleOriginal',
  toggleHierarchy: 'toggleHierarchy',
  closeRefineView: 'closeRefineView',
  resetCanvasLayoutCanvas: 'resetCanvasLayoutCanvas',
  exportEpicToPdfCanvas: 'exportEpicToPdfCanvas',
  closeSettingsView: 'closeSettingsView',
  addSprintRow: 'addSprintRow',
  saveSprintConfig: 'saveSprintConfig',
  openDistributionModalPiConfig: 'openDistributionModalPiConfig',
  toggleAiSavingsSection: 'toggleAiSavingsSection',
  filterAiSavings: 'filterAiSavings',
  exportAiSavingsPdf: 'exportAiSavingsPdf',
  exportAiSavingsPptx: 'exportAiSavingsPptx',
  closeRoadmapView: 'closeRoadmapView',
  openDistributionModalRoadmap: 'openDistributionModalRoadmap',
  pushSprintsToJira: 'pushSprintsToJira',
  pullFromJiraSprints: 'pullFromJiraSprints',
  openRoadmapExportDialog: 'openRoadmapExportDialog',
  toggleRoadmapPanel: 'toggleRoadmapPanel',
  dismissWelcomeBanner: 'dismissWelcomeBanner',
  toggleFab: 'toggleFab',
  closeFab: 'closeFab',
  switchFabTab: 'switchFabTab',
  clearForm: 'clearForm',
  saveDraft: 'saveDraft',
  generateDoc: 'generateDoc',
  openBugForm: 'openBugForm',
  downloadSelected: 'downloadSelected',
  closeBugForm: 'closeBugForm',
  submitBugReport: 'submitBugReport',
  triggerBugFileInput: 'triggerBugFileInput',
  closeBulkAssignDialog: 'closeBulkAssignDialog',
  syncPreviewSelectAll: 'syncPreviewSelectAll',
  syncPreviewCancel: 'syncPreviewCancel',
  syncPreviewConfirm: 'syncPreviewConfirm',
  jiraSelectAll: 'jiraSelectAll',
  jiraSelectCancel: 'jiraSelectCancel',
  jiraSelectConfirm: 'jiraSelectConfirm',
  closeSplitModal: 'closeSplitModal',
  executeSplit: 'executeSplit',
  closeDistributionModal: 'closeDistributionModal',
  applyDistribution: 'applyDistribution',
  closeSprintPushModal: 'closeSprintPushModal',
  sprintPushToggleAllSprints: 'sprintPushToggleAllSprints',
  startSprintPushPreview: 'startSprintPushPreview',
  confirmSprintPush: 'confirmSprintPush',
  toggleSprintPushFilter: 'toggleSprintPushFilter',
  sprintPushSelectAll: 'sprintPushSelectAll',
  closePullSprintModal: 'closePullSprintModal',
  pullSprintToggleAll: 'pullSprintToggleAll',
  startPullSprintPreview: 'startPullSprintPreview',
  confirmPullSprint: 'confirmPullSprint',
  closeRoadmapExportDialog: 'closeRoadmapExportDialog',
  rexpToggleAllSprints: 'rexpToggleAllSprints',
  rexpToggleAllTeams: 'rexpToggleAllTeams',
  executeRoadmapExport: 'executeRoadmapExport',
  closeDepModal: 'closeDepModal',
  addDepLink: 'addDepLink',
  addParallelLink: 'addParallelLink',
  closeIssueSplitModal: 'closeIssueSplitModal',
  executeSplitIssue: 'executeSplitIssue',
} as const;

registerActions({
  // ── Sidebar navigation ──────────────────────────────────
  [MAIN_ACTIONS.navigateTo]: (el) => {
    navigateTo(el.dataset.viewName as ViewName);
  },
  // ── Theme ───────────────────────────────────────────────
  [MAIN_ACTIONS.setTheme]: (el) => {
    if (typeof window.setTheme === 'function') window.setTheme(el.dataset.themeName ?? '');
  },
  // ── List toolbar ────────────────────────────────────────
  [MAIN_ACTIONS.collapseAll]: () => {
    collapseAll();
  },
  [MAIN_ACTIONS.expandAll]: () => {
    expandAll();
  },
  [MAIN_ACTIONS.checkAllJira]: () => {
    checkAllJira();
  },
  // ── Type / Status / Team / WorkCat filter pills ─────────
  [MAIN_ACTIONS.setTypeFilter]: (el) => {
    setTypeFilter(el.dataset.filterValue ?? '');
  },
  [MAIN_ACTIONS.setStatusFilter]: (el) => {
    setStatusFilter(el.dataset.filterValue ?? '');
  },
  [MAIN_ACTIONS.setTeamFilter]: (el) => {
    setTeamFilter(el.dataset.filterValue ?? '');
  },
  [MAIN_ACTIONS.setWorkCatFilter]: (el) => {
    setWorkCatFilter(el.dataset.filterValue ?? '');
  },
  // ── Detail view ─────────────────────────────────────────
  [MAIN_ACTIONS.showList]: () => {
    showList();
  },
  [MAIN_ACTIONS.toggleDropdown]: (el) => {
    toggleDropdown(el.dataset.dropdownId ?? '');
  },
  [MAIN_ACTIONS.toggleQuickCreateAndClose]: (el) => {
    toggleQuickCreate(el.dataset.doctype ?? '');
    closeDropdown(el.dataset.closeDropdown ?? '');
  },
  [MAIN_ACTIONS.generateStoriesAndClose]: (el) => {
    generateStories();
    closeDropdown(el.dataset.closeDropdown ?? '');
  },
  [MAIN_ACTIONS.openManualRefineAndClose]: (el) => {
    const cf = currentFilename;
    const cdt = currentDocType;
    openManualRefine(cf ?? '', cdt ?? '');
    closeDropdown(el.dataset.closeDropdown ?? '');
  },
  [MAIN_ACTIONS.pushToJiraAndClose]: (el) => {
    pushToJira();
    closeDropdown(el.dataset.closeDropdown ?? '');
  },
  [MAIN_ACTIONS.pullFromJira]: () => {
    pullFromJira();
  },
  [MAIN_ACTIONS.exportEpicToPdfCurrent]: () => {
    const cf = currentFilename;
    const cdt = currentDocType;
    exportEpicToPdf(cf ?? '', cdt ?? '');
  },
  [MAIN_ACTIONS.confirmDelete]: () => {
    confirmDelete();
  },
  [MAIN_ACTIONS.closeDeleteDialog]: () => {
    closeDeleteDialog();
  },
  [MAIN_ACTIONS.executeDelete]: () => {
    executeDelete();
  },
  [MAIN_ACTIONS.executeQuickCreate]: () => {
    executeQuickCreate();
  },
  [MAIN_ACTIONS.closeQuickCreate]: () => {
    closeQuickCreate();
  },
  [MAIN_ACTIONS.toggleOriginal]: () => {
    toggleOriginal();
  },
  [MAIN_ACTIONS.toggleHierarchy]: () => {
    toggleHierarchy();
  },
  // ── Refine view ─────────────────────────────────────────
  [MAIN_ACTIONS.closeRefineView]: () => {
    closeRefineView();
  },
  [MAIN_ACTIONS.resetCanvasLayoutCanvas]: () => {
    resetCanvasLayout(_canvasEpicFilename ?? '');
  },
  [MAIN_ACTIONS.exportEpicToPdfCanvas]: () => {
    exportEpicToPdf(_canvasEpicFilename ?? '', _canvasDocType ?? '');
  },
  // ── Settings view ────────────────────────────────────────
  [MAIN_ACTIONS.closeSettingsView]: () => {
    closeSettingsView();
  },
  // refreshProviders, toggleModelSection (provider-settings.ts) and
  // togglePiConfigSection (piconfig.ts) moved off this switch onto their
  // own modules' registerActions calls (issue #461).
  [MAIN_ACTIONS.addSprintRow]: () => {
    addSprintRow();
  },
  [MAIN_ACTIONS.saveSprintConfig]: () => {
    saveSprintConfig();
  },
  [MAIN_ACTIONS.openDistributionModalPiConfig]: () => {
    openDistributionModal(_piConfigActivePi ?? '');
  },
  [MAIN_ACTIONS.toggleAiSavingsSection]: () => {
    toggleAiSavingsSection();
  },
  [MAIN_ACTIONS.filterAiSavings]: (el) => {
    filterAiSavings((el.dataset.filterValue ?? 'all') as 'week' | 'month' | 'all');
  },
  [MAIN_ACTIONS.exportAiSavingsPdf]: () => {
    exportAiSavingsPdf();
  },
  [MAIN_ACTIONS.exportAiSavingsPptx]: () => {
    exportAiSavingsPptx();
  },
  // ── Roadmap view ─────────────────────────────────────────
  [MAIN_ACTIONS.closeRoadmapView]: () => {
    closeRoadmapView();
  },
  [MAIN_ACTIONS.openDistributionModalRoadmap]: () => {
    openDistributionModal([..._roadmapVisiblePis][0] ?? '');
  },
  [MAIN_ACTIONS.pushSprintsToJira]: () => {
    pushSprintsToJira();
  },
  [MAIN_ACTIONS.pullFromJiraSprints]: () => {
    pullFromJiraSprints();
  },
  [MAIN_ACTIONS.openRoadmapExportDialog]: () => {
    openRoadmapExportDialog();
  },
  [MAIN_ACTIONS.toggleRoadmapPanel]: (el) => {
    toggleRoadmapPanel(el.dataset.panel ?? '');
  },
  // ── Welcome banner ───────────────────────────────────────
  [MAIN_ACTIONS.dismissWelcomeBanner]: () => {
    dismissWelcomeBanner();
  },
  // ── FAB ──────────────────────────────────────────────────
  [MAIN_ACTIONS.toggleFab]: () => {
    toggleFab();
  },
  [MAIN_ACTIONS.closeFab]: () => {
    closeFab();
  },
  [MAIN_ACTIONS.switchFabTab]: (el) => {
    switchFabTab(el.dataset.tabName ?? '');
  },
  [MAIN_ACTIONS.clearForm]: () => {
    clearForm();
  },
  [MAIN_ACTIONS.saveDraft]: () => {
    saveDraft();
  },
  [MAIN_ACTIONS.generateDoc]: () => {
    generateDoc();
  },
  [MAIN_ACTIONS.openBugForm]: () => {
    openBugForm();
  },
  [MAIN_ACTIONS.downloadSelected]: () => {
    downloadSelected();
  },
  // searchJira/pullByKey (jira-import.ts) moved off this switch onto
  // JIRA_IMPORT_ACTIONS (issue #461); see that module.
  // ── Bug form ─────────────────────────────────────────────
  [MAIN_ACTIONS.closeBugForm]: () => {
    closeBugForm();
  },
  [MAIN_ACTIONS.submitBugReport]: () => {
    submitBugReport();
  },
  [MAIN_ACTIONS.triggerBugFileInput]: () => {
    document.getElementById('bug-files')?.click();
  },
  // ── Delete / Bulk assign dialog ──────────────────────────
  [MAIN_ACTIONS.closeBulkAssignDialog]: () => {
    closeBulkAssignDialog();
  },
  // ── Sync preview modal ───────────────────────────────────
  [MAIN_ACTIONS.syncPreviewSelectAll]: (el) => {
    syncPreviewSelectAll(el.dataset.selectAll === 'true');
  },
  [MAIN_ACTIONS.syncPreviewCancel]: () => {
    syncPreviewCancel();
  },
  [MAIN_ACTIONS.syncPreviewConfirm]: () => {
    syncPreviewConfirm();
  },
  // ── JIRA select modal ─────────────────────────────────────
  [MAIN_ACTIONS.jiraSelectAll]: (el) => {
    jiraSelectAll(el.dataset.selectAll === 'true');
  },
  [MAIN_ACTIONS.jiraSelectCancel]: () => {
    jiraSelectCancel();
  },
  [MAIN_ACTIONS.jiraSelectConfirm]: () => {
    jiraSelectConfirm();
  },
  // ── Split modal ───────────────────────────────────────────
  [MAIN_ACTIONS.closeSplitModal]: () => {
    closeSplitModal();
  },
  [MAIN_ACTIONS.executeSplit]: () => {
    executeSplit();
  },
  // ── Distribution modal ────────────────────────────────────
  [MAIN_ACTIONS.closeDistributionModal]: () => {
    closeDistributionModal();
  },
  [MAIN_ACTIONS.applyDistribution]: () => {
    applyDistribution();
  },
  // ── Sprint push modal ─────────────────────────────────────
  [MAIN_ACTIONS.closeSprintPushModal]: () => {
    closeSprintPushModal();
  },
  [MAIN_ACTIONS.sprintPushToggleAllSprints]: (el) => {
    sprintPushToggleAllSprints(el.dataset.selectAll === 'true');
  },
  [MAIN_ACTIONS.startSprintPushPreview]: () => {
    startSprintPushPreview();
  },
  [MAIN_ACTIONS.confirmSprintPush]: () => {
    confirmSprintPush();
  },
  [MAIN_ACTIONS.toggleSprintPushFilter]: (el) => {
    toggleSprintPushFilter(el.dataset.filterValue ?? '');
  },
  [MAIN_ACTIONS.sprintPushSelectAll]: (el) => {
    sprintPushSelectAll(el.dataset.selectAll === 'true');
  },
  // ── Pull sprint modal ─────────────────────────────────────
  [MAIN_ACTIONS.closePullSprintModal]: () => {
    closePullSprintModal();
  },
  [MAIN_ACTIONS.pullSprintToggleAll]: (el) => {
    pullSprintToggleAll(el.dataset.selectAll === 'true');
  },
  [MAIN_ACTIONS.startPullSprintPreview]: () => {
    startPullSprintPreview();
  },
  [MAIN_ACTIONS.confirmPullSprint]: () => {
    confirmPullSprint();
  },
  // ── Roadmap export dialog ─────────────────────────────────
  [MAIN_ACTIONS.closeRoadmapExportDialog]: () => {
    closeRoadmapExportDialog();
  },
  [MAIN_ACTIONS.rexpToggleAllSprints]: (el) => {
    rexpToggleAllSprints(el.dataset.selectAll === 'true');
  },
  [MAIN_ACTIONS.rexpToggleAllTeams]: (el) => {
    rexpToggleAllTeams(el.dataset.selectAll === 'true');
  },
  [MAIN_ACTIONS.executeRoadmapExport]: () => {
    executeRoadmapExport();
  },
  // ── Dependency modal ──────────────────────────────────────
  [MAIN_ACTIONS.closeDepModal]: () => {
    closeDepModal();
  },
  [MAIN_ACTIONS.addDepLink]: () => {
    addDepLink();
  },
  [MAIN_ACTIONS.addParallelLink]: () => {
    addParallelLink();
  },
  // ── Issue split modal (list view) ─────────────────────────
  [MAIN_ACTIONS.closeIssueSplitModal]: () => {
    closeIssueSplitModal();
  },
  [MAIN_ACTIONS.executeSplitIssue]: () => {
    executeSplitIssue();
  },
});

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

  // Every click action is a typed, self-registered handler (see actions.ts)
  // as of issue #461's final increment, which moved main.ts's own core
  // app-shell actions (see MAIN_ACTIONS below) off this file's ~320-line
  // switch onto the same registry every other view already used. The switch
  // itself is gone — dispatchAction is now the sole dispatch path.
  dispatchAction(action, btn, e);
});

// ── Delegated input handler ───────────────────────────────────
document.addEventListener('input', (e: Event) => {
  const target = e.target as HTMLElement;
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
// All four `oncontextmenu="fn(event,...)"` sites this app ever had — the
// list row (list-render.ts) and roadmap-render.ts's estimated-sprint
// placeholder card, epic row, and story card — now emit `data-context-
// action` and are reached through this listener; see the "Context-menu-
// event registry" section of actions.ts, LIST_ITEM_CTX_ACTIONS in
// list-filters.ts, and ROADMAP_RENDER_CTX_ACTIONS in roadmap-render.ts.
document.addEventListener('contextmenu', (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('[data-context-action]') as HTMLElement | null;
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
// keep working exactly as before until a future increment migrates them too.
document.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement;
  const keydownAction = target.dataset.keydownAction;
  if (!keydownAction) return;

  dispatchKeydownAction(keydownAction, target, e);
});

// ── Delegated blur handler ───────────────────────────────────────
// One migrated site so far — refine.ts's title and story-points inline-edit
// inputs — see the "Blur-event registry" section of actions.ts. Unlike the
// click/change/input/contextmenu/keydown listeners above, `blur` does not
// bubble, so this listener must be attached with `useCapture: true` to see
// it fire for descendants at all.
document.addEventListener(
  'blur',
  (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    const blurAction = target.dataset.blurAction;
    if (!blurAction) return;

    dispatchBlurAction(blurAction, target, e);
  },
  true
);

// ── Delegated change handler ──────────────────────────────────
document.addEventListener('change', (e: Event) => {
  const target = e.target as HTMLElement;
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
