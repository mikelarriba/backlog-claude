// ── Unit tests: public/js/canvas-geometry.js (no DOM, no module mocks) ──────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL_W,
  CELL_H,
  GUTTER_X,
  GUTTER_Y,
  computeCanvasGridDimensions,
  cellPixelPosition,
  computeCanvasMoveTarget,
  computeSecEdgePath,
  computeBlocksEdgePath,
  computeParallelBracketPath,
} from '../../public/js/canvas-geometry.js';

describe('canvas-geometry', () => {
  test('grid always reserves one expansion row and column', () => {
    const g = computeCanvasGridDimensions([0, 1], [0], 80);
    assert.equal(g.gridCols, 3);
    assert.equal(g.gridRows, 2);
    assert.equal(g.totalW, GUTTER_X + 3 * (CELL_W + GUTTER_X));
    assert.equal(g.totalH, 80 + 2 * (CELL_H + GUTTER_Y) + GUTTER_Y);
  });

  test('cellPixelPosition maps grid cells to pixels', () => {
    assert.deepEqual(cellPixelPosition(0, 0, 80), { x: GUTTER_X, y: 80 });
    assert.deepEqual(cellPixelPosition(2, 1, 80), {
      x: GUTTER_X + 2 * (CELL_W + GUTTER_X),
      y: 80 + CELL_H + GUTTER_Y,
    });
  });

  test('computeCanvasMoveTarget stops at 0 but is unbounded down/right', () => {
    assert.equal(computeCanvasMoveTarget(0, 0, 'up'), undefined);
    assert.equal(computeCanvasMoveTarget(0, 0, 'left'), undefined);
    assert.deepEqual(computeCanvasMoveTarget(1, 1, 'up'), { col: 1, row: 0 });
    assert.deepEqual(computeCanvasMoveTarget(1, 1, 'down'), { col: 1, row: 2 });
    assert.deepEqual(computeCanvasMoveTarget(1, 1, 'left'), { col: 0, row: 1 });
    assert.deepEqual(computeCanvasMoveTarget(1, 1, 'right'), { col: 2, row: 1 });
  });

  test('edge paths start at the source bottom and end at the target top', () => {
    const a = { x: 0, y: 0, cx: 120, cy: 55 };
    const b = { x: 0, y: 200, cx: 120, cy: 255 };
    assert.match(computeSecEdgePath(a, b).d, new RegExp(`^M120,${CELL_H} C`));
    assert.match(computeBlocksEdgePath(a, b).d, /120,200$/);
    const p = computeParallelBracketPath(a, { ...b, x: 300 });
    assert.equal(p.d, `M0,-4 V-14 H${300 + CELL_W} V196`);
  });
});
