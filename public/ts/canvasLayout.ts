// ── Pure layout computation for the refine canvas ─────────────
// This module contains only deterministic math — no DOM access,
// no document, no fetch.  Safe to unit-test in isolation.
import type { DocEntry } from './state.js';

export interface CanvasPos {
  col: number;
  row: number;
}

export interface BlockEdge {
  src: string;
  tgt: string;
}

export interface ParallelPair {
  a: string;
  b: string;
}

// ── Auto layout: topological BFS ──────────────────────────────
export function computeAutoLayout(
  children: DocEntry[],
  blocks: BlockEdge[],
  _parallel: ParallelPair[]
): Record<string, CanvasPos> {
  const layout: Record<string, CanvasPos> = {};
  if (!children.length) return layout;

  // Build adjacency: who blocks whom
  const blockedByMap = new Map<string, string[]>(); // tgt → [src, ...] (who must come before tgt)
  for (const { src, tgt } of blocks) {
    if (!blockedByMap.has(tgt)) blockedByMap.set(tgt, []);
    blockedByMap.get(tgt)!.push(src);
  }

  // Phase 1 — seed BFS with true roots (stories with no blockers in this epic)
  const rowMap = new Map<string, number>();
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const child of children) {
    if (!(blockedByMap.get(child.filename) || []).length) {
      rowMap.set(child.filename, 0);
      visited.add(child.filename);
      queue.push(child.filename);
    }
  }

  // Phase 2 — BFS: propagate rows through the blocks graph
  let head = 0;
  while (head < queue.length) {
    const fn = queue[head++];
    const currentRow = rowMap.get(fn) || 0;
    for (const { src, tgt } of blocks) {
      if (src !== fn) continue;
      const newRow = Math.max(rowMap.get(tgt) || 0, currentRow + 1);
      rowMap.set(tgt, newRow);
      if (!visited.has(tgt)) {
        visited.add(tgt);
        queue.push(tgt);
      }
    }
  }

  // Phase 3 — any story not reachable from a root (orphan or cycle) gets row 0
  for (const child of children) {
    if (!rowMap.has(child.filename)) rowMap.set(child.filename, 0);
  }

  // Assign columns:
  //   - Items connected by BLOCKS share a column (sequential workstream — stacked vertically)
  //   - Items connected by PARALLEL get separate columns (concurrent workstreams — side by side)
  //
  // Union-find groups items that must be in the same column.
  // Each independent component (workstream) gets its own column number.
  const colSets = new Map<string, string>();
  for (const child of children) colSets.set(child.filename, child.filename);

  function findRoot(fn: string): string {
    if (colSets.get(fn) === fn) return fn;
    const root = findRoot(colSets.get(fn)!);
    colSets.set(fn, root);
    return root;
  }
  function union(a: string, b: string): void {
    const ra = findRoot(a),
      rb = findRoot(b);
    if (ra !== rb) colSets.set(ra, rb);
  }

  // Sequential chains (blocks) → same column
  for (const { src, tgt } of blocks) union(src, tgt);
  // Parallel items are intentionally NOT unioned — they go in separate columns

  // Assign one column per component, roots-first for stable ordering
  const componentCol = new Map<string, number>();
  let nextCol = 0;
  const sortedByRow = [...children].sort(
    (a, b) => (rowMap.get(a.filename) || 0) - (rowMap.get(b.filename) || 0)
  );
  for (const child of sortedByRow) {
    const root = findRoot(child.filename);
    if (!componentCol.has(root)) componentCol.set(root, nextCol++);
  }

  // Build layout
  for (const child of children) {
    const col = componentCol.get(findRoot(child.filename)) ?? 0;
    const row = rowMap.get(child.filename) ?? 0;
    layout[child.filename] = { col, row };
  }

  return layout;
}
