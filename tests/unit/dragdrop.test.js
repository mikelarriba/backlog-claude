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
const {
  getSwimlaneSection,
  sectionToFixVersion,
  computeRerankedOrder,
  computeMoveTarget,
  computeEdgeMoveTarget,
  computeAdjacentSwimlane,
  buildSwimlaneMoveAnnouncement,
  buildEdgeMoveAnnouncement,
} = await import('../../public/js/dragdrop.js');

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

// ── computeMoveTarget (#486 keyboard-operable reorder) ─────────────────────────
describe('computeMoveTarget()', () => {
  const group = [
    makeDoc({ filename: 'a.md', rank: 1 }),
    makeDoc({ filename: 'b.md', rank: 2 }),
    makeDoc({ filename: 'c.md', rank: 3 }),
    makeDoc({ filename: 'd.md', rank: 4 }),
  ];

  test('moving a middle item up targets its immediate predecessor', () => {
    assert.equal(computeMoveTarget(group, 'c.md', 'up'), 'b.md');
    assert.deepEqual(computeRerankedOrder(group, 'c.md', 'b.md'), ['a.md', 'c.md', 'b.md', 'd.md']);
  });

  test('moving a middle item down targets the item after its immediate successor', () => {
    assert.equal(computeMoveTarget(group, 'b.md', 'down'), 'd.md');
    assert.deepEqual(computeRerankedOrder(group, 'b.md', 'd.md'), ['a.md', 'c.md', 'b.md', 'd.md']);
  });

  test('moving the second-to-last item down targets null (moves to the end)', () => {
    assert.equal(computeMoveTarget(group, 'c.md', 'down'), null);
    assert.deepEqual(computeRerankedOrder(group, 'c.md', null), ['a.md', 'b.md', 'd.md', 'c.md']);
  });

  test('moving the first item up is a no-op (undefined)', () => {
    assert.equal(computeMoveTarget(group, 'a.md', 'up'), undefined);
  });

  test('moving the last item down is a no-op (undefined)', () => {
    assert.equal(computeMoveTarget(group, 'd.md', 'down'), undefined);
  });

  test('an item not present in the group is a no-op (undefined)', () => {
    assert.equal(computeMoveTarget(group, 'missing.md', 'up'), undefined);
    assert.equal(computeMoveTarget(group, 'missing.md', 'down'), undefined);
  });

  test('single-item group: both directions are a no-op', () => {
    const single = [makeDoc({ filename: 'a.md', rank: 1 })];
    assert.equal(computeMoveTarget(single, 'a.md', 'up'), undefined);
    assert.equal(computeMoveTarget(single, 'a.md', 'down'), undefined);
  });
});

// ── computeEdgeMoveTarget (#486 Home/End jump to top/bottom) ──────────────────
describe('computeEdgeMoveTarget()', () => {
  const group = [
    makeDoc({ filename: 'a.md', rank: 1 }),
    makeDoc({ filename: 'b.md', rank: 2 }),
    makeDoc({ filename: 'c.md', rank: 3 }),
    makeDoc({ filename: 'd.md', rank: 4 }),
  ];

  test('jumping to the top targets the current first item', () => {
    assert.equal(computeEdgeMoveTarget(group, 'c.md', 'first'), 'a.md');
    assert.deepEqual(computeRerankedOrder(group, 'c.md', 'a.md'), ['c.md', 'a.md', 'b.md', 'd.md']);
  });

  test('jumping to the bottom targets null (append to the end)', () => {
    assert.equal(computeEdgeMoveTarget(group, 'b.md', 'last'), null);
    assert.deepEqual(computeRerankedOrder(group, 'b.md', null), ['a.md', 'c.md', 'd.md', 'b.md']);
  });

  test('jumping the second item to the top still moves it', () => {
    assert.equal(computeEdgeMoveTarget(group, 'b.md', 'first'), 'a.md');
    assert.deepEqual(computeRerankedOrder(group, 'b.md', 'a.md'), ['b.md', 'a.md', 'c.md', 'd.md']);
  });

  test('jumping the first item to the top is a no-op (undefined)', () => {
    assert.equal(computeEdgeMoveTarget(group, 'a.md', 'first'), undefined);
  });

  test('jumping the last item to the bottom is a no-op (undefined)', () => {
    assert.equal(computeEdgeMoveTarget(group, 'd.md', 'last'), undefined);
  });

  test('an item not present in the group is a no-op (undefined)', () => {
    assert.equal(computeEdgeMoveTarget(group, 'missing.md', 'first'), undefined);
    assert.equal(computeEdgeMoveTarget(group, 'missing.md', 'last'), undefined);
  });

  test('single-item group: both edges are a no-op', () => {
    const single = [makeDoc({ filename: 'a.md', rank: 1 })];
    assert.equal(computeEdgeMoveTarget(single, 'a.md', 'first'), undefined);
    assert.equal(computeEdgeMoveTarget(single, 'a.md', 'last'), undefined);
  });

  test('targets by rank order, not array order', () => {
    const unsorted = [
      makeDoc({ filename: 'c.md', rank: 3 }),
      makeDoc({ filename: 'a.md', rank: 1 }),
      makeDoc({ filename: 'b.md', rank: 2 }),
    ];
    assert.equal(computeEdgeMoveTarget(unsorted, 'b.md', 'first'), 'a.md');
    assert.equal(computeEdgeMoveTarget(unsorted, 'a.md', 'first'), undefined);
    assert.equal(computeEdgeMoveTarget(unsorted, 'c.md', 'last'), undefined);
  });
});

// ── buildEdgeMoveAnnouncement (#486 Home/End aria-live announcement) ──────────
describe('buildEdgeMoveAnnouncement()', () => {
  test('announces position 1 when jumping to the top', () => {
    assert.equal(
      buildEdgeMoveAnnouncement('My Story', 'first', 5),
      'Moved My Story to the top. Now position 1 of 5.'
    );
  });

  test('announces the last position when jumping to the bottom', () => {
    assert.equal(
      buildEdgeMoveAnnouncement('My Story', 'last', 5),
      'Moved My Story to the bottom. Now position 5 of 5.'
    );
  });
});

// ── computeAdjacentSwimlane (#486 keyboard-operable cross-section move) ───────
describe('computeAdjacentSwimlane()', () => {
  test('moving right from currentPi targets nextPi', () => {
    assert.equal(computeAdjacentSwimlane('currentPi', 'next'), 'nextPi');
  });

  test('moving right from nextPi targets backlog', () => {
    assert.equal(computeAdjacentSwimlane('nextPi', 'next'), 'backlog');
  });

  test('moving left from backlog targets nextPi', () => {
    assert.equal(computeAdjacentSwimlane('backlog', 'prev'), 'nextPi');
  });

  test('moving left from nextPi targets currentPi', () => {
    assert.equal(computeAdjacentSwimlane('nextPi', 'prev'), 'currentPi');
  });

  test('moving left from the first section (currentPi) is a no-op (undefined)', () => {
    assert.equal(computeAdjacentSwimlane('currentPi', 'prev'), undefined);
  });

  test('moving right from the last section (backlog) is a no-op (undefined)', () => {
    assert.equal(computeAdjacentSwimlane('backlog', 'next'), undefined);
  });

  test('an unrecognized section is a no-op (undefined)', () => {
    assert.equal(computeAdjacentSwimlane('bogus', 'prev'), undefined);
    assert.equal(computeAdjacentSwimlane('bogus', 'next'), undefined);
  });
});

// ── buildSwimlaneMoveAnnouncement (#486: multi-select aria-live parity) ───────
describe('buildSwimlaneMoveAnnouncement()', () => {
  test('single-item move names the item', () => {
    assert.equal(
      buildSwimlaneMoveAnnouncement('My Story', 'Current PI', 1),
      'Moved My Story to Current PI.'
    );
  });

  test('multi-select move states the count instead of a single title', () => {
    assert.equal(
      buildSwimlaneMoveAnnouncement('My Story', 'Next PI', 3),
      'Moved 3 items to Next PI.'
    );
  });

  test('a zero/undefined count falls back to the single-item wording', () => {
    assert.equal(
      buildSwimlaneMoveAnnouncement('My Story', 'Backlog', 0),
      'Moved My Story to Backlog.'
    );
  });
});
