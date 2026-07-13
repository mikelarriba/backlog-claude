// ── Topological sort with BFS cycle detection ─────────────────────────────────
// Performs a Kahn's-algorithm BFS topological sort on a directed graph.
// `nodes`   — all node identifiers to include in the sort.
// `edgesFn` — returns the list of nodes that `node` must come BEFORE
//             (i.e. node → dependent means node must be placed first).
//
// Returns { order, cycle } where:
//   • order — filenames in dependency-first order (empty if a cycle is detected)
//   • cycle — true when a cycle was detected; callers should treat this as an error
//
// The output order is identical to a correct sequential bubble-sort for acyclic
// graphs, so existing callers see no behaviour change.

export interface TopoSortResult {
  order: string[];
  cycle: boolean;
}

export function topoSort(
  nodes: string[],
  edgesFn: (node: string) => string[]
): TopoSortResult {
  // Build adjacency list and in-degree map restricted to nodes in the set.
  const nodeSet = new Set(nodes);
  const inDegree = new Map<string, number>();
  // deps[a] = list of nodes that depend on a (a must come before them)
  const deps = new Map<string, string[]>();

  for (const n of nodes) {
    if (!inDegree.has(n)) inDegree.set(n, 0);
    if (!deps.has(n)) deps.set(n, []);
  }

  for (const n of nodes) {
    for (const dependent of edgesFn(n)) {
      if (!nodeSet.has(dependent)) continue;
      deps.get(n)!.push(dependent);
      inDegree.set(dependent, (inDegree.get(dependent) ?? 0) + 1);
    }
  }

  // Kahn's BFS: start with nodes that have no unresolved dependencies
  const queue: string[] = [];
  for (const [n, deg] of inDegree) {
    if (deg === 0) queue.push(n);
  }

  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const dependent of deps.get(n) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (order.length !== nodes.length) {
    // Nodes that remain have non-zero in-degree — they are part of a cycle.
    return { order: [], cycle: true };
  }

  return { order, cycle: false };
}
