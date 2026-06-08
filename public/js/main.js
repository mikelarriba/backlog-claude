// ── ES Module entry point ────────────────────────────────────────
import { store, fetchJSON, putJSON, debounce, toggleSection } from './state.js';
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
} from './detail.js';
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
  syncPreviewSelectAll,
  syncPreviewCancel,
  syncPreviewConfirm,
  pullFromJira,
  pushToJira,
  checkAllJira,
  toggleJiraSection,
  searchJira,
  downloadSelected,
  pullByKey,
  submitUpdateFromJiraKey,
  toggleJiraItem,
} from './jira.js';
import {
  openBugModal,
  closeBugModal,
  onBugFilesSelected,
  submitBugReport,
  removeBugFile,
} from './bugcreate.js';
import { _renderFpCanvas, resetCanvasLayout } from './refine-canvas.js';
import {
  _showEdgePopup,
  _deleteCanvasLink,
  _changeCanvasLinkType,
  _restoreManageLinksState,
  toggleManageLinks,
  _closeLinkPopup,
  _showLinkPopup,
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
} from './export.js';
import {
  togglePiConfigSection,
  addSprintRow,
  removeSprintRow,
  selectPiConfigTab,
  saveSprintConfig,
  saveSplitThreshold,
  loadAllSprintConfigs,
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
  pushSprintsToJira,
  closeSprintPushModal,
  toggleSprintPushFilter,
  sprintPushSelectAll,
  sprintPushToggleAllSprints,
  startSprintPushPreview,
  confirmSprintPush,
  _sprintPushUpdateCount,
  addDepLink,
  addParallelLink,
  removeDepLink,
  closeDepModal,
  closeSplitModal,
  executeSplit,
  handleEpicContextMenu,
  handleStoryContextMenu,
  rmCtxOpenEpic,
  rmCtxMoveEpic,
  rmCtxMoveStory,
  rmCtxSetSprint,
} from './roadmap.js';
import {
  handleRoadmapCardClick,
  handleRoadmapEpicClick,
  clearRoadmapSelection,
} from './roadmap-select.js';
import { initDragDrop } from './dragdrop.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Split-panel mode ───────────────────────────────────────────
const SPLIT_MIN_WIDTH = 1280;

export function isSplitMode() {
  return document.querySelector('.right').classList.contains('split-mode');
}

function updateSplitMode() {
  const wide = window.innerWidth >= SPLIT_MIN_WIDTH;
  const right = document.querySelector('.right');
  const wasOn = right.classList.contains('split-mode');

  if (wide === wasOn) return;

  right.classList.toggle('split-mode', wide);

  if (!wide && currentFilename) {
    document.getElementById('list-view').style.display = 'none';
  } else if (wide && currentFilename) {
    document.getElementById('list-view').style.display = '';
    highlightSelectedItem(currentFilename, currentDocType);
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

// ── Left panel collapse toggle ────────────────────────────────
function toggleLeftPanel() {
  const app = document.getElementById('app-root');
  const btn = document.getElementById('left-toggle-btn');
  const collapsed = app.classList.toggle('left-collapsed');
  btn.textContent = collapsed ? '»' : '«';
  try {
    localStorage.setItem('leftPanelCollapsed', collapsed ? '1' : '0');
  } catch {
    /* no-op */
  }
}

(function _restoreLeftPanel() {
  try {
    if (localStorage.getItem('leftPanelCollapsed') === '1') {
      const app = document.getElementById('app-root');
      const btn = document.getElementById('left-toggle-btn');
      if (app) {
        app.classList.add('left-collapsed');
        if (btn) btn.textContent = '»';
      }
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
});

// ── Model / Provider settings ─────────────────────────────────
function toggleModelSection() {
  toggleSection('model-section-body', 'model-chevron');
}

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
    const { teams, workCategories } = await fetchJSON('/api/config/metadata');
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

let _availableProviders = [];

async function loadModelSetting() {
  try {
    const [{ providers }, { model, provider }] = await Promise.all([
      fetchJSON('/api/settings/providers'),
      fetchJSON('/api/settings/model'),
    ]);
    _availableProviders = providers || [];
    _renderProviderDropdown(provider || 'claude-cli');
    _renderModelDropdown(provider || 'claude-cli', model || '');
  } catch (e) {
    console.warn('Failed to load model setting:', e.message);
  }
}

function _renderProviderDropdown(selectedProvider) {
  const sel = document.getElementById('provider-select');
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of _availableProviders) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === selectedProvider) opt.selected = true;
    sel.appendChild(opt);
  }
}

function _renderModelDropdown(providerId, selectedModel) {
  const sel = document.getElementById('model-select');
  if (!sel) return;
  const provider = _availableProviders.find((p) => p.id === providerId);
  sel.innerHTML = '';
  if (!provider) return;
  for (const m of provider.models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === selectedModel) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function onProviderChange(providerId) {
  _renderModelDropdown(providerId, '');
  await _saveModelSetting(providerId, '');
}

async function refreshProviders() {
  const btn = document.getElementById('provider-refresh-btn');
  if (btn) btn.disabled = true;
  try {
    const { providers } = await fetchJSON('/api/settings/providers');
    _availableProviders = providers || [];
    const providerSel = document.getElementById('provider-select');
    const currentProvider = providerSel ? providerSel.value : 'claude-cli';
    const modelSel = document.getElementById('model-select');
    const currentModel = modelSel ? modelSel.value : '';
    _renderProviderDropdown(currentProvider);
    _renderModelDropdown(currentProvider, currentModel);
  } catch (e) {
    console.warn('Failed to refresh providers:', e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function updateModelSetting(model) {
  const providerSel = document.getElementById('provider-select');
  const providerId = providerSel ? providerSel.value : 'claude-cli';
  await _saveModelSetting(providerId, model);
}

async function _saveModelSetting(provider, model) {
  const statusEl = document.getElementById('model-status');
  try {
    await putJSON('/api/settings/model', { provider: provider || null, model: model || null });
    statusEl.className = 'model-status show success';
    const pName = (_availableProviders.find((p) => p.id === provider) || {}).name || provider;
    statusEl.textContent = model ? `Using ${pName} / ${model}` : `Using ${pName} default`;
    setTimeout(() => {
      statusEl.className = 'model-status';
    }, 3000);
  } catch {
    statusEl.className = 'model-status show error';
    statusEl.textContent = 'Failed to save';
  }
}

// ── Store subscriptions ───────────────────────────────────────
store.subscribe('allDocs', applyFilters);

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

const _loadDocsDebounced = debounce(loadDocs, 100);

const evtSource = new EventSource('/api/events');
evtSource.onmessage = (e) => {
  try {
    const payload = JSON.parse(e.data);
    if (
      [
        'feature_created',
        'epic_created',
        'story_created',
        'spike_created',
        'bug_created',
        'status_updated',
        'title_updated',
        'doc_deleted',
        'batch_deleted',
        'batch_fix_version_updated',
        'batch_field_updated',
        'link_updated',
      ].includes(payload.type)
    ) {
      _loadDocsDebounced();
    }
    if (payload.type === 'pi_settings_updated') {
      piSettings = { currentPi: payload.currentPi, nextPi: payload.nextPi };
      loadAllSprintConfigs().then(() => {
        _loadDocsDebounced();
        refreshRoadmapView();
      });
    }
    if (payload.type === 'sprint_settings_updated') {
      loadAllSprintConfigs().then(() => {
        _loadDocsDebounced();
        refreshRoadmapView();
      });
    }
    if (payload.type === 'batch_sprint_updated') {
      _loadDocsDebounced();
      refreshRoadmapView();
    }
    if (payload.type === 'split_threshold_updated') {
      splitThreshold = payload.splitThreshold;
      const el = document.getElementById('split-threshold-input');
      if (el) el.value = splitThreshold;
      refreshRoadmapView();
    }
  } catch (e) {
    console.warn('SSE handler error:', e.message);
  }
};

document.getElementById('delete-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDeleteDialog();
});

document.getElementById('split-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSplitModal();
});

// ── Expose functions for HTML onclick attributes ──────────────
// list-filters.js
window.toggleItemCollapse = toggleItemCollapse;
window.collapseAll = collapseAll;
window.expandAll = expandAll;
window.toggleSwimlane = toggleSwimlane;
window.updatePiVersion = updatePiVersion;
window.setTypeFilter = setTypeFilter;
window.setStatusFilter = setStatusFilter;
window.setTeamFilter = setTeamFilter;
window.setWorkCatFilter = setWorkCatFilter;
window.handleItemClick = handleItemClick;
window.handleItemContextMenu = handleItemContextMenu;
window.showContextMenu = showContextMenu;
window.closeContextMenu = closeContextMenu;
window.contextMoveToPI = contextMoveToPI;
window.contextDeleteSelected = contextDeleteSelected;
window.contextAssignField = contextAssignField;
window.closeBulkAssignDialog = closeBulkAssignDialog;

// list.js
window.contextSplitItem = contextSplitItem;
window.closeIssueSplitModal = closeIssueSplitModal;
window.executeSplitIssue = executeSplitIssue;

// detail.js
window.saveStoryPoints = saveStoryPoints;
window.saveTitle = saveTitle;
window.cancelTitleEdit = cancelTitleEdit;
window.updateDocSprint = updateDocSprint;
window.updateDocStatus = updateDocStatus;
window.updateDocTeam = updateDocTeam;
window.updateDocWorkCategory = updateDocWorkCategory;
window.showList = showList;
window.confirmDelete = confirmDelete;
window.closeDeleteDialog = closeDeleteDialog;
window.executeDelete = executeDelete;
window.toggleDropdown = toggleDropdown;
window.closeDropdown = closeDropdown;
window.closeAllDropdowns = closeAllDropdowns;
window.toggleHierarchy = toggleHierarchy;
window.toggleOriginal = toggleOriginal;
window.openDoc = openDoc;
window.loadHierarchy = loadHierarchy;
window.addDocComment = addDocComment;
window.startCommentEdit = startCommentEdit;
window.cancelCommentEdit = cancelCommentEdit;
window.saveCommentEdit = saveCommentEdit;
window.deleteDocComment = deleteDocComment;
window.linkExistingChildren = linkExistingChildren;
window.toggleHierarchyChild = toggleHierarchyChild;

// upgrade.js
window.toggleUpgradePanel = toggleUpgradePanel;
window.executeUpgrade = executeUpgrade;

// quickcreate.js
window.saveDraft = saveDraft;
window.generateDoc = generateDoc;
window.clearForm = clearForm;
window.toggleQuickCreate = toggleQuickCreate;
window.closeQuickCreate = closeQuickCreate;
window.executeQuickCreate = executeQuickCreate;

// stories.js
window.generateStories = generateStories;

// jira.js
window.jiraSelectAll = jiraSelectAll;
window.jiraSelectCancel = jiraSelectCancel;
window.jiraSelectConfirm = jiraSelectConfirm;
window.syncPreviewSelectAll = syncPreviewSelectAll;
window.syncPreviewCancel = syncPreviewCancel;
window.syncPreviewConfirm = syncPreviewConfirm;
window.checkAllJira = checkAllJira;
window.toggleJiraSection = toggleJiraSection;
window.searchJira = searchJira;
window.downloadSelected = downloadSelected;
window.pullByKey = pullByKey;
window.pullFromJira = pullFromJira;
window.pushToJira = pushToJira;
window.submitUpdateFromJiraKey = submitUpdateFromJiraKey;
window.toggleJiraItem = toggleJiraItem;

// bugcreate.js
window.openBugModal = openBugModal;
window.closeBugModal = closeBugModal;
window.submitBugReport = submitBugReport;
window.onBugFilesSelected = onBugFilesSelected;
window.removeBugFile = removeBugFile;

// refine-canvas.js
window.resetCanvasLayout = resetCanvasLayout;

// refine-edges.js
window.toggleManageLinks = toggleManageLinks;
window._closeLinkPopup = _closeLinkPopup;
window._createCanvasLink = _createCanvasLink;
window._showEdgePopup = _showEdgePopup;
window._deleteCanvasLink = _deleteCanvasLink;
window._changeCanvasLinkType = _changeCanvasLinkType;

// refine-nodes.js
window._fpCreateChild = _fpCreateChild;
window._executeCanvasSplit = _executeCanvasSplit;
window._openCellCreateForm = _openCellCreateForm;
window._executeEmptyCellCreate = _executeEmptyCellCreate;
window._moveCardsToEdge = _moveCardsToEdge;
window._openCanvasSplit = _openCanvasSplit;
window._moveCardToEdge = _moveCardToEdge;
window._showCardContextMenu = _showCardContextMenu;
window._showFpCardContextMenu = _showFpCardContextMenu;
window._showEpicContextMenu = _showEpicContextMenu;
window._showEmptyCellMenu = _showEmptyCellMenu;
window._showMultiCardContextMenu = _showMultiCardContextMenu;
window._fpMoveToEpic = _fpMoveToEpic;

// refine.js
window.onCanvasSearch = onCanvasSearch;
window.openManualRefine = openManualRefine;
window.closeRefineView = closeRefineView;
window.renderFeatureMultiPanel = renderFeatureMultiPanel;
window._toggleEpicPanel = _toggleEpicPanel;
window.closeRefinePanel = closeRefinePanel;
window.openRefinePanel = openRefinePanel;
window._removeCanvasLink = _removeCanvasLink;
window.saveRpTitle = saveRpTitle;
window.cancelRpTitleEdit = cancelRpTitleEdit;
window.saveRpStoryPoints = saveRpStoryPoints;
window.saveRpPriority = saveRpPriority;
window.toggleRpUpgrade = toggleRpUpgrade;
window.executeRpUpgrade = executeRpUpgrade;
window.confirmRpDelete = confirmRpDelete;
window.openCreatePanel = openCreatePanel;
window.executeRpCreate = executeRpCreate;

// export.js
window.exportEpicToPdf = exportEpicToPdf;
window.openRoadmapExportDialog = openRoadmapExportDialog;
window.closeRoadmapExportDialog = closeRoadmapExportDialog;
window.executeRoadmapExport = executeRoadmapExport;

// piconfig.js
window.togglePiConfigSection = togglePiConfigSection;
window.addSprintRow = addSprintRow;
window.removeSprintRow = removeSprintRow;
window.selectPiConfigTab = selectPiConfigTab;
window.saveSprintConfig = saveSprintConfig;
window.saveSplitThreshold = saveSplitThreshold;

// distribution.js
window.openDistributionModal = openDistributionModal;
window.closeDistributionModal = closeDistributionModal;
window.applyDistribution = applyDistribution;

// roadmap.js
window.openRoadmapView = openRoadmapView;
window.closeRoadmapView = closeRoadmapView;
window.refreshRoadmapView = refreshRoadmapView;
window.toggleRoadmapPi = toggleRoadmapPi;
window.toggleRoadmapPanel = toggleRoadmapPanel;
window.filterRoadmapEpics = filterRoadmapEpics;
window.focusEpic = focusEpic;
window.pushSprintsToJira = pushSprintsToJira;
window.closeSprintPushModal = closeSprintPushModal;
window.toggleSprintPushFilter = toggleSprintPushFilter;
window.sprintPushSelectAll = sprintPushSelectAll;
window.sprintPushToggleAllSprints = sprintPushToggleAllSprints;
window.startSprintPushPreview = startSprintPushPreview;
window.confirmSprintPush = confirmSprintPush;
window._sprintPushUpdateCount = _sprintPushUpdateCount;
window.closeDepModal = closeDepModal;
window.addDepLink = addDepLink;
window.addParallelLink = addParallelLink;
window.removeDepLink = removeDepLink;
window.closeSplitModal = closeSplitModal;
window.executeSplit = executeSplit;
window.handleEpicContextMenu = handleEpicContextMenu;
window.handleStoryContextMenu = handleStoryContextMenu;
window.rmCtxOpenEpic = rmCtxOpenEpic;
window.rmCtxMoveEpic = rmCtxMoveEpic;
window.rmCtxMoveStory = rmCtxMoveStory;
window.rmCtxSetSprint = rmCtxSetSprint;

// roadmap-select.js
window.handleRoadmapCardClick = handleRoadmapCardClick;
window.handleRoadmapEpicClick = handleRoadmapEpicClick;
window.clearRoadmapSelection = clearRoadmapSelection;

// main.js local functions
window.toggleLeftPanel = toggleLeftPanel;
window.toggleModelSection = toggleModelSection;
window.refreshProviders = refreshProviders;
window.updateModelSetting = updateModelSetting;
window.onProviderChange = onProviderChange;
window.isSplitMode = isSplitMode;
window.updateSplitMode = updateSplitMode;
window.highlightSelectedItem = highlightSelectedItem;
window.loadAppConfig = loadAppConfig;
window.loadMetadata = loadMetadata;
window.loadModelSetting = loadModelSetting;
