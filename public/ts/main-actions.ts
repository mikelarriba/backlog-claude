// ── Core app-shell click actions (registered at module load) ─────
import { closeIssueSplitModal, executeSplitIssue } from './list.js';
import { registerActions } from './actions.js';
import { canvasContext } from './state.js';
import {
  collapseAll,
  expandAll,
  setTypeFilter,
  setStatusFilter,
  setTeamFilter,
  setWorkCatFilter,
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
import { openManualRefine, closeRefineView } from './refine.js';
import {
  exportEpicToPdf,
  openRoadmapExportDialog,
  closeRoadmapExportDialog,
  executeRoadmapExport,
  rexpToggleAllSprints,
  rexpToggleAllTeams,
} from './export.js';
import { addSprintRow, saveSprintConfig, getPiConfigActivePi } from './piconfig.js';
import {
  openDistributionModal,
  closeDistributionModal,
  applyDistribution,
} from './distribution.js';
import {
  closeRoadmapView,
  toggleRoadmapPanel,
  addDepLink,
  addParallelLink,
  closeDepModal,
  closeSplitModal,
  executeSplit,
  getRoadmapVisiblePis,
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
import {
  toggleAiSavingsSection,
  filterAiSavings,
  exportAiSavingsPdf,
  exportAiSavingsPptx,
} from './ai-savings.js';
import type { ViewName } from './view-router.js';
import {
  toggleLeftPanel,
  navigateTo,
  closeSettingsView,
  openFab,
  closeFab,
  toggleFab,
  switchFabTab,
} from './view-router.js';

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
    resetCanvasLayout(canvasContext.epicFilename ?? '');
  },
  [MAIN_ACTIONS.exportEpicToPdfCanvas]: () => {
    exportEpicToPdf(canvasContext.epicFilename ?? '', canvasContext.docType ?? '');
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
    openDistributionModal(getPiConfigActivePi() ?? '');
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
    openDistributionModal(getRoadmapVisiblePis()[0] ?? '');
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
