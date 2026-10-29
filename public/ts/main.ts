// ── ES Module entry point ────────────────────────────────────────
import { debounce } from './state.js';
import type { DocEntry } from './state.js';
import { on } from './store.js';
import { isSplitMode, highlightSelectedItem, updateSplitMode } from './split-mode.js';
import { loadDocs, loadPiSettings, loadJiraVersions } from './list.js';
import {
  registerActions,
  dispatchAction,
  dispatchChangeAction,
  dispatchInputAction,
  dispatchContextAction,
  dispatchKeydownAction,
  dispatchBlurAction,
} from './actions.js';
import { applyFilters, patchSingleDoc } from './list-filters.js';
import { showList } from './detail.js';
import { loadAllSprintConfigs } from './piconfig.js';
import { refreshRoadmapView } from './roadmap.js';
import { initDragDrop } from './dragdrop.js';
import { loadModelSetting } from './provider-settings.js';
import { _connectSSE } from './sse-client.js';
import { loadSidebarSavings } from './ai-savings.js';
import { loadAppConfig, loadMetadata } from './app-metadata.js';
import { toggleLeftPanel, closeFab } from './view-router.js';
import './main-actions.js';
export { MAIN_ACTIONS } from './main-actions.js';
// Side-effect import: roadmap-context-menus.ts registers the roadmap epic/story
// context-menu openers and action handlers at module load via
// registerContextActions()/registerActions(). Nothing consumes its exports, so
// without this import the module never loads and right-clicking a roadmap epic
// falls through to the browser's native menu (the #461 contextmenu-registry
// migration removed the old oncontextmenu bridge but left the module orphaned).
import './roadmap-context-menus.js';

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
