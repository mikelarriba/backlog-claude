// ── Unit tests: public/js/split-mode.js ─────────────────────────────────────
// Split-panel layout helpers (moved out of main.ts, #698). Pure DOM logic with
// no module imports, so only a minimal document/window shim is needed.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeEl(props = {}) {
  const classes = new Set(props.classes || []);
  return {
    style: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle(c, force) {
        if (force) classes.add(c);
        else classes.delete(c);
        return force;
      },
    },
  };
}

const lists = {};
let single = {};
globalThis.document = {
  querySelector: (sel) => single[sel] ?? null,
  querySelectorAll: (sel) => lists[sel] ?? [],
  getElementById: (id) => single[`#${id}`] ?? null,
};
globalThis.window = globalThis.window ?? globalThis;
globalThis.CSS = { escape: (s) => s };

const { isSplitMode, highlightSelectedItem, updateSplitMode } =
  await import('../../public/js/split-mode.js');

beforeEach(() => {
  single = {};
  for (const k of Object.keys(lists)) delete lists[k];
  globalThis.currentFilename = null;
  globalThis.currentDocType = null;
});

describe('isSplitMode', () => {
  test('false without a .right container', () => {
    assert.equal(isSplitMode(), false);
  });

  test('reflects the split-mode class on .right', () => {
    single['.right'] = makeEl({ classes: ['split-mode'] });
    assert.equal(isSplitMode(), true);
    single['.right'] = makeEl();
    assert.equal(isSplitMode(), false);
  });
});

describe('highlightSelectedItem', () => {
  test('clears prior selection and selects matching rows', () => {
    const old = makeEl({ classes: ['selected'] });
    lists['.epic-item, .roadmap-card'] = [old];
    const item = makeEl();
    const seen = [];
    globalThis.document.querySelector = (sel) => {
      seen.push(sel);
      return sel.startsWith('.epic-item') ? item : null;
    };
    try {
      highlightSelectedItem('a.md', 'story');
      assert.equal(old.classList.contains('selected'), false);
      assert.equal(item.classList.contains('selected'), true);
      assert.ok(seen.some((s) => s.includes('[data-filename="a.md"][data-doctype="story"]')));
      highlightSelectedItem(null, 'story');
      assert.equal(item.classList.contains('selected'), true, 'null filename only clears');
    } finally {
      globalThis.document.querySelector = (sel) => single[sel] ?? null;
    }
  });
});

describe('updateSplitMode', () => {
  test('no-op without a .right container', () => {
    assert.doesNotThrow(() => updateSplitMode());
  });

  test('enables split mode on wide viewports and restores the list view', () => {
    const right = makeEl();
    const listView = makeEl();
    listView.style.display = 'none';
    single['.right'] = right;
    single['#list-view'] = listView;
    globalThis.currentFilename = 'a.md';
    globalThis.window.innerWidth = 1400;
    updateSplitMode();
    assert.equal(right.classList.contains('split-mode'), true);
    assert.equal(listView.style.display, '');
  });

  test('disabling split mode hides the list view when a doc is open', () => {
    const right = makeEl({ classes: ['split-mode'] });
    const listView = makeEl();
    single['.right'] = right;
    single['#list-view'] = listView;
    globalThis.currentFilename = 'a.md';
    globalThis.window.innerWidth = 800;
    updateSplitMode();
    assert.equal(right.classList.contains('split-mode'), false);
    assert.equal(listView.style.display, 'none');
  });

  test('does nothing when the mode already matches the viewport', () => {
    const right = makeEl();
    single['.right'] = right;
    globalThis.window.innerWidth = 800;
    updateSplitMode();
    assert.equal(right.classList.contains('split-mode'), false);
  });
});
