// ── Unit tests: public/js/roadmap-drag.js ───────────────────────────────────
// Pure column-order helpers backing the keyboard-operable roadmap card move
// alternative (#486 phase 2), exercised without a DOM. roadmap-drag.js
// statically imports roadmap-render.js and list-render.js (which pull in
// detail.js -> main.js and its top-level DOM listeners) plus roadmap.js, so
// those are mocked out before the dynamic import below; the pure functions
// under test never call into them.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/detail.js', {
  namedExports: { closeDeleteDialog: () => {}, executeDelete: async () => {} },
});
mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {}, contextSplitItem: () => {} },
});
mock.module('../../public/js/roadmap.js', {
  namedExports: { getAllSprints: () => [], applyEpicFocus: () => {} },
});

const { computeColumnMoveTarget, computeAdjacentColumn } =
  await import('../../public/js/roadmap-drag.js');

// ── computeColumnMoveTarget ──────────────────────────────────────────────────
describe('computeColumnMoveTarget()', () => {
  const column = ['a.md', 'b.md', 'c.md', 'd.md'];

  test('moving a middle item up targets its immediate predecessor', () => {
    assert.equal(computeColumnMoveTarget(column, 'c.md', 'up'), 'b.md');
  });

  test('moving a middle item down targets the item after its immediate successor', () => {
    assert.equal(computeColumnMoveTarget(column, 'b.md', 'down'), 'd.md');
  });

  test('moving the second-to-last item down targets null (moves to the end)', () => {
    assert.equal(computeColumnMoveTarget(column, 'c.md', 'down'), null);
  });

  test('moving the first item up is a no-op (undefined)', () => {
    assert.equal(computeColumnMoveTarget(column, 'a.md', 'up'), undefined);
  });

  test('moving the last item down is a no-op (undefined)', () => {
    assert.equal(computeColumnMoveTarget(column, 'd.md', 'down'), undefined);
  });

  test('an item not present in the column is a no-op (undefined)', () => {
    assert.equal(computeColumnMoveTarget(column, 'missing.md', 'up'), undefined);
    assert.equal(computeColumnMoveTarget(column, 'missing.md', 'down'), undefined);
  });

  test('single-item column: both directions are a no-op', () => {
    assert.equal(computeColumnMoveTarget(['a.md'], 'a.md', 'up'), undefined);
    assert.equal(computeColumnMoveTarget(['a.md'], 'a.md', 'down'), undefined);
  });
});

// ── computeAdjacentColumn ─────────────────────────────────────────────────────
describe('computeAdjacentColumn()', () => {
  // '' represents the trailing Unassigned column, matching data-sprint="".
  const columns = ['Sprint 1', 'Sprint 2', 'Sprint 3', ''];

  test('moving to the previous column from a middle column', () => {
    assert.equal(computeAdjacentColumn(columns, 'Sprint 2', 'prev'), 'Sprint 1');
  });

  test('moving to the next column from a middle column', () => {
    assert.equal(computeAdjacentColumn(columns, 'Sprint 2', 'next'), 'Sprint 3');
  });

  test('moving next from the last sprint reaches the Unassigned column', () => {
    assert.equal(computeAdjacentColumn(columns, 'Sprint 3', 'next'), '');
  });

  test('moving prev from the Unassigned column reaches the last sprint', () => {
    assert.equal(computeAdjacentColumn(columns, '', 'prev'), 'Sprint 3');
  });

  test('moving prev from the first column is a no-op (undefined)', () => {
    assert.equal(computeAdjacentColumn(columns, 'Sprint 1', 'prev'), undefined);
  });

  test('moving next from the last (Unassigned) column is a no-op (undefined)', () => {
    assert.equal(computeAdjacentColumn(columns, '', 'next'), undefined);
  });

  test('a column id not present in the list is a no-op (undefined)', () => {
    assert.equal(computeAdjacentColumn(columns, 'missing', 'prev'), undefined);
    assert.equal(computeAdjacentColumn(columns, 'missing', 'next'), undefined);
  });

  test('single-column list: both directions are a no-op', () => {
    assert.equal(computeAdjacentColumn(['Sprint 1'], 'Sprint 1', 'prev'), undefined);
    assert.equal(computeAdjacentColumn(['Sprint 1'], 'Sprint 1', 'next'), undefined);
  });
});
