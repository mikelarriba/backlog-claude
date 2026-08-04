// ── Unit tests: public/js/dragdrop.js ───────────────────────────────────────
// Pure swimlane-classification and rerank-order helpers from the
// drag-and-drop module (#460), exercised without a DOM. dragdrop.js
// statically imports list-filters.js (which pulls in detail.js -> main.js
// and its top-level DOM listeners) and list-render.js, and is itself
// imported back by list-filters.js (an existing circular dependency in the
// app), so detail.js and list.js are mocked out before the dynamic import
// below; the functions under test never call into them.
import { mock, test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/detail.js', {
  namedExports: { closeDeleteDialog: () => {}, executeDelete: async () => {} },
});
mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {}, contextSplitItem: () => {} },
});

const { setPiSettings } = await import('../../public/js/store.js');
const { getSwimlaneSection, sectionToFixVersion, computeRerankedOrder } =
  await import('../../public/js/dragdrop.js');

function makeDoc(overrides = {}) {
  return {
    filename: 'doc.md',
    docType: 'story',
    title: 'A Story',
    rank: null,
    ...overrides,
  };
}

// ── getSwimlaneSection ────────────────────────────────────────────────────────
describe('getSwimlaneSection()', () => {
  beforeEach(() => setPiSettings({ currentPi: 'PI-1', nextPi: 'PI-2' }));

  test('null/undefined doc is treated as backlog', () => {
    assert.equal(getSwimlaneSection(null), 'backlog');
    assert.equal(getSwimlaneSection(undefined), 'backlog');
  });

  test('no fixVersion is backlog', () => {
    assert.equal(getSwimlaneSection(makeDoc({ fixVersion: null })), 'backlog');
  });

  test('fixVersion matching currentPi is the currentPi lane', () => {
    assert.equal(getSwimlaneSection(makeDoc({ fixVersion: 'PI-1' })), 'currentPi');
  });

  test('fixVersion matching nextPi is the nextPi lane', () => {
    assert.equal(getSwimlaneSection(makeDoc({ fixVersion: 'PI-2' })), 'nextPi');
  });

  test('fixVersion matching neither configured PI falls back to backlog', () => {
    assert.equal(getSwimlaneSection(makeDoc({ fixVersion: 'PI-99' })), 'backlog');
  });

  test('when currentPi is unset, a doc with that (empty) fixVersion is still backlog', () => {
    setPiSettings({ currentPi: null, nextPi: 'PI-2' });
    assert.equal(getSwimlaneSection(makeDoc({ fixVersion: null })), 'backlog');
  });
});

// ── sectionToFixVersion ───────────────────────────────────────────────────────
describe('sectionToFixVersion()', () => {
  beforeEach(() => setPiSettings({ currentPi: 'PI-1', nextPi: 'PI-2' }));

  test('"currentPi" resolves to the configured current PI', () => {
    assert.equal(sectionToFixVersion('currentPi'), 'PI-1');
  });

  test('"nextPi" resolves to the configured next PI', () => {
    assert.equal(sectionToFixVersion('nextPi'), 'PI-2');
  });

  test('"backlog" clears the version (null)', () => {
    assert.equal(sectionToFixVersion('backlog'), null);
  });

  test('an unrecognized section also resolves to null', () => {
    assert.equal(sectionToFixVersion('nonsense'), null);
  });
});

// ── computeRerankedOrder ──────────────────────────────────────────────────────
describe('computeRerankedOrder()', () => {
  test('moving an item to the end when insertBeforeFilename is null', () => {
    const group = [
      makeDoc({ filename: 'a.md', rank: 1 }),
      makeDoc({ filename: 'b.md', rank: 2 }),
      makeDoc({ filename: 'c.md', rank: 3 }),
    ];
    const order = computeRerankedOrder(group, 'a.md', null);
    assert.deepEqual(order, ['b.md', 'c.md', 'a.md']);
  });

  test('moving an item to just before a target filename', () => {
    const group = [
      makeDoc({ filename: 'a.md', rank: 1 }),
      makeDoc({ filename: 'b.md', rank: 2 }),
      makeDoc({ filename: 'c.md', rank: 3 }),
    ];
    const order = computeRerankedOrder(group, 'c.md', 'a.md');
    assert.deepEqual(order, ['c.md', 'a.md', 'b.md']);
  });

  test('src filename not present in the group returns null (no-op)', () => {
    const group = [makeDoc({ filename: 'a.md', rank: 1 })];
    assert.equal(computeRerankedOrder(group, 'missing.md', null), null);
  });

  test('insertBeforeFilename not found in the (post-removal) group falls back to end', () => {
    const group = [makeDoc({ filename: 'a.md', rank: 1 }), makeDoc({ filename: 'b.md', rank: 2 })];
    const order = computeRerankedOrder(group, 'a.md', 'does-not-exist.md');
    assert.deepEqual(order, ['b.md', 'a.md']);
  });

  test('sorts unranked items into rank order first via _rankSortFn before repositioning', () => {
    // b has no rank, a and c do — unranked sorts after ranked per _rankSortFn.
    const group = [
      makeDoc({ filename: 'a.md', rank: 1 }),
      makeDoc({ filename: 'b.md', rank: null }),
      makeDoc({ filename: 'c.md', rank: 2 }),
    ];
    const order = computeRerankedOrder(group, 'b.md', null);
    // b removed then re-appended at the end regardless of its original position
    assert.deepEqual(order, ['a.md', 'c.md', 'b.md']);
  });

  test('single-item group: dragging the only item to the end returns it unchanged', () => {
    const group = [makeDoc({ filename: 'a.md', rank: 1 })];
    assert.deepEqual(computeRerankedOrder(group, 'a.md', null), ['a.md']);
  });
});
