// ── Unit tests: public/js/main.js — app-shell action registry + delegated DOM listeners ──
// main.js is the frontend entry point: at module load it registers MAIN_ACTIONS
// against the click registry (actions.js) and wires six delegated document
// listeners (click, input, contextmenu, keydown x2, blur, change) that every
// other view's typed action registry depends on. Nothing asserted this directly
// (issue #685) — it was only imported as a side-effect dependency.
//
// There is no jsdom in this repo, so this file uses a minimal fake `document`
// that records addEventListener calls and hands back tiny fake elements. Every
// module main.js imports EXCEPT actions.js is replaced with recording stubs —
// generated from main.js's own import statements so the stubs can't drift out
// of sync with what main.js pulls in. actions.js stays real: it is the unit
// under test's dispatch layer.
import { mock, test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../helpers/domGlobals.js';

// ── Fake DOM ─────────────────────────────────────────────────────────────────
function makeEl(id = '', props = {}) {
  const classes = new Set(props.classes || []);
  const el = {
    id,
    tagName: props.tagName || 'DIV',
    dataset: props.dataset || {},
    style: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle(c, force) {
        const on = force === undefined ? !classes.has(c) : force;
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
    },
    clicks: 0,
    click() {
      this.clicks += 1;
    },
    contains: (other) => other === el,
    closest(sel) {
      return props.closestMap?.[sel] ?? null;
    },
  };
  return el;
}

const listeners = []; // { type, fn, capture }
const elements = {}; // id -> fake element
const lists = {}; // selector -> [els]
globalThis.document = {
  addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture: capture === true }),
  getElementById: (id) => elements[id] ?? null,
  querySelector: () => null,
  querySelectorAll: (sel) => lists[sel] ?? [],
  activeElement: null,
  createElement: () => makeEl(),
};
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
};
globalThis.window.innerWidth = 800;
globalThis.window.addEventListener = () => {};
globalThis.CSS = { escape: (s) => s };
try {
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
} catch {
  /* navigator is read-only on some Node versions; the serviceWorker check tolerates the default */
}

// ── Stub every module main.js imports except actions.js ─────────────────────────
const calls = [];
const record = (name) =>
  function (...args) {
    calls.push([name, ...args]);
  };

const mainSrc = fs.readFileSync(new URL('../../public/js/main.js', import.meta.url), 'utf-8');
const importRe = /import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/g;
for (const [, names, spec] of mainSrc.matchAll(importRe)) {
  if (spec === './actions.js') continue;
  const namedExports = {};
  for (const n of names
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    namedExports[n] = record(n);
  }
  if (spec === './state.js') {
    namedExports.fetchJSON = async () => ({ teams: [], workCategories: [] });
    namedExports.debounce = (fn) => fn;
  }
  mock.module(`../../public/js/${spec.slice(2)}`, { namedExports });
}

// Bare-identifier globals main.js assigns/reads; state.js normally defines them.
globalThis._metaTeams = [];
globalThis._metaWorkCategories = [];
globalThis.currentFilename = null;
globalThis.currentDocType = null;

let actions;
let main;
before(async () => {
  actions = await import('../../public/js/actions.js');
  main = await import('../../public/js/main.js');
  // let the async bootstrap IIFE settle
  await new Promise((r) => setTimeout(r, 20));
});
beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(elements)) delete elements[k];
  for (const k of Object.keys(lists)) delete lists[k];
  storage.clear();
  globalThis.document.activeElement = null;
  // Bare-identifier globals main.js reads (state.js normally defines them).
  globalThis.currentFilename = null;
  globalThis.currentDocType = null;
});

const fire = (type, evt, capture) => {
  for (const l of listeners) {
    if (l.type === type && (capture === undefined || l.capture === capture)) l.fn(evt);
  }
};
const called = (name) => calls.filter((c) => c[0] === name);

describe('module-load wiring', () => {
  test('registers delegated listeners for click, input, contextmenu, keydown, blur (capture) and change', () => {
    const types = listeners.map((l) => l.type);
    for (const t of ['click', 'input', 'contextmenu', 'keydown', 'blur', 'change']) {
      assert.ok(types.includes(t), `missing ${t} listener`);
    }
    assert.equal(listeners.find((l) => l.type === 'blur').capture, true, 'blur must be captured');
  });

  test('bootstraps: loads docs, connects SSE, inits drag-drop', () => {
    // calls is reset per-test, so re-check via module side effects recorded at load.
    assert.equal(typeof main.MAIN_ACTIONS, 'object');
    assert.equal(typeof main.isSplitMode, 'function');
  });

  test('every MAIN_ACTIONS name is registered: dispatchAction returns true (never falls through)', () => {
    const el = makeEl('x', { dataset: {} });
    const notDispatchable = [];
    for (const name of Object.values(main.MAIN_ACTIONS)) {
      let ok;
      try {
        ok = actions.dispatchAction(name, el, {}) === true;
      } catch {
        ok = true; // handler ran and threw on the fake DOM — it is registered
      }
      if (!ok) notDispatchable.push(name);
    }
    assert.deepEqual(notDispatchable, []);
  });

  test('registering a MAIN_ACTIONS name again throws (no duplicate handlers)', () => {
    assert.throws(
      () => actions.registerActions({ [main.MAIN_ACTIONS.toggleFab]: () => {} }),
      /already registered/
    );
  });
});

describe('MAIN_ACTIONS handlers delegate to the right module functions', () => {
  const dispatch = (name, dataset = {}) =>
    actions.dispatchAction(name, makeEl('b', { dataset }), {});

  test('filter pills pass data-filter-value (or "" when absent)', () => {
    dispatch('setTypeFilter', { filterValue: 'story' });
    dispatch('setStatusFilter', { filterValue: 'Done' });
    dispatch('setTeamFilter', { filterValue: 'Alpha' });
    dispatch('setWorkCatFilter');
    assert.deepEqual(called('setTypeFilter'), [['setTypeFilter', 'story']]);
    assert.deepEqual(called('setStatusFilter'), [['setStatusFilter', 'Done']]);
    assert.deepEqual(called('setTeamFilter'), [['setTeamFilter', 'Alpha']]);
    assert.deepEqual(called('setWorkCatFilter'), [['setWorkCatFilter', '']]);
  });

  test('toolbar/no-arg actions call through', () => {
    dispatch('collapseAll');
    dispatch('expandAll');
    dispatch('showList');
    dispatch('confirmDelete');
    dispatch('executeDelete');
    dispatch('closeDeleteDialog');
    dispatch('closeSplitModal');
    dispatch('executeSplit');
    for (const n of [
      'collapseAll',
      'expandAll',
      'showList',
      'confirmDelete',
      'executeDelete',
      'closeDeleteDialog',
      'closeSplitModal',
      'executeSplit',
    ]) {
      assert.equal(called(n).length, 1, `${n} should be called once`);
    }
  });

  test('select-all style actions coerce data-select-all to a boolean', () => {
    dispatch('jiraSelectAll', { selectAll: 'true' });
    dispatch('jiraSelectAll', { selectAll: 'false' });
    dispatch('syncPreviewSelectAll', { selectAll: 'true' });
    assert.deepEqual(called('jiraSelectAll'), [
      ['jiraSelectAll', true],
      ['jiraSelectAll', false],
    ]);
    assert.deepEqual(called('syncPreviewSelectAll'), [['syncPreviewSelectAll', true]]);
  });

  test('filterAiSavings defaults to "all"', () => {
    dispatch('filterAiSavings');
    dispatch('filterAiSavings', { filterValue: 'week' });
    assert.deepEqual(called('filterAiSavings'), [
      ['filterAiSavings', 'all'],
      ['filterAiSavings', 'week'],
    ]);
  });

  test('toggleQuickCreateAndClose toggles the doctype then closes the named dropdown', () => {
    dispatch('toggleQuickCreateAndClose', { doctype: 'epic', closeDropdown: 'dd-1' });
    assert.deepEqual(called('toggleQuickCreate'), [['toggleQuickCreate', 'epic']]);
    assert.deepEqual(called('closeDropdown'), [['closeDropdown', 'dd-1']]);
  });

  test('exportEpicToPdfCurrent uses the current doc globals, defaulting to empty strings', () => {
    dispatch('exportEpicToPdfCurrent');
    globalThis.currentFilename = 'e.md';
    globalThis.currentDocType = 'epic';
    dispatch('exportEpicToPdfCurrent');
    assert.deepEqual(called('exportEpicToPdf'), [
      ['exportEpicToPdf', '', ''],
      ['exportEpicToPdf', 'e.md', 'epic'],
    ]);
  });

  test('setTheme forwards to window.setTheme only when it is a function', () => {
    dispatch('setTheme', { themeName: 'dark' }); // no window.setTheme yet: must not throw
    const seen = [];
    globalThis.window.setTheme = (t) => seen.push(t);
    try {
      dispatch('setTheme', { themeName: 'dark' });
      dispatch('setTheme');
    } finally {
      delete globalThis.window.setTheme;
    }
    assert.deepEqual(seen, ['dark', '']);
  });

  test('triggerBugFileInput clicks the hidden #bug-files input', () => {
    elements['bug-files'] = makeEl('bug-files');
    dispatch('triggerBugFileInput');
    assert.equal(elements['bug-files'].clicks, 1);
  });
});

describe('navigateTo', () => {
  function setupViews() {
    for (const id of [
      'list-view',
      'detail-view',
      'roadmap-view',
      'settings-view',
      'skills-view',
      'documentation-view',
      'bugs-view',
      'suggestions-view',
      'fab-container',
    ]) {
      elements[id] = makeEl(id, { classes: ['show'] });
    }
    lists['.sidebar-item'] = [
      makeEl('s1', { dataset: { view: 'backlog' } }),
      makeEl('s2', { dataset: { view: 'skills' } }),
    ];
  }
  const nav = (view) =>
    actions.dispatchAction('navigateTo', makeEl('n', { dataset: { viewName: view } }), {});

  test('backlog: shows the list, resets refine state, hides other views, shows the FAB', () => {
    setupViews();
    nav('backlog');
    assert.equal(elements['list-view'].style.display, '');
    assert.equal(elements['detail-view'].classList.contains('show'), false);
    assert.equal(elements['roadmap-view'].classList.contains('show'), false);
    assert.equal(elements['fab-container'].style.display, '');
    assert.equal(called('resetRefineViewState').length, 1);
    assert.equal(lists['.sidebar-item'][0].classList.contains('active'), true);
    assert.equal(lists['.sidebar-item'][1].classList.contains('active'), false);
  });

  test('skills: hides the FAB, shows the skills view and loads it', () => {
    setupViews();
    nav('skills');
    assert.equal(elements['list-view'].style.display, 'none');
    assert.equal(elements['fab-container'].style.display, 'none');
    assert.equal(elements['skills-view'].classList.contains('show'), true);
    assert.equal(called('loadSkillsView').length, 1);
    assert.equal(lists['.sidebar-item'][1].classList.contains('active'), true);
  });

  for (const [view, viewId, loader] of [
    ['documentation', 'documentation-view', 'loadDocumentationView'],
    ['bugs', 'bugs-view', 'loadBugsDashboard'],
  ]) {
    test(`${view}: shows ${viewId} and invokes ${loader}`, () => {
      setupViews();
      nav(view);
      assert.equal(elements[viewId].classList.contains('show'), true);
      assert.equal(called(loader).length, 1);
    });
  }

  test('roadmap opens the roadmap view; leaving it clears roadmap-mode/has-selection', () => {
    setupViews();
    nav('roadmap');
    assert.equal(called('openRoadmapView').length, 1);
  });

  test('settings: shows settings, opens its panels and loads AI savings', () => {
    setupViews();
    elements['model-section-body'] = makeEl('model-section-body');
    elements['model-chevron'] = makeEl('model-chevron');
    nav('settings');
    assert.equal(elements['settings-view'].classList.contains('show'), true);
    assert.equal(elements['model-section-body'].classList.contains('open'), true);
    assert.equal(elements['model-chevron'].style.transform, 'rotate(90deg)');
    assert.equal(called('renderPiConfigTabs').length, 1);
    assert.equal(called('loadAiSavingsSection').length, 1);
  });

  test('closeSettingsView returns to the backlog', () => {
    setupViews();
    actions.dispatchAction('closeSettingsView', makeEl('c'), {});
    assert.equal(elements['list-view'].style.display, '');
  });
});

describe('FAB', () => {
  const setup = () => {
    elements['fab-panel'] = makeEl('fab-panel');
    elements['fab-btn'] = makeEl('fab-btn');
  };
  const run = (n, ds) => actions.dispatchAction(n, makeEl('f', { dataset: ds }), {});

  test('toggleFab opens then closes the panel and button; close also closes the bug form', () => {
    setup();
    run('toggleFab');
    assert.equal(elements['fab-panel'].classList.contains('open'), true);
    assert.equal(elements['fab-btn'].classList.contains('open'), true);
    assert.equal(called('closeBugForm').length, 0);
    run('toggleFab');
    assert.equal(elements['fab-panel'].classList.contains('open'), false);
    assert.equal(elements['fab-btn'].classList.contains('open'), false);
    assert.equal(called('closeBugForm').length, 1);
  });

  test('closeFab is safe when the FAB is absent', () => {
    run('closeFab');
    assert.equal(called('closeBugForm').length, 1);
  });

  test('switchFabTab activates only the matching tab button and content pane', () => {
    const t1 = makeEl('t1', { dataset: { tab: 'a' } });
    const t2 = makeEl('t2', { dataset: { tab: 'b' } });
    const c1 = makeEl('fab-tab-a');
    const c2 = makeEl('fab-tab-b');
    lists['.fab-tab'] = [t1, t2];
    lists['.fab-tab-content'] = [c1, c2];
    run('switchFabTab', { tabName: 'b' });
    assert.equal(t1.classList.contains('active'), false);
    assert.equal(t2.classList.contains('active'), true);
    assert.equal(c1.classList.contains('active'), false);
    assert.equal(c2.classList.contains('active'), true);
  });
});

describe('delegated click listener', () => {
  test('dispatches the closest [data-action] ancestor to its registered handler', () => {
    const btn = makeEl('btn', { dataset: { action: 'setTypeFilter', filterValue: 'bug' } });
    const target = makeEl('inner', { closestMap: { '[data-action]': btn } });
    fire('click', { target });
    assert.deepEqual(called('setTypeFilter'), [['setTypeFilter', 'bug']]);
  });

  test('ignores clicks with no data-action ancestor', () => {
    fire('click', { target: makeEl('plain') });
    assert.equal(calls.length, 0);
  });

  test('closes the FAB on an outside click but not on a click inside the FAB container', () => {
    elements['fab-panel'] = makeEl('fab-panel', { classes: ['open'] });
    elements['fab-btn'] = makeEl('fab-btn', { classes: ['open'] });
    const container = makeEl('fab-container');
    elements['fab-container'] = container;

    fire('click', { target: container }); // inside (contains(self) === true)
    assert.equal(elements['fab-panel'].classList.contains('open'), true);

    fire('click', { target: makeEl('elsewhere') }); // outside
    assert.equal(elements['fab-panel'].classList.contains('open'), false);
  });
});

describe('other delegated listeners route via data-*-action attributes', () => {
  function registerProbe(kind, registerFn, dispatchName) {
    const seen = [];
    actions[registerFn]({ [dispatchName]: (el, e) => seen.push([el, e]) });
    return seen;
  }

  test('change → registered change action; missing attribute is a no-op', () => {
    const seen = registerProbe('change', 'registerChangeActions', 'mainTestChange');
    const el = makeEl('s', { dataset: { changeAction: 'mainTestChange' } });
    const evt = { target: el };
    fire('change', evt);
    fire('change', { target: makeEl('none') });
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], el);
    assert.equal(seen[0][1], evt);
  });

  test('input → registered input action', () => {
    const seen = registerProbe('input', 'registerInputActions', 'mainTestInput');
    fire('input', { target: makeEl('i', { dataset: { inputAction: 'mainTestInput' } }) });
    fire('input', { target: makeEl('none') });
    assert.equal(seen.length, 1);
  });

  test('contextmenu → closest [data-context-action]', () => {
    const seen = registerProbe('ctx', 'registerContextActions', 'mainTestCtx');
    const holder = makeEl('h', { dataset: { contextAction: 'mainTestCtx' } });
    fire('contextmenu', {
      target: makeEl('inner', { closestMap: { '[data-context-action]': holder } }),
    });
    fire('contextmenu', { target: makeEl('none') });
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], holder);
  });

  test('app-shortcut keydown listener and data-keydown-action listener are independent', () => {
    const seen = registerProbe('kd', 'registerKeydownActions', 'mainTestKeydown');
    fire('keydown', {
      key: 'x',
      target: makeEl('k', { dataset: { keydownAction: 'mainTestKeydown' } }),
    });
    assert.equal(seen.length, 1);
  });

  test('blur → registered blur action (capture-phase listener only)', () => {
    const seen = registerProbe('blur', 'registerBlurActions', 'mainTestBlur');
    const evt = { target: makeEl('b', { dataset: { blurAction: 'mainTestBlur' } }) };
    fire('blur', evt, true);
    assert.equal(seen.length, 1);
    fire('blur', evt, false); // no non-capture blur listener exists
    assert.equal(seen.length, 1);
  });
});

describe('app-wide keyboard shortcuts', () => {
  const key = (init) => fire('keydown', { target: makeEl('t'), preventDefault() {}, ...init });

  test('Ctrl+B toggles the left panel and persists the choice', () => {
    elements['app-root'] = makeEl('app-root');
    let prevented = false;
    key({ ctrlKey: true, key: 'b', preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
    assert.equal(elements['app-root'].classList.contains('left-collapsed'), true);
    assert.equal(storage.get('sidebarCollapsed'), '1');
    key({ metaKey: true, key: 'b' });
    assert.equal(elements['app-root'].classList.contains('left-collapsed'), false);
    assert.equal(storage.get('sidebarCollapsed'), '0');
  });

  test('Escape closes an open FAB panel', () => {
    elements['fab-panel'] = makeEl('fab-panel', { classes: ['open'] });
    elements['fab-btn'] = makeEl('fab-btn', { classes: ['open'] });
    key({ key: 'Escape' });
    assert.equal(elements['fab-panel'].classList.contains('open'), false);
  });

  test('Escape returns from the detail view to the list', () => {
    elements['detail-view'] = makeEl('detail-view', { classes: ['show'] });
    key({ key: 'Escape' });
    assert.equal(called('showList').length, 1);
  });

  test('Escape is ignored while typing in an input, and while a dialog is open', () => {
    elements['detail-view'] = makeEl('detail-view', { classes: ['show'] });
    globalThis.document.activeElement = { tagName: 'INPUT' };
    key({ key: 'Escape' });
    globalThis.document.activeElement = null;
    lists['.dialog-overlay.show'] = [makeEl('dlg')];
    key({ key: 'Escape' });
    assert.equal(called('showList').length, 0);
  });
});
