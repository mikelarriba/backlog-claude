// ── ES Module entry point ────────────────────────────────────────
import { fetchJSON, putJSON, debounce, toggleSection, store } from './state.js';
import type { DocEntry } from './state.js';
import { on, upsertDoc, removeDoc, setPiSettings } from './store.js';
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
  pullFromJiraSprints,
  closePullSprintModal,
  pullSprintToggleAll,
  startPullSprintPreview,
  pullSprintSelectAllItems,
  _pullSprintUpdateCount,
  confirmPullSprint,
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

  const _cf = store.get('currentFilename') as string | null;
  const _cdt = store.get('currentDocType') as string | null;
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
      break;
    case 'documentation':
      document.getElementById('documentation-view')?.classList.add('show');
      break;
    case 'bugs':
      document.getElementById('bugs-view')?.classList.add('show');
      break;
    case 'suggestions':
      document.getElementById('suggestions-view')?.classList.add('show');
      break;
  }
}

// ── Settings view ─────────────────────────────────────────────
function openSettingsView(): void {
  navigateTo('settings');
}

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
}

function toggleFab(): void {
  const panel = document.getElementById('fab-panel');
  if (panel?.classList.contains('open')) {
    closeFab();
  } else {
    openFab();
  }
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

// ── Model / Provider settings ─────────────────────────────────
function toggleModelSection(): void {
  toggleSection('model-section-body', 'model-chevron');
}

async function loadAppConfig(): Promise<void> {
  try {
    const cfg = (await fetchJSON('/api/config')) as { jiraBase?: string };
    if (cfg.jiraBase) store.set('jiraBase', cfg.jiraBase);
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
    btn.textContent = t;
    btn.setAttribute('onclick', `setTeamFilter('${t}')`);
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
    btn.textContent = WORKCAT_SHORT_LABELS[c] || c;
    btn.setAttribute('onclick', `setWorkCatFilter('${c}')`);
    container.appendChild(btn);
  }
}

interface ProviderModel {
  id: string;
  name: string;
}

interface Provider {
  id: string;
  name: string;
  models: ProviderModel[];
}

let _availableProviders: Provider[] = [];

async function loadModelSetting(): Promise<void> {
  try {
    const [providersData, modelData] = await Promise.all([
      fetchJSON('/api/settings/providers') as Promise<{ providers: Provider[] }>,
      fetchJSON('/api/settings/model') as Promise<{ model: string; provider: string }>,
    ]);
    _availableProviders = (providersData as { providers: Provider[] }).providers || [];
    const { model, provider } = modelData as { model: string; provider: string };
    _renderProviderDropdown(provider || 'claude-cli');
    _renderModelDropdown(provider || 'claude-cli', model || '');
  } catch (e) {
    console.warn('Failed to load model setting:', (e as Error).message);
  }
}

function _renderProviderDropdown(selectedProvider: string): void {
  const sel = document.getElementById('provider-select') as HTMLSelectElement | null;
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

function _renderModelDropdown(providerId: string, selectedModel: string): void {
  const sel = document.getElementById('model-select') as HTMLSelectElement | null;
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

async function onProviderChange(providerId: string): Promise<void> {
  _renderModelDropdown(providerId, '');
  await _saveModelSetting(providerId, '');
}

async function refreshProviders(): Promise<void> {
  const btn = document.getElementById('provider-refresh-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    const data = (await fetchJSON('/api/settings/providers')) as { providers: Provider[] };
    _availableProviders = data.providers || [];
    const providerSel = document.getElementById('provider-select') as HTMLSelectElement | null;
    const currentProvider = providerSel ? providerSel.value : 'claude-cli';
    const modelSel = document.getElementById('model-select') as HTMLSelectElement | null;
    const currentModel = modelSel ? modelSel.value : '';
    _renderProviderDropdown(currentProvider);
    _renderModelDropdown(currentProvider, currentModel);
  } catch (e) {
    console.warn('Failed to refresh providers:', (e as Error).message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function updateModelSetting(model: string): Promise<void> {
  const providerSel = document.getElementById('provider-select') as HTMLSelectElement | null;
  const providerId = providerSel ? providerSel.value : 'claude-cli';
  await _saveModelSetting(providerId, model);
}

async function _saveModelSetting(provider: string, model: string): Promise<void> {
  const statusEl = document.getElementById('model-status');
  try {
    await putJSON('/api/settings/model', { provider: provider || null, model: model || null });
    if (statusEl) {
      statusEl.className = 'model-status show success';
      const pName = (_availableProviders.find((p) => p.id === provider) || { name: provider }).name;
      statusEl.textContent = model ? `Using ${pName} / ${model}` : `Using ${pName} default`;
      setTimeout(() => {
        statusEl.className = 'model-status';
      }, 3000);
    }
  } catch {
    if (statusEl) {
      statusEl.className = 'model-status show error';
      statusEl.textContent = 'Failed to save';
    }
  }
}

// ── SSE payload type ──────────────────────────────────────────
interface SSEPayload {
  type?: string;
  doc?: DocEntry;
  filename?: string;
  currentPi?: string | null;
  nextPi?: string | null;
  splitThreshold?: number;
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

const _loadDocsDebounced = debounce(loadDocs, 100);

// ── SSE with exponential backoff reconnection ─────────────────
let _sseRetryDelay = 1_000;
const SSE_MAX_DELAY = 30_000;

function _handleSSEMessage(payload: SSEPayload): void {
  // Granular in-memory update when server includes the full DocEntry.
  // Avoids a round-trip GET /api/docs for single-document operations.
  // upsertDoc / removeDoc emit domain events that trigger subscribers.
  if (payload.doc) {
    upsertDoc(payload.doc);
    return;
  }

  if (payload.type === 'doc_deleted' && payload.filename) {
    removeDoc(payload.filename);
    return;
  }

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
    ].includes(payload.type ?? '')
  ) {
    _loadDocsDebounced();
  }
  if (payload.type === 'pi_settings_updated') {
    setPiSettings({ currentPi: payload.currentPi ?? null, nextPi: payload.nextPi ?? null });
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
    splitThreshold = payload.splitThreshold ?? splitThreshold;
    const el = document.getElementById('split-threshold-input') as HTMLInputElement | null;
    if (el) el.value = String(splitThreshold);
    refreshRoadmapView();
  }
}

function _connectSSE(): void {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    _sseRetryDelay = 1_000;
  };
  es.onmessage = (e: MessageEvent) => {
    try {
      _handleSSEMessage(JSON.parse(e.data as string) as SSEPayload);
    } catch (err) {
      console.warn('SSE handler error:', (err as Error).message);
    }
  };
  es.onerror = () => {
    es.close();
    const jitter = Math.random() * 500;
    setTimeout(_connectSSE, Math.min(_sseRetryDelay + jitter, SSE_MAX_DELAY));
    _sseRetryDelay = Math.min(_sseRetryDelay * 2, SSE_MAX_DELAY);
  };
}

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

document.addEventListener('click', (e: MouseEvent) => {
  const fabContainer = document.getElementById('fab-container');
  if (fabContainer && !fabContainer.contains(e.target as Node)) {
    closeFab();
  }
});

// ── Expose functions for HTML onclick attributes ──────────────
// Using Object.assign to attach all handler functions to window without
// requiring verbose Window interface augmentation.
const _globals: Record<string, unknown> = {
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
  toggleJiraSection,
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
};

Object.assign(window, _globals);
