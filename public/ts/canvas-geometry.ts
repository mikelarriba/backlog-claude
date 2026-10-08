// ── Canvas geometry: pure grid and edge-path math (#699) ───────
// Extracted from refine-canvas.ts; no DOM access, unit-testable on its own.

// Grid constants
export const CELL_W = 240;
export const CELL_H = 110;
export const GUTTER_X = 60;
export const GUTTER_Y = 36;
export const TOP_OFFSET = 80;

export interface CardPos {
  cx: number;
  cy: number;
  x: number;
  y: number;
}

// Pure grid-geometry math, extracted from renderCanvas so the pixel layout
// calculations are unit-testable without a DOM (#460). One extra row/col is
// always added beyond the occupied extent so there's always room to drop a
// card past the last populated cell.
export function computeCanvasGridDimensions(
  usedCols: number[],
  usedRows: number[],
  effectiveTopOffset: number
): { gridCols: number; gridRows: number; totalW: number; totalH: number } {
  const occupiedCols = usedCols.length || 1;
  const occupiedRows = usedRows.length || 1;
  const gridCols = occupiedCols + 1;
  const gridRows = occupiedRows + 1;
  const totalW = GUTTER_X + gridCols * (CELL_W + GUTTER_X);
  const totalH = effectiveTopOffset + gridRows * (CELL_H + GUTTER_Y) + GUTTER_Y;
  return { gridCols, gridRows, totalW, totalH };
}

// Pure: top-left pixel position of a grid cell, extracted from renderCanvas's
// `cellAt` closure so it's unit-testable without a DOM (#460).
export function cellPixelPosition(
  col: number,
  row: number,
  effectiveTopOffset: number
): { x: number; y: number } {
  return {
    x: GUTTER_X + col * (CELL_W + GUTTER_X),
    y: effectiveTopOffset + row * (CELL_H + GUTTER_Y),
  };
}

// Pure: given a card's current grid cell and an arrow-key direction, returns
// the target cell for the keyboard-operable move alternative below, or
// undefined for a no-op. Mirrors the grid's own growth model — the occupied
// extent always gets one extra row/col of expansion room (see
// computeCanvasGridDimensions), so 'down'/'right' are never blocked, while
// 'up'/'left' stop at row/col 0 since negative grid coordinates aren't a
// valid layout position (#486 phase 3/N). Bounds-free by design, so it's
// reused as-is by the feature multi-panel mini-canvas's own keyboard move
// below — that grid has no fixed extent either (#486 phase 5/N).
export function computeCanvasMoveTarget(
  col: number,
  row: number,
  direction: 'up' | 'down' | 'left' | 'right'
): { col: number; row: number } | undefined {
  switch (direction) {
    case 'up':
      return row > 0 ? { col, row: row - 1 } : undefined;
    case 'down':
      return { col, row: row + 1 };
    case 'left':
      return col > 0 ? { col: col - 1, row } : undefined;
    case 'right':
      return { col: col + 1, row };
  }
}

// ── Pure edge-path geometry (extracted for unit testing — #460) ─
// The three SVG edge kinds drawn by drawCanvasEdges below (SEC, BLOCKS,
// PARALLEL) each compute a path `d` string plus a label anchor point from a
// pair of card positions. Splitting the curve/bracket math out of the
// drawing loops means it's unit-testable without a DOM or SVG namespace.
interface EdgePathResult {
  d: string;
  labelX: number;
  labelY: number;
}

// SEC arrow: same-column, consecutive-row cards — a shallow S-curve from the
// bottom of the source cell to the top of the target cell.
export function computeSecEdgePath(src: CardPos, tgt: CardPos): EdgePathResult {
  const x1 = src.cx,
    y1 = src.y + CELL_H;
  const x2 = tgt.cx,
    y2 = tgt.y;
  return {
    d: `M${x1},${y1} C${x1},${y1 + 20} ${x2},${y2 - 20} ${x2},${y2}`,
    labelX: x1 + 6,
    labelY: y1 + (y2 - y1) / 2,
  };
}

// BLOCKS arrow: same curve shape as SEC but with a deeper curve to
// distinguish it visually, and a label centered on the path's midpoint.
export function computeBlocksEdgePath(src: CardPos, tgt: CardPos): EdgePathResult {
  const x1 = src.cx,
    y1 = src.y + CELL_H;
  const x2 = tgt.cx,
    y2 = tgt.y;
  return {
    d: `M${x1},${y1} C${x1},${y1 + 24} ${x2},${y2 - 24} ${x2},${y2}`,
    labelX: (x1 + x2) / 2 + 4,
    labelY: (y1 + y2) / 2,
  };
}

// PARALLEL bracket: a squared-off bracket spanning above both cards' tops,
// from the left edge of the earlier card to the right edge of the later one.
export function computeParallelBracketPath(a: CardPos, b: CardPos): EdgePathResult {
  const x1 = a.x;
  const x2 = b.x + CELL_W;
  const y = Math.min(a.y, b.y) - 14;
  return {
    d: `M${x1},${a.y - 4} V${y} H${x2} V${b.y - 4}`,
    labelX: (x1 + x2) / 2,
    labelY: y - 3,
  };
}
