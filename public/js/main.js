// ── ES Module entry point ────────────────────────────────────────
import { fetchJSON, debounce, store } from './state.js';
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
import './list-render.js';
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
  openBugModal,
  closeBugModal,
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
} from './skills.js';
import { initDragDrop } from './dragdrop.js';
import {
  toggleModelSection,
  loadModelSetting,
  onProviderChange,
  refreshProviders,
  updateModelSetting,
} from './provider-settings.js';
import { _connectSSE } from './sse-client.js';
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
  const _cf = store.get('currentFilename');
  const _cdt = store.get('currentDocType');
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
      break;
    case 'skills':
      document.getElementById('skills-view')?.classList.add('show');
      loadSkillsView();
      break;
    case 'documentation':
      document.getElementById('documentation-view')?.classList.add('show');
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
function openSettingsView() {
  navigateTo('settings');
}
function closeSettingsView() {
  navigateTo('backlog');
}
// ── FAB (Floating Action Button) ──────────────────────────────
function openFab() {
  document.getElementById('fab-panel')?.classList.add('open');
  document.getElementById('fab-btn')?.classList.add('open');
}
function closeFab() {
  document.getElementById('fab-panel')?.classList.remove('open');
  document.getElementById('fab-btn')?.classList.remove('open');
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
    if (cfg.jiraBase) store.set('jiraBase', cfg.jiraBase);
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
    btn.textContent = t;
    btn.setAttribute('onclick', `setTeamFilter('${t}')`);
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
    btn.textContent = WORKCAT_SHORT_LABELS[c] || c;
    btn.setAttribute('onclick', `setWorkCatFilter('${c}')`);
    container.appendChild(btn);
  }
}
// ── Store subscriptions ───────────────────────────────────────
// Subscribe to domain event so any mutation (upsertDoc, removeDoc, setDocs,
// or direct allDocs assignment via window) triggers applyFilters.
on('docs:changed', ({ docs }) => applyFilters(docs));
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
  deleteOverlay.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDeleteDialog();
  });
}
const splitOverlay = document.getElementById('split-overlay');
if (splitOverlay) {
  splitOverlay.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSplitModal();
  });
}
document.addEventListener('click', (e) => {
  const fabContainer = document.getElementById('fab-container');
  if (fabContainer && !fabContainer.contains(e.target)) {
    closeFab();
  }
});
// ── Expose functions for HTML onclick attributes ──────────────
// Using Object.assign to attach all handler functions to window without
// requiring verbose Window interface augmentation.
const _globals = {
  // list-filters.js
  toggleItemCollapse,
  collapseAll,
  expandAll,
  toggleSwimlane,
  updatePiVersion,
  setTypeFilter,
  setStatusFilter,
  setTeamFilter,
  setWorkCatFilter,
  applyFiltersDebounced,
  handleItemClick,
  handleItemContextMenu,
  showContextMenu,
  closeContextMenu,
  contextMoveToPI,
  contextDeleteSelected,
  contextAssignField,
  closeBulkAssignDialog,
  // list.js
  contextSplitItem,
  closeIssueSplitModal,
  executeSplitIssue,
  // detail.js
  saveStoryPoints,
  saveTitle,
  cancelTitleEdit,
  updateDocSprint,
  updateDocStatus,
  updateDocTeam,
  updateDocWorkCategory,
  showList,
  confirmDelete,
  closeDeleteDialog,
  executeDelete,
  toggleDropdown,
  closeDropdown,
  closeAllDropdowns,
  toggleHierarchy,
  toggleOriginal,
  openDoc,
  loadHierarchy,
  addDocComment,
  startCommentEdit,
  cancelCommentEdit,
  saveCommentEdit,
  deleteDocComment,
  linkExistingChildren,
  toggleHierarchyChild,
  // upgrade.js
  toggleUpgradePanel,
  executeUpgrade,
  // quickcreate.js
  saveDraft,
  generateDoc,
  clearForm,
  toggleQuickCreate,
  closeQuickCreate,
  executeQuickCreate,
  // stories.js
  generateStories,
  // jira.js
  jiraSelectAll,
  jiraSelectCancel,
  jiraSelectConfirm,
  syncPreviewSelectAll,
  syncPreviewCancel,
  syncPreviewConfirm,
  checkAllJira,
  searchJira,
  downloadSelected,
  pullByKey,
  pullFromJira,
  pushToJira,
  submitUpdateFromJiraKey,
  toggleJiraItem,
  // bugcreate.js
  openBugModal,
  closeBugModal,
  submitBugReport,
  onBugFilesSelected,
  removeBugFile,
  // refine-canvas.js
  resetCanvasLayout,
  // refine-edges.js
  toggleManageLinks,
  _closeLinkPopup,
  _createCanvasLink,
  _showEdgePopup,
  _deleteCanvasLink,
  _changeCanvasLinkType,
  // refine-nodes.js
  _fpCreateChild,
  _executeCanvasSplit,
  _openCellCreateForm,
  _executeEmptyCellCreate,
  _moveCardsToEdge,
  _openCanvasSplit,
  _moveCardToEdge,
  _showCardContextMenu,
  _showFpCardContextMenu,
  _showEpicContextMenu,
  _showEmptyCellMenu,
  _showMultiCardContextMenu,
  _fpMoveToEpic,
  // refine.js
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
  // export.js
  exportEpicToPdf,
  openRoadmapExportDialog,
  closeRoadmapExportDialog,
  executeRoadmapExport,
  rexpToggleAllSprints,
  rexpToggleAllTeams,
  // piconfig.js
  togglePiConfigSection,
  addSprintRow,
  removeSprintRow,
  selectPiConfigTab,
  saveSprintConfig,
  saveSplitThreshold,
  _updatePiFromConfig,
  syncPiFromJira,
  confirmJiraSprintImport,
  skipJiraSprintImport,
  dismissJiraImportBanner,
  // distribution.js
  openDistributionModal,
  closeDistributionModal,
  applyDistribution,
  // roadmap.js
  openRoadmapView,
  closeRoadmapView,
  refreshRoadmapView,
  toggleRoadmapPi,
  toggleRoadmapPanel,
  filterRoadmapEpics,
  focusEpic,
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
  closeDepModal,
  addDepLink,
  addParallelLink,
  removeDepLink,
  closeSplitModal,
  executeSplit,
  handleEpicContextMenu,
  handleStoryContextMenu,
  rmCtxOpenEpic,
  rmCtxMoveEpic,
  rmCtxMoveStory,
  rmCtxSetSprint,
  // roadmap-select.js
  handleRoadmapCardClick,
  handleRoadmapEpicClick,
  clearRoadmapSelection,
  // skills.js
  loadSkillsView,
  toggleSkillCard,
  saveSkill,
  resetSkill,
  improveSkill,
  saveProductContext,
  resetProductContext,
  // main.js local functions
  toggleLeftPanel,
  toggleModelSection,
  refreshProviders,
  updateModelSetting,
  onProviderChange,
  isSplitMode,
  updateSplitMode,
  highlightSelectedItem,
  loadAppConfig,
  loadMetadata,
  loadModelSetting,
  openSettingsView,
  closeSettingsView,
  navigateTo,
  openFab,
  closeFab,
  toggleFab,
  switchFabTab,
  // bugs-dashboard.js
  loadBugsDashboard,
  refreshBugsDashboard,
  filterBugsTable,
  analyzeBugs,
  closeBugsAnalysis,
  bugToggleKey,
  bugToggleAll,
  toggleClosedBugs,
};
Object.assign(window, _globals);
//# sourceMappingURL=main.js.map
