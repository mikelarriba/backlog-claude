// ── Unit tests: public/js/refine-canvas.js ──────────────────────────────────
// Pure grid-geometry helpers extracted from renderCanvas/_renderFpCanvas
// (#460), exercised without a DOM. refine-canvas.js is part of the same
// refine.js <-> list.js <-> detail.js circular import chain documented in
// dragdrop.test.js, so detail.js and list.js are mocked out before the
// dynamic import below; the functions under test never call into them.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/detail.js', {
  namedExports: { closeDeleteDialog: () => {}, executeDelete: async () => {}, openDoc: () => {} },
});
mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {}, contextSplitItem: () => {} },
});

const { computeCanvasGridDimensions, cellPixelPosition, computeCanvasMoveTarget } =
  await import('../../public/js/refine-canvas.js');

// ── computeCanvasGridDimensions ─────────────────────────────────────────────
describe('computeCanvasGridDimensions()', () => {
  test('no occupied cells still reserves a 1x1 grid plus one expansion row/col', () => {
    const { gridCols, gridRows } = computeCanvasGridDimensions([], [], 80);
    assert.equal(gridCols, 2);
    assert.equal(gridRows, 2);
  });

  test('grid dimensions are occupied extent + 1 for expansion', () => {
    const { gridCols, gridRows } = computeCanvasGridDimensions([0, 1, 2], [0, 1], 80);
    assert.equal(gridCols, 4);
    assert.equal(gridRows, 3);
  });

  test('totalW/totalH scale with grid dimensions and cell/gutter constants', () => {
    const a = computeCanvasGridDimensions([0], [0], 80);
    const b = computeCanvasGridDimensions([0, 1], [0], 80);
    // One more column adds exactly one cell-width + one gutter to totalW.
    assert.equal(b.totalW - a.totalW, 240 + 60);
    // Height is unaffected by adding a column.
    assert.equal(b.totalH, a.totalH);
  });

  test('effectiveTopOffset (banner offset) shifts totalH but not totalW', () => {
    const noBanner = computeCanvasGridDimensions([0], [0], 80);
    const withBanner = computeCanvasGridDimensions([0], [0], 80 + 44);
    assert.equal(withBanner.totalH - noBanner.totalH, 44);
    assert.equal(withBanner.totalW, noBanner.totalW);
  });
});

// ── cellPixelPosition ────────────────────────────────────────────────────────
describe('cellPixelPosition()', () => {
  test('col 0, row 0 sits at the gutter offset from the top offset', () => {
    assert.deepEqual(cellPixelPosition(0, 0, 80), { x: 60, y: 80 });
  });

  test('advancing one column moves x by cell width + gutter, y unchanged', () => {
    const p0 = cellPixelPosition(0, 0, 80);
    const p1 = cellPixelPosition(1, 0, 80);
    assert.equal(p1.x - p0.x, 240 + 60);
    assert.equal(p1.y, p0.y);
  });

  test('advancing one row moves y by cell height + gutter, x unchanged', () => {
    const p0 = cellPixelPosition(0, 0, 80);
    const p1 = cellPixelPosition(0, 1, 80);
    assert.equal(p1.y - p0.y, 110 + 36);
    assert.equal(p1.x, p0.x);
  });

  test('a different top offset (banner present) only shifts y', () => {
    const noBanner = cellPixelPosition(2, 3, 80);
    const withBanner = cellPixelPosition(2, 3, 124);
    assert.equal(withBanner.y - noBanner.y, 44);
    assert.equal(withBanner.x, noBanner.x);
  });
});

// ── computeCanvasMoveTarget ──────────────────────────────────────────────────
// Backs the keyboard-operable canvas card move alternative (#486 phase 3).
describe('computeCanvasMoveTarget()', () => {
  test('up from a non-zero row targets the row above', () => {
    assert.deepEqual(computeCanvasMoveTarget(2, 3, 'up'), { col: 2, row: 2 });
  });

  test('up from row 0 is a no-op (undefined) — no negative grid coordinates', () => {
    assert.equal(computeCanvasMoveTarget(2, 0, 'up'), undefined);
  });

  test('down always targets the row below, even past the currently occupied extent', () => {
    assert.deepEqual(computeCanvasMoveTarget(2, 3, 'down'), { col: 2, row: 4 });
    assert.deepEqual(computeCanvasMoveTarget(0, 0, 'down'), { col: 0, row: 1 });
  });

  test('left from a non-zero column targets the column before', () => {
    assert.deepEqual(computeCanvasMoveTarget(3, 2, 'left'), { col: 2, row: 2 });
  });

  test('left from column 0 is a no-op (undefined) — no negative grid coordinates', () => {
    assert.equal(computeCanvasMoveTarget(0, 2, 'left'), undefined);
  });

  test('right always targets the column after, even past the currently occupied extent', () => {
    assert.deepEqual(computeCanvasMoveTarget(3, 2, 'right'), { col: 4, row: 2 });
    assert.deepEqual(computeCanvasMoveTarget(0, 0, 'right'), { col: 1, row: 0 });
  });

  test('origin cell (0,0): up and left are no-ops, down and right advance', () => {
    assert.equal(computeCanvasMoveTarget(0, 0, 'up'), undefined);
    assert.equal(computeCanvasMoveTarget(0, 0, 'left'), undefined);
    assert.deepEqual(computeCanvasMoveTarget(0, 0, 'down'), { col: 0, row: 1 });
    assert.deepEqual(computeCanvasMoveTarget(0, 0, 'right'), { col: 1, row: 0 });
  });
});
