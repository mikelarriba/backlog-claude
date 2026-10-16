// ── Export service: pure data assembly for print exports (#697) ─────────────
// No Express/fs dependency, so the route handlers only do I/O and HTTP mapping.
import type { DocEntry } from '../types.js';
import type { SprintEntry, EpicMapEntry } from './exportLayout.js';

export function buildChildEdges(children: DocEntry[]): {
  blocks: Array<{ src: string; tgt: string }>;
  parallel: Array<{ a: string; b: string }>;
} {
  const childFilenames = new Set(children.map((c) => c.filename));
  const blocks: Array<{ src: string; tgt: string }> = [];
  const parallel: Array<{ a: string; b: string }> = [];
  const seenParallel = new Set<string>();
  for (const child of children) {
    for (const fn of child.blocks || []) {
      if (childFilenames.has(fn)) blocks.push({ src: child.filename, tgt: fn });
    }
    for (const fn of child.parallel || []) {
      if (childFilenames.has(fn)) {
        const key = [child.filename, fn].sort().join('|');
        if (!seenParallel.has(key)) {
          seenParallel.add(key);
          parallel.push({ a: child.filename, b: fn });
        }
      }
    }
  }
  return { blocks, parallel };
}

export function parseCsvSet(value: string): Set<string> | null {
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? new Set(items) : null;
}

export interface RoadmapSelection {
  requestedPis: string[];
  sprints: SprintEntry[];
  visibleLeafs: DocEntry[];
  epicEntries: Array<[string, EpicMapEntry]>;
}

export function selectRoadmapData(opts: {
  piParam: string;
  sprintsParam: string;
  teamsParam: string;
  sprintConfig: Record<string, SprintEntry[]>;
  allDocs: DocEntry[];
  getDoc: (filename: string) => DocEntry | null | undefined;
}): RoadmapSelection {
  const { piParam, sprintsParam, teamsParam, sprintConfig, allDocs, getDoc } = opts;
  const requestedPis = piParam
    ? piParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const allPiNames = Object.keys(sprintConfig);
  const visiblePis = new Set(requestedPis.length ? requestedPis : allPiNames);
  const filterSprints = parseCsvSet(sprintsParam);
  const filterTeams = parseCsvSet(teamsParam);

  const sprints: SprintEntry[] = [];
  const seenSprints = new Set<string>();
  for (const pi of allPiNames) {
    if (!visiblePis.has(pi)) continue;
    for (const s of sprintConfig[pi] || []) {
      if (!seenSprints.has(s.name)) {
        seenSprints.add(s.name);
        if (!filterSprints || filterSprints.has(s.name)) sprints.push(s);
      }
    }
  }

  const leafTypes = new Set(['story', 'spike', 'bug']);
  const visibleLeafs = allDocs.filter(
    (d) =>
      leafTypes.has(d.docType) &&
      d.fixVersion &&
      visiblePis.has(d.fixVersion) &&
      (!filterSprints || filterSprints.has(d.sprint || '')) &&
      (!filterTeams || filterTeams.has(d.team || ''))
  );

  const epicMap = new Map<string, EpicMapEntry>();
  for (const leaf of visibleLeafs) {
    const key = leaf.parentFilename || '__none__';
    if (!epicMap.has(key)) {
      const epicDoc = leaf.parentFilename ? (getDoc(leaf.parentFilename) ?? null) : null;
      epicMap.set(key, { epicDoc, sprints: new Set(), storyCount: 0, totalSP: 0 });
    }
    const entry = epicMap.get(key)!;
    entry.storyCount++;
    entry.totalSP += Number(leaf.storyPoints) || 0;
    if (leaf.sprint) entry.sprints.add(leaf.sprint);
  }
  for (const d of allDocs) {
    if (d.docType === 'epic' && !epicMap.has(d.filename)) {
      epicMap.set(d.filename, { epicDoc: d, sprints: new Set(), storyCount: 0, totalSP: 0 });
    }
  }

  const epicEntries = [...epicMap.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === '__none__') return 1;
    if (kb === '__none__') return -1;
    const ra = a.epicDoc?.rank ?? 9999;
    const rb = b.epicDoc?.rank ?? 9999;
    if (ra !== rb) return ra - rb;
    return kb.localeCompare(ka);
  });

  return { requestedPis, sprints, visibleLeafs, epicEntries };
}
