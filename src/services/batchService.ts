// ── Batch document operation service ──────────────────────────────────────────
// Contains the business logic extracted from docs-batch routes.
// Routes are responsible for: validate → call service → shape HTTP response.
import fs from 'fs';
import path from 'path';
import { assertDocType, assertFilename } from '../utils/routeHelpers.js';
import { setFrontmatterField } from '../utils/transforms.js';
import { applyDocPatch } from './docPatch.js';
import { pMap } from '../utils/pMap.js';
import { logAudit } from '../utils/auditLog.js';
import { proposeDistribution } from './distributionService.js';
import { topoSort } from '../utils/topoSort.js';
import type { TypeConfig, DocIndexInstance } from '../types.js';
import type { DistributionDoc } from './distributionService.js';
import type { Logger } from '../utils/logger.js';

export type DocItem = { type: string; filename: string };
export type RerankItem = { filename: string; docType: string; rank: number };
export type AssignmentItem = { docType: string; filename: string; sprint: string };

const BATCH_CONCURRENCY = 5;

interface BatchContext {
  TYPE_CONFIG: TypeConfig;
  rootDir: string;
  docIndex: DocIndexInstance;
  logWarn: Logger['logWarn'];
}

// ── batch-delete ──────────────────────────────────────────────────────────────

export interface BatchDeleteResult {
  deleted: Array<{ filename: string; docType: string }>;
  skipped: Array<{ filename: string; reason: string }>;
}

export async function batchDelete(
  docs: DocItem[],
  { TYPE_CONFIG, logWarn }: Pick<BatchContext, 'TYPE_CONFIG' | 'logWarn'>
): Promise<BatchDeleteResult> {
  const deleted: Array<{ filename: string; docType: string }> = [];
  const skipped: Array<{ filename: string; reason: string }> = [];

  await pMap(
    docs,
    async (entry) => {
      try {
        const docType = assertDocType(entry.type, TYPE_CONFIG);
        const filename = assertFilename(entry.filename);
        const cfg = TYPE_CONFIG[docType];
        const filepath = path.join(cfg.dir(), filename);

        try {
          await fs.promises.access(filepath);
        } catch (err) {
          logWarn('batch', `skipping ${filename}: file not found`, {
            error: err instanceof Error ? err.message : String(err),
          });
          skipped.push({ filename, reason: 'not found' });
          return;
        }

        await fs.promises.unlink(filepath);
        deleted.push({ filename, docType });
      } catch (entryErr) {
        skipped.push({
          filename: entry.filename,
          reason: entryErr instanceof Error ? entryErr.message : 'invalid',
        });
      }
    },
    { concurrency: BATCH_CONCURRENCY }
  );

  for (const d of deleted) {
    logAudit({ op: 'delete', docType: d.docType, filename: d.filename, source: 'api' });
  }

  return { deleted, skipped };
}

// ── batch-fix-version ─────────────────────────────────────────────────────────

export interface BatchFixVersionResult {
  updated: Array<{ filename: string; docType: string }>;
  skipped: Array<{ filename: string; reason: string }>;
}

export async function batchFixVersion(
  docs: DocItem[],
  newValue: string,
  { TYPE_CONFIG, logWarn }: Pick<BatchContext, 'TYPE_CONFIG' | 'logWarn'>
): Promise<BatchFixVersionResult> {
  const updated: Array<{ filename: string; docType: string }> = [];
  const skipped: Array<{ filename: string; reason: string }> = [];

  await pMap(
    docs,
    async (entry) => {
      try {
        const docType = assertDocType(entry.type, TYPE_CONFIG);
        const filename = assertFilename(entry.filename);
        const cfg = TYPE_CONFIG[docType];
        const filepath = path.join(cfg.dir(), filename);

        try {
          await fs.promises.access(filepath);
        } catch (err) {
          logWarn('batch', `skipping ${filename}: file not found`, {
            error: err instanceof Error ? err.message : String(err),
          });
          skipped.push({ filename, reason: 'not found' });
          return;
        }

        await applyDocPatch(filepath, 'Fix_Version', newValue);
        updated.push({ filename, docType });
      } catch (entryErr) {
        skipped.push({
          filename: entry.filename,
          reason: entryErr instanceof Error ? entryErr.message : 'invalid',
        });
      }
    },
    { concurrency: BATCH_CONCURRENCY }
  );

  return { updated, skipped };
}

// ── distribute ────────────────────────────────────────────────────────────────

export type SprintConfig = { name: string; capacity: number; bufferPct?: number };

export type DistributionComputed = {
  sprintCfg: SprintConfig[];
  leafDocs: DistributionDoc[];
  epicRankMap: Map<string, number>;
};

export type DistributionComputeError = { error: { code: string; message: string } };

export async function computeDistribution(
  piName: string,
  { rootDir, docIndex, logWarn }: Pick<BatchContext, 'rootDir' | 'docIndex' | 'logWarn'>
): Promise<DistributionComputed | DistributionComputeError> {
  const piSettingsPath = path.join(rootDir, '.pi-settings.json');
  let sprintCfg: SprintConfig[] = [];
  try {
    const raw = await fs.promises.readFile(piSettingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    const defaultBufferPct = settings.defaultBufferPct ?? 0;
    sprintCfg = (settings.sprints && settings.sprints[piName]) || [];
    sprintCfg = sprintCfg.map((s) => ({
      ...s,
      bufferPct: s.bufferPct ?? defaultBufferPct,
    }));
  } catch (err) {
    logWarn('batch/distribute', `could not read PI settings`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!sprintCfg.length) {
    return { error: { code: 'NO_SPRINTS', message: 'No sprints configured for this PI' } };
  }

  const leafTypes = new Set(['story', 'spike', 'bug']);
  const leafDocs: DistributionDoc[] = docIndex
    .getAll()
    .filter((e) => leafTypes.has(e.docType) && e.fixVersion === piName)
    .map((e) => ({
      filename: e.filename,
      docType: e.docType,
      title: e.title,
      storyPoints: e.storyPoints || 0,
      hasEstimate: !!e.storyPoints,
      priority: e.priority || 'Medium',
      sprint: e.sprint || null,
      rank: e.rank != null ? e.rank : 9999,
      parentFilename: e.parentFilename || null,
      blockedBy: e.blockedBy || [],
      blocks: e.blocks || [],
      parallel: e.parallel || [],
    }));

  const epicRankMap = new Map<string, number>();
  for (const e of docIndex.getAll()) {
    if (e.docType === 'epic' || e.docType === 'feature') {
      epicRankMap.set(e.filename, e.rank != null ? e.rank : 9999);
    }
  }

  return { sprintCfg, leafDocs, epicRankMap };
}

export function runDistribution(
  leafDocs: DistributionDoc[],
  sprintCfg: SprintConfig[],
  epicRankMap: Map<string, number>
) {
  return proposeDistribution(leafDocs, sprintCfg, epicRankMap);
}

// ── rerank ────────────────────────────────────────────────────────────────────

export interface RerankResult {
  updated: string[];
  skipped: Array<{ filename: string; reason: string }>;
}

export async function batchRerank(
  docType: string,
  orderedFilenames: string[],
  { TYPE_CONFIG, logWarn }: Pick<BatchContext, 'TYPE_CONFIG' | 'logWarn'>
): Promise<RerankResult> {
  const cfg = TYPE_CONFIG[docType];
  const updated: string[] = [];
  const skipped: Array<{ filename: string; reason: string }> = [];

  await pMap(
    orderedFilenames,
    async (rawFilename, i) => {
      try {
        const filename = assertFilename(rawFilename);
        const filepath = path.join(cfg.dir(), filename);
        try {
          await fs.promises.access(filepath);
        } catch (err) {
          logWarn('batch', `skipping ${filename}: file not found`, {
            error: err instanceof Error ? err.message : String(err),
          });
          skipped.push({ filename, reason: 'not found' });
          return;
        }
        await applyDocPatch(filepath, 'Rank', String(i + 1));
        updated.push(filename);
      } catch (entryErr) {
        skipped.push({
          filename: rawFilename,
          reason: entryErr instanceof Error ? entryErr.message : 'invalid',
        });
      }
    },
    { concurrency: BATCH_CONCURRENCY }
  );

  return { updated, skipped };
}

// ── rerank-canvas ─────────────────────────────────────────────────────────────

export async function batchRerankCanvas(
  items: RerankItem[],
  { TYPE_CONFIG, logWarn }: Pick<BatchContext, 'TYPE_CONFIG' | 'logWarn'>
): Promise<RerankResult> {
  const updated: string[] = [];
  const skipped: Array<{ filename: string; reason: string }> = [];

  await pMap(
    items,
    async (item) => {
      try {
        const docType = assertDocType(item.docType, TYPE_CONFIG);
        const filename = assertFilename(item.filename);
        const cfg = TYPE_CONFIG[docType];
        const filepath = path.join(cfg.dir(), filename);
        try {
          await fs.promises.access(filepath);
        } catch (err) {
          logWarn('batch', `skipping ${filename}: file not found`, {
            error: err instanceof Error ? err.message : String(err),
          });
          skipped.push({ filename, reason: 'not found' });
          return;
        }

        await applyDocPatch(filepath, 'Rank', String(item.rank));
        updated.push(filename);
      } catch (entryErr) {
        skipped.push({
          filename: item.filename,
          reason: entryErr instanceof Error ? entryErr.message : 'invalid',
        });
      }
    },
    { concurrency: BATCH_CONCURRENCY }
  );

  return { updated, skipped };
}

// ── apply-distribution ────────────────────────────────────────────────────────

export interface ApplyDistributionResult {
  updated: Array<{ filename: string; docType: string; sprint: string | undefined }>;
  skipped: Array<{ filename: string; reason: string }>;
  warnings: Array<{ blocker: string; blocked: string; message: string }>;
}

export async function applyDistribution(
  assignments: AssignmentItem[],
  { rootDir, docIndex, TYPE_CONFIG, logWarn }: Pick<BatchContext, 'rootDir' | 'docIndex' | 'TYPE_CONFIG' | 'logWarn'>
): Promise<ApplyDistributionResult | { error: { code: string; message: string } }> {
  // Build a global sprint order from .pi-settings.json
  const piSettingsPath = path.join(rootDir, '.pi-settings.json');
  const sprintOrder: string[] = [];
  try {
    const raw = await fs.promises.readFile(piSettingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    for (const piSprints of Object.values(settings.sprints || {})) {
      for (const s of piSprints as Array<{ name: string }>) {
        if (!sprintOrder.includes(s.name)) sprintOrder.push(s.name);
      }
    }
  } catch (err) {
    logWarn(
      'batch/apply-distribution',
      `could not load PI settings for dependency enforcement`,
      { error: err instanceof Error ? err.message : String(err) }
    );
  }

  const sprintMap = new Map(assignments.map((a) => [a.filename, a.sprint]));
  const depWarnings: Array<{ blocker: string; blocked: string; message: string }> = [];

  if (sprintOrder.length) {
    const sprintIdx = new Map(sprintOrder.map((s, i) => [s, i]));
    const assignedFilenames = Array.from(sprintMap.keys());

    const { order: topoOrder, cycle } = topoSort(
      assignedFilenames,
      (fn) => (docIndex.get(fn)?.blocks ?? []).filter((b) => sprintMap.has(b))
    );

    if (cycle) {
      return {
        error: {
          code: 'CYCLE_DETECTED',
          message: 'Dependency cycle detected in the selected assignments — cannot enforce ordering',
        },
      };
    }

    for (const filename of topoOrder) {
      const entry = docIndex.get(filename);
      if (!entry?.blocks?.length) continue;
      const aIdx = sprintIdx.get(sprintMap.get(filename) ?? '') ?? -1;
      for (const blockedFn of entry.blocks) {
        if (!sprintMap.has(blockedFn)) continue;
        const bIdx = sprintIdx.get(sprintMap.get(blockedFn) ?? '') ?? -1;
        if (aIdx >= bIdx && aIdx !== -1) {
          const newIdx = aIdx + 1;
          if (newIdx < sprintOrder.length) {
            const newSprint = sprintOrder[newIdx];
            depWarnings.push({
              blocker: filename,
              blocked: blockedFn,
              message: `Moved ${blockedFn} to ${newSprint} to maintain dependency order`,
            });
            sprintMap.set(blockedFn, newSprint);
          } else {
            depWarnings.push({
              blocker: filename,
              blocked: blockedFn,
              message: `Cannot move ${blockedFn} — no later sprint available`,
            });
          }
        }
      }
    }
  }

  type WriteItem = {
    filepath: string;
    content: string;
    filename: string;
    docType: string;
    sprint: string | undefined;
  };
  const writes: WriteItem[] = [];
  const skipped: Array<{ filename: string; reason: string }> = [];

  // Phase 1: validate and compute all patches in memory
  for (const entry of assignments) {
    try {
      const docType = assertDocType(entry.docType, TYPE_CONFIG);
      const filename = assertFilename(entry.filename);
      const cfg = TYPE_CONFIG[docType];
      const filepath = path.join(cfg.dir(), filename);
      try {
        await fs.promises.access(filepath);
      } catch (err) {
        logWarn('batch', `skipping ${filename}: file not found`, {
          error: err instanceof Error ? err.message : String(err),
        });
        skipped.push({ filename, reason: 'not found' });
        continue;
      }
      const adjustedSprint = sprintMap.get(filename) || entry.sprint;
      const content = await fs.promises.readFile(filepath, 'utf-8');
      const patched = setFrontmatterField(content, 'Sprint', adjustedSprint || 'TBD');
      writes.push({ filepath, content: patched, filename, docType, sprint: adjustedSprint });
    } catch (entryErr) {
      skipped.push({
        filename: entry.filename,
        reason: entryErr instanceof Error ? entryErr.message : 'invalid',
      });
    }
  }

  // Phase 2: flush all writes atomically
  await Promise.all(writes.map(({ filepath, content }) => fs.promises.writeFile(filepath, content)));

  const updated = writes.map(({ filename, docType, sprint }) => ({ filename, docType, sprint }));

  for (const u of updated) {
    logAudit({
      op: 'update',
      docType: u.docType,
      filename: u.filename,
      fields: { sprint: u.sprint },
      source: 'api',
    });
  }

  return { updated, skipped, warnings: depWarnings };
}

// ── batch-update-field ────────────────────────────────────────────────────────

export interface BatchUpdateFieldResult {
  updated: Array<{ filename: string; docType: string }>;
  skipped: Array<{ filename: string; reason: string }>;
}

export async function batchUpdateField(
  docs: DocItem[],
  frontmatter: string,
  newValue: string,
  field: string,
  { TYPE_CONFIG, logWarn }: Pick<BatchContext, 'TYPE_CONFIG' | 'logWarn'>
): Promise<BatchUpdateFieldResult> {
  const updated: Array<{ filename: string; docType: string }> = [];
  const skipped: Array<{ filename: string; reason: string }> = [];

  await pMap(
    docs,
    async (entry) => {
      try {
        const docType = assertDocType(entry.type, TYPE_CONFIG);
        const filename = assertFilename(entry.filename);
        const cfg = TYPE_CONFIG[docType];
        const filepath = path.join(cfg.dir(), filename);

        try {
          await fs.promises.access(filepath);
        } catch (err) {
          logWarn('batch', `skipping ${filename}: file not found`, {
            error: err instanceof Error ? err.message : String(err),
          });
          skipped.push({ filename, reason: 'not found' });
          return;
        }

        await applyDocPatch(filepath, frontmatter, newValue);
        updated.push({ filename, docType });
      } catch (entryErr) {
        skipped.push({
          filename: entry.filename,
          reason: entryErr instanceof Error ? entryErr.message : 'invalid',
        });
      }
    },
    { concurrency: BATCH_CONCURRENCY }
  );

  for (const u of updated) {
    logAudit({
      op: 'update',
      docType: u.docType,
      filename: u.filename,
      fields: { [field]: newValue },
      source: 'api',
    });
  }

  return { updated, skipped };
}
