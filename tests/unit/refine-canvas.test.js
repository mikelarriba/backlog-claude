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

const {
  computeCanvasGridDimensions,
  cellPixelPosition,
  computeCanvasMoveTarget,
  computeSecEdgePath,
  computeBlocksEdgePath,
  computeParallelBracketPath,
} = await import('../../public/js/refine-canvas.js');

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

// ── computeSecEdgePath / computeBlocksEdgePath / computeParallelBracketPath ──
// Pure SVG path/label geometry extracted from drawCanvasEdges' three edge-kind
// loops (SEC, BLOCKS, PARALLEL) so the curve math is unit-testable without an
// SVG namespace.
describe('computeSecEdgePath()', () => {
  test('path runs from the bottom-center of src to the top-center of tgt', () => {
    const src = { cx: 100, cy: 55, x: 0, y: 0 };
    const tgt = { cx: 340, cy: 165, x: 240, y: 110 };
    const { d } = computeSecEdgePath(src, tgt);
    assert.equal(d, 'M100,110 C100,130 340,90 340,110');
  });

  test('label sits just right of src.cx, vertically midway between the two curve ends', () => {
    const src = { cx: 100, cy: 55, x: 0, y: 0 };
    const tgt = { cx: 340, cy: 165, x: 240, y: 110 };
    const { labelX, labelY } = computeSecEdgePath(src, tgt);
    assert.equal(labelX, 106); // src.cx + 6
    assert.equal(labelY, 110); // y1 == y2 here, so midpoint == y1
  });
});

describe('computeBlocksEdgePath()', () => {
  test('uses a deeper curve than SEC (24 vs 20) between the same anchor points', () => {
    const src = { cx: 100, cy: 55, x: 0, y: 0 };
    const tgt = { cx: 340, cy: 165, x: 240, y: 110 };
    const { d } = computeBlocksEdgePath(src, tgt);
    assert.equal(d, 'M100,110 C100,134 340,86 340,110');
  });

  test('label is centered on the path midpoint, nudged 4px right', () => {
    const src = { cx: 0, cy: 0, x: -110, y: -55 };
    const tgt = { cx: 200, cy: 200, x: 90, y: 145 };
    const { labelX, labelY } = computeBlocksEdgePath(src, tgt);
    // y1 = src.y + CELL_H = -55 + 110 = 55; y2 = tgt.y = 145
    assert.equal(labelX, 104); // (0 + 200) / 2 + 4
    assert.equal(labelY, 100); // (55 + 145) / 2
  });
});

describe('computeParallelBracketPath()', () => {
  test('brackets from the left edge of a to the right edge of b, squared off above both tops', () => {
    const a = { cx: 120, cy: 55, x: 0, y: 0 };
    const b = { cx: 360, cy: 55, x: 240, y: 0 };
    const { d } = computeParallelBracketPath(a, b);
    // x1 = a.x = 0; x2 = b.x + CELL_W(240) = 480; y = min(0,0) - 14 = -14
    assert.equal(d, 'M0,-4 V-14 H480 V-4');
  });

  test('bracket height follows whichever card sits higher (smaller y)', () => {
    const higher = { cx: 120, cy: 55, x: 0, y: 0 };
    const lower = { cx: 480, cy: 165, x: 300, y: 110 };
    const { d: dHigherFirst } = computeParallelBracketPath(higher, lower);
    const { d: dLowerFirst } = computeParallelBracketPath(lower, higher);
    // Bracket top (y = min(a.y, b.y) - 14) is the same regardless of arg order.
    assert.equal(dHigherFirst, 'M0,-4 V-14 H540 V106');
    assert.equal(dLowerFirst, 'M300,106 V-14 H240 V-4');
  });

  test('label is horizontally centered between the two x anchors, just above the bracket top', () => {
    const a = { cx: 120, cy: 55, x: 0, y: 0 };
    const b = { cx: 360, cy: 55, x: 240, y: 0 };
    const { labelX, labelY } = computeParallelBracketPath(a, b);
    assert.equal(labelX, 240); // (0 + 480) / 2
    assert.equal(labelY, -17); // y(-14) - 3
  });
});
