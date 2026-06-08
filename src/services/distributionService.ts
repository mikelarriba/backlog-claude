// ── Greedy sprint distribution algorithm ─────────────────────────────────────
// Pure function — no I/O, no req/res.  Accepts leaf docs + sprint config and
// returns a proposed sprint assignment with warnings and overflow info.

export interface DistributionDoc {
  filename: string;
  docType: string;
  title: string;
  storyPoints: number;
  hasEstimate: boolean;
  priority: string;
  sprint: string | null;
  rank: number;
  parentFilename: string | null;
  blockedBy: string[];
  blocks: string[];
  parallel: string[];
}

export interface SprintConfig {
  name: string;
  capacity: number;
  bufferPct?: number;
}

export interface AssignedDoc extends DistributionDoc {
  wasAlreadyAssigned: boolean;
}

export interface SprintBucket {
  name: string;
  capacity: number; // raw capacity
  effectiveCapacity: number; // after buffer
  idx: number;
  assigned: AssignedDoc[];
  usedPoints: number;
}

export interface DistributionResult {
  sprints: SprintBucket[];
  overflow: DistributionDoc[];
  warnings: string[];
  suggestions: string[];
}

const PRIORITY_RANK: Record<string, number> = { Critical: 0, Major: 0, High: 1, Medium: 2, Low: 3 };

function sortByRankPriority(
  a: { rank: number; priority: string; storyPoints: number },
  b: { rank: number; priority: string; storyPoints: number }
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const pa = PRIORITY_RANK[a.priority] ?? 2;
  const pb = PRIORITY_RANK[b.priority] ?? 2;
  if (pa !== pb) return pa - pb;
  return b.storyPoints - a.storyPoints;
}

/**
 * Propose sprint assignments for a set of leaf documents.
 *
 * @param leafDocs     Leaf-level docs (stories/spikes/bugs) for the PI.
 * @param sprintCfg    Ordered list of sprints with their capacities.
 * @param epicRankMap  Rank value per epic/feature filename, used to order epic groups.
 */
export function proposeDistribution(
  leafDocs: DistributionDoc[],
  sprintCfg: SprintConfig[],
  epicRankMap: Map<string, number>
): DistributionResult {
  const assigned = leafDocs.filter((d) => d.sprint);
  const unassigned = leafDocs.filter((d) => !d.sprint);

  // Group unassigned by parent epic to maximise epic completion
  const epicGroups = new Map<string, DistributionDoc[]>();
  const standalones: DistributionDoc[] = [];
  for (const doc of unassigned) {
    if (doc.parentFilename) {
      if (!epicGroups.has(doc.parentFilename)) epicGroups.set(doc.parentFilename, []);
      epicGroups.get(doc.parentFilename)!.push(doc);
    } else {
      standalones.push(doc);
    }
  }

  for (const docs of epicGroups.values()) docs.sort(sortByRankPriority);

  const sortedGroups = [...epicGroups.entries()]
    .sort(([fnA], [fnB]) => {
      const ra = epicRankMap.get(fnA) ?? 9999;
      const rb = epicRankMap.get(fnB) ?? 9999;
      if (ra !== rb) return ra - rb;
      return fnB.localeCompare(fnA);
    })
    .map(([, docs]) => docs);

  standalones.sort(sortByRankPriority);

  const workQueue: DistributionDoc[] = [];
  const noEstimateOverflow: DistributionDoc[] = [];
  for (const docs of sortedGroups) {
    for (const d of docs) {
      if (d.hasEstimate) workQueue.push(d);
      else noEstimateOverflow.push(d);
    }
  }
  for (const d of standalones) {
    if (d.hasEstimate) workQueue.push(d);
    else noEstimateOverflow.push(d);
  }

  // Build buckets pre-filled with already-assigned docs
  const buckets: SprintBucket[] = sprintCfg.map((s, idx) => ({
    name: s.name,
    capacity: s.capacity,
    effectiveCapacity: Math.floor(s.capacity * (1 - (s.bufferPct ?? 0))),
    idx,
    assigned: assigned
      .filter((d) => d.sprint === s.name)
      .map((d) => ({ ...d, wasAlreadyAssigned: true })),
    usedPoints: assigned
      .filter((d) => d.sprint === s.name)
      .reduce((sum, d) => sum + d.storyPoints, 0),
  }));

  const sprintIdx = new Map(buckets.map((b) => [b.name, b.idx]));
  const placementMap = new Map<string, string>(assigned.map((d) => [d.filename, d.sprint!]));
  const depAdjusted: string[] = [];

  const epicStartSprint = new Map<string, number>();
  for (const d of assigned) {
    if (!d.parentFilename) continue;
    const si = sprintIdx.get(d.sprint!) ?? 0;
    if (!epicStartSprint.has(d.parentFilename) || si < epicStartSprint.get(d.parentFilename)!) {
      epicStartSprint.set(d.parentFilename, si);
    }
  }

  // Greedy fill with dep-constraint floor + 2-sprint epic window
  const overflow: DistributionDoc[] = [...noEstimateOverflow];
  for (const doc of workQueue) {
    let minIdx = 0;
    for (const blockerFn of doc.blockedBy) {
      const blockerSprint = placementMap.get(blockerFn);
      if (blockerSprint != null) {
        const bi = sprintIdx.get(blockerSprint) ?? -1;
        if (bi + 1 > minIdx) minIdx = bi + 1;
      }
    }

    let preferredIdx = minIdx;
    for (const siblingFn of doc.parallel) {
      const sibSprint = placementMap.get(siblingFn);
      if (sibSprint != null) {
        preferredIdx = Math.max(preferredIdx, sprintIdx.get(sibSprint) ?? 0);
      }
    }

    const hardMaxIdx = buckets.length - 1;
    let softMaxIdx = hardMaxIdx;
    if (doc.parentFilename) {
      const start = epicStartSprint.get(doc.parentFilename);
      if (start != null) softMaxIdx = Math.min(hardMaxIdx, start + 1);
    }

    let placed = false;
    // Pass 1: within preferred 2-sprint window
    for (const bucket of buckets) {
      if (bucket.idx < preferredIdx) continue;
      if (bucket.idx > softMaxIdx) break;
      if (bucket.usedPoints + doc.storyPoints <= bucket.effectiveCapacity) {
        if (minIdx > 0 && bucket.idx > 0) {
          depAdjusted.push(`"${doc.title}" placed in ${bucket.name} due to dependency ordering`);
        }
        bucket.assigned.push({ ...doc, wasAlreadyAssigned: false });
        bucket.usedPoints += doc.storyPoints;
        placementMap.set(doc.filename, bucket.name);
        if (doc.parentFilename && !epicStartSprint.has(doc.parentFilename)) {
          epicStartSprint.set(doc.parentFilename, bucket.idx);
        }
        placed = true;
        break;
      }
    }
    // Pass 2: spill beyond 2-sprint window
    if (!placed) {
      for (const bucket of buckets) {
        if (bucket.idx <= softMaxIdx) continue;
        if (bucket.idx < minIdx) continue;
        if (bucket.idx > hardMaxIdx) break;
        if (bucket.usedPoints + doc.storyPoints <= bucket.effectiveCapacity) {
          depAdjusted.push(
            `"${doc.title}" spilled beyond preferred 2-sprint window into ${bucket.name}`
          );
          bucket.assigned.push({ ...doc, wasAlreadyAssigned: false });
          bucket.usedPoints += doc.storyPoints;
          placementMap.set(doc.filename, bucket.name);
          if (doc.parentFilename && !epicStartSprint.has(doc.parentFilename)) {
            epicStartSprint.set(doc.parentFilename, bucket.idx);
          }
          placed = true;
          break;
        }
      }
    }
    if (!placed) overflow.push(doc);
  }

  // Advisory warnings for parallel siblings in different sprints
  const seenParallelPairs = new Set<string>();
  for (const doc of workQueue) {
    const docSprint = placementMap.get(doc.filename);
    if (!docSprint) continue;
    for (const siblingFn of doc.parallel) {
      const pairKey = [doc.filename, siblingFn].sort().join('|');
      if (seenParallelPairs.has(pairKey)) continue;
      seenParallelPairs.add(pairKey);
      const sibSprint = placementMap.get(siblingFn);
      if (sibSprint && sibSprint !== docSprint) {
        depAdjusted.push(
          `Parallel stories "${doc.title}" (${docSprint}) and "${siblingFn}" (${sibSprint}) could not be co-located`
        );
      }
    }
  }

  const warnings: string[] = [];
  const suggestions: string[] = [];
  if (noEstimateOverflow.length)
    warnings.push(
      `${noEstimateOverflow.length} item(s) have no story point estimate — add story points before distributing`
    );
  if (depAdjusted.length) warnings.push(...depAdjusted);
  const capacityOverflow = overflow.filter((d) => d.hasEstimate);
  if (capacityOverflow.length) {
    const overflowSP = capacityOverflow.reduce((s, d) => s + d.storyPoints, 0);
    warnings.push(
      `${capacityOverflow.length} item(s) (${overflowSP} SP) exceed total sprint capacity`
    );
  }
  for (const bucket of buckets) {
    const pct =
      bucket.effectiveCapacity > 0
        ? Math.round((bucket.usedPoints / bucket.effectiveCapacity) * 100)
        : 0;
    if (pct > 100)
      suggestions.push(
        `${bucket.name} is over capacity at ${pct}% — consider moving items to a later sprint`
      );
    else if (pct < 50 && bucket.effectiveCapacity > 0)
      suggestions.push(
        `${bucket.name} has ${bucket.effectiveCapacity - bucket.usedPoints} SP of free capacity`
      );
  }

  return { sprints: buckets, overflow, warnings, suggestions };
}
