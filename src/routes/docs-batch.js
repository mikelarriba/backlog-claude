// ── Document batch operation routes ───────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, parseApiError, assertDocType, assertFilename } from '../utils/routeHelpers.js';
import { setFrontmatterField } from '../utils/transforms.js';
import { pMap } from '../utils/pMap.js';
import { logAudit } from '../utils/auditLog.js';

const BATCH_CONCURRENCY = 5;

/** @param {import('../types.js').RouteContext} ctx */
export default function docsBatchRoutes({ rootDir, TYPE_CONFIG, broadcast, logInfo, docIndex }) {
  const router = Router();

  // ── POST /api/docs/batch-delete ──────────────────────────────────────────
  router.post('/api/docs/batch-delete', async (req, res) => {
    try {
      const { docs } = req.body;
      if (!Array.isArray(docs) || !docs.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'docs array is required and must not be empty');
      }

      /** @type {Array<{ filename: string; docType: string }>} */
      const deleted = [];
      /** @type {Array<{ filename: string; reason: string }>} */
      const skipped = [];

      await pMap(docs, async (entry) => {
        try {
          const docType  = assertDocType(entry.type, TYPE_CONFIG);
          const filename = assertFilename(entry.filename);
          const cfg      = TYPE_CONFIG[docType];
          const filepath = path.join(cfg.dir(), filename);

          try {
            await fs.promises.access(filepath);
          } catch {
            skipped.push({ filename, reason: 'not found' });
            return;
          }

          await fs.promises.unlink(filepath);
          deleted.push({ filename, docType });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr instanceof Error ? entryErr.message : 'invalid' });
        }
      }, { concurrency: BATCH_CONCURRENCY });

      // Always invalidate the index — stale entries must be purged even when
      // the file was already gone from disk (deleted === 0, skipped > 0).
      await docIndex.invalidateAll();
      broadcast({ type: 'batch_deleted', filenames: deleted.map(d => d.filename) });

      for (const d of deleted) {
        logAudit({ op: 'delete', docType: d.docType, filename: d.filename, source: 'api' });
      }
      if (skipped.length) {
        logInfo('POST /api/docs/batch-delete', `Skipped entries: ${JSON.stringify(skipped)}`);
      }
      logInfo('POST /api/docs/batch-delete', `Deleted ${deleted.length}, skipped ${skipped.length}`);
      res.json({ success: true, deleted: deleted.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/batch-fix-version ───────────────────────────────────────
  router.post('/api/docs/batch-fix-version', async (req, res) => {
    try {
      const { fixVersion, docs } = req.body;
      if (!Array.isArray(docs) || !docs.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'docs array is required and must not be empty');
      }

      const newValue = fixVersion || 'TBD';
      /** @type {Array<{ filename: string; docType: string }>} */
      const updated  = [];
      /** @type {Array<{ filename: string; reason: string }>} */
      const skipped  = [];

      await pMap(docs, async (entry) => {
        try {
          const docType  = assertDocType(entry.type, TYPE_CONFIG);
          const filename = assertFilename(entry.filename);
          const cfg      = TYPE_CONFIG[docType];
          const filepath = path.join(cfg.dir(), filename);

          try {
            await fs.promises.access(filepath);
          } catch {
            skipped.push({ filename, reason: 'not found' });
            return;
          }

          const content = await fs.promises.readFile(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Fix_Version', newValue);
          await fs.promises.writeFile(filepath, patched);
          updated.push({ filename, docType });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr instanceof Error ? entryErr.message : 'invalid' });
        }
      }, { concurrency: BATCH_CONCURRENCY });

      if (updated.length) {
        await docIndex.invalidateAll();
        broadcast({ type: 'batch_fix_version_updated', fixVersion: newValue, filenames: updated.map(u => u.filename) });
      }

      logInfo('POST /api/docs/batch-fix-version', `Updated ${updated.length}, skipped ${skipped.length}`, { fixVersion: newValue });
      res.json({ success: true, updated: updated.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/distribute ── propose sprint assignments ─────────────────
  router.post('/api/docs/distribute', async (req, res) => {
    try {
      const { piName } = req.body;
      if (!piName) return sendError(res, 400, 'VALIDATION_ERROR', 'piName is required');

      // Load sprint config
      const piSettingsPath = path.join(rootDir, '.pi-settings.json');
      /** @type {Array<{ name: string; capacity: number }>} */
      let sprintCfg = [];
      try {
        const raw = await fs.promises.readFile(piSettingsPath, 'utf-8');
        const settings = JSON.parse(raw);
        sprintCfg = (settings.sprints && settings.sprints[piName]) || [];
      } catch {}
      if (!sprintCfg.length) return sendError(res, 400, 'NO_SPRINTS', 'No sprints configured for this PI');

      // Collect leaf docs in this PI using the index (includes rank, blockedBy, parentFilename)
      /** @type {Record<string, number>} */
      const PRIORITY_RANK = { Critical: 0, Major: 0, High: 1, Medium: 2, Low: 3 };
      const leafTypes = new Set(['story', 'spike', 'bug']);
      const leafDocs = docIndex.getAll()
        .filter(e => leafTypes.has(e.docType) && e.fixVersion === piName)
        .map(e => ({
          filename:       e.filename,
          docType:        e.docType,
          title:          e.title,
          storyPoints:    e.storyPoints || 0,
          hasEstimate:    !!(e.storyPoints),
          priority:       e.priority || 'Medium',
          sprint:         e.sprint || null,
          rank:           e.rank != null ? e.rank : 9999,
          parentFilename: e.parentFilename || null,
          blockedBy:      e.blockedBy || [],
          blocks:         e.blocks    || [],
          parallel:       e.parallel  || [],
        }));

      // Partition: already-assigned vs unassigned
      const assigned   = leafDocs.filter(d => d.sprint);
      const unassigned = leafDocs.filter(d => !d.sprint);

      /**
       * @param {{ rank: number; priority: string; storyPoints: number }} a
       * @param {{ rank: number; priority: string; storyPoints: number }} b
       */
      function sortByRankPriority(a, b) {
        if (a.rank !== b.rank) return a.rank - b.rank;
        const pa = PRIORITY_RANK[a.priority] ?? 2;
        const pb = PRIORITY_RANK[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        return b.storyPoints - a.storyPoints;
      }

      // ── Group unassigned by parent epic to maximise epic completion ──────────
      // Strategy: sort epic groups by the epic's own rank (matching main list
      // view order, top-to-bottom), then emit all stories from that epic
      // before moving to the next group.
      const epicGroups  = new Map(); // parentFilename → doc[]
      const standalones = [];
      for (const doc of unassigned) {
        if (doc.parentFilename) {
          if (!epicGroups.has(doc.parentFilename)) epicGroups.set(doc.parentFilename, []);
          epicGroups.get(doc.parentFilename).push(doc);
        } else {
          standalones.push(doc);
        }
      }

      // Sort each epic group internally
      for (const [, docs] of epicGroups) docs.sort(sortByRankPriority);

      // Build epic rank lookup from the index (same order as the main list view)
      const epicRankMap = new Map();
      for (const e of docIndex.getAll()) {
        if (e.docType === 'epic' || e.docType === 'feature') {
          epicRankMap.set(e.filename, e.rank != null ? e.rank : 9999);
        }
      }

      // Sort epic groups by the epic's own rank (list view order)
      const sortedGroups = [...epicGroups.entries()].sort(([fnA], [fnB]) => {
        const ra = epicRankMap.get(fnA) ?? 9999;
        const rb = epicRankMap.get(fnB) ?? 9999;
        if (ra !== rb) return ra - rb;
        return fnB.localeCompare(fnA); // fallback: same as _rankSortFn
      }).map(([, docs]) => docs);

      standalones.sort(sortByRankPriority);

      // Build ordered work queue: grouped epics first, then standalones
      // Unestimated items are routed directly to overflow — they are not
      // sprint-ready and must not be silently placed in Sprint 1.
      const workQueue    = [];
      const noEstimateOverflow = [];
      for (const docs of sortedGroups) {
        for (const d of docs) {
          if (d.hasEstimate) workQueue.push(d); else noEstimateOverflow.push(d);
        }
      }
      for (const d of standalones) {
        if (d.hasEstimate) workQueue.push(d); else noEstimateOverflow.push(d);
      }

      // ── Build buckets; pre-fill with already-assigned docs ───────────────────
      const buckets = sprintCfg.map((/** @type {{ name: string; capacity: number }} */ s, idx) => ({
        name:       s.name,
        capacity:   s.capacity,
        idx,
        assigned:   assigned.filter(d => d.sprint === s.name).map(d => ({ ...d, wasAlreadyAssigned: true })),
        usedPoints: assigned.filter(d => d.sprint === s.name).reduce((sum, d) => sum + d.storyPoints, 0),
      }));

      const sprintIdx    = new Map(buckets.map(b => [b.name, b.idx]));
      // Track placed sprint for dep constraint computation (seed with already-assigned)
      const placementMap = new Map(assigned.map(d => [d.filename, d.sprint]));
      /** @type {string[]} */
      const depAdjusted  = []; // warnings for items bumped due to deps

      // Track per-epic sprint range: try to finish each epic within 2 sprints
      const epicStartSprint = new Map(); // parentFilename → first sprint index
      // Seed from already-assigned items
      for (const d of assigned) {
        if (!d.parentFilename) continue;
        const si = sprintIdx.get(d.sprint) ?? 0;
        if (!epicStartSprint.has(d.parentFilename) || si < epicStartSprint.get(d.parentFilename)) {
          epicStartSprint.set(d.parentFilename, si);
        }
      }

      // ── Greedy fill with dep-constraint floor + 2-sprint epic window ─────────
      const overflow = [...noEstimateOverflow];
      for (const doc of workQueue) {
        // Compute the minimum allowed sprint index from dependency constraints
        let minIdx = 0;
        for (const blockerFn of doc.blockedBy) {
          const blockerSprint = placementMap.get(blockerFn);
          if (blockerSprint != null) {
            const bi = sprintIdx.get(blockerSprint) ?? -1;
            if (bi + 1 > minIdx) minIdx = bi + 1;
          }
        }

        // Prefer the same sprint as already-placed parallel siblings (co-location)
        let preferredIdx = minIdx;
        for (const siblingFn of (doc.parallel || [])) {
          const sibSprint = placementMap.get(siblingFn);
          if (sibSprint != null) {
            preferredIdx = Math.max(preferredIdx, sprintIdx.get(sibSprint) ?? 0);
          }
        }

        // 2-sprint epic window (soft preference): prefer finishing an epic
        // within 2 sprints (deploy cadence), but allow spillover to later
        // sprints if the preferred window has no capacity.
        const hardMaxIdx = buckets.length - 1;
        let softMaxIdx = hardMaxIdx;
        if (doc.parentFilename) {
          const start = epicStartSprint.get(doc.parentFilename);
          if (start != null) {
            softMaxIdx = Math.min(hardMaxIdx, start + 1);
          }
        }

        // Place in the first bucket at or after preferredIdx.
        // Pass 1: try within preferred 2-sprint window.
        // Pass 2: if no capacity, allow any later sprint.
        let placed = false;
        for (const bucket of buckets) {
          if (bucket.idx < preferredIdx) continue;
          if (bucket.idx > softMaxIdx) break;
          if (bucket.usedPoints + doc.storyPoints <= bucket.capacity) {
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
        // Pass 2: spill beyond the 2-sprint window if needed
        if (!placed) {
          for (const bucket of buckets) {
            if (bucket.idx <= softMaxIdx) continue;
            if (bucket.idx < minIdx) continue;
            if (bucket.idx > hardMaxIdx) break;
            if (bucket.usedPoints + doc.storyPoints <= bucket.capacity) {
              depAdjusted.push(`"${doc.title}" spilled beyond preferred 2-sprint window into ${bucket.name}`);
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

      // ── Advisory warnings for parallel siblings in different sprints ────────
      const seenParallelPairs = new Set();
      for (const doc of workQueue) {
        const docSprint = placementMap.get(doc.filename);
        if (!docSprint) continue;
        for (const siblingFn of (doc.parallel || [])) {
          const pairKey = [doc.filename, siblingFn].sort().join('|');
          if (seenParallelPairs.has(pairKey)) continue;
          seenParallelPairs.add(pairKey);
          const sibSprint = placementMap.get(siblingFn);
          if (sibSprint && sibSprint !== docSprint) {
            depAdjusted.push(`Parallel stories "${doc.title}" (${docSprint}) and "${siblingFn}" (${sibSprint}) could not be co-located`);
          }
        }
      }

      // ── Warnings and suggestions ─────────────────────────────────────────────
      const warnings    = [];
      const suggestions = [];
      if (noEstimateOverflow.length) warnings.push(`${noEstimateOverflow.length} item(s) have no story point estimate — add story points before distributing`);
      if (depAdjusted.length) warnings.push(...depAdjusted);
      const capacityOverflow = overflow.filter(d => d.hasEstimate);
      if (capacityOverflow.length) {
        const overflowSP = capacityOverflow.reduce((s, d) => s + d.storyPoints, 0);
        warnings.push(`${capacityOverflow.length} item(s) (${overflowSP} SP) exceed total sprint capacity`);
      }
      for (const bucket of buckets) {
        const pct = bucket.capacity > 0 ? Math.round((bucket.usedPoints / bucket.capacity) * 100) : 0;
        if (pct > 100) suggestions.push(`${bucket.name} is over capacity at ${pct}% — consider moving items to a later sprint`);
        else if (pct < 50 && bucket.capacity > 0) suggestions.push(`${bucket.name} has ${bucket.capacity - bucket.usedPoints} SP of free capacity`);
      }

      res.json({ piName, sprints: buckets, overflow, warnings, suggestions });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/rerank ── batch assign Rank fields ──────────────────────
  router.post('/api/docs/rerank', async (req, res) => {
    try {
      const { type, orderedFilenames } = req.body;
      if (!type) return sendError(res, 400, 'VALIDATION_ERROR', 'type is required');
      if (!Array.isArray(orderedFilenames) || !orderedFilenames.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'orderedFilenames array is required and must not be empty');
      }

      const docType = assertDocType(type, TYPE_CONFIG);
      const cfg     = TYPE_CONFIG[docType];
      /** @type {string[]} */
      const updated = [];
      /** @type {Array<{ filename: string; reason: string }>} */
      const skipped = [];

      await pMap(orderedFilenames, async (rawFilename, i) => {
        try {
          const filename = assertFilename(rawFilename);
          const filepath = path.join(cfg.dir(), filename);
          try {
            await fs.promises.access(filepath);
          } catch {
            skipped.push({ filename, reason: 'not found' });
            return;
          }
          const content = await fs.promises.readFile(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Rank', String(i + 1));
          await fs.promises.writeFile(filepath, patched);
          updated.push(filename);
        } catch (entryErr) {
          skipped.push({ filename: rawFilename, reason: entryErr instanceof Error ? entryErr.message : 'invalid' });
        }
      }, { concurrency: BATCH_CONCURRENCY });

      if (updated.length) {
        await docIndex.invalidateAll();
        broadcast({ type: 'title_updated', docType });
      }

      logInfo('POST /api/docs/rerank', `Ranked ${updated.length} ${docType}(s), skipped ${skipped.length}`);
      res.json({ success: true, updated: updated.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['VALIDATION_ERROR', 'INVALID_TYPE'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/rerank-canvas ── assign ranks from canvas grid positions ─
  router.post('/api/docs/rerank-canvas', async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || !items.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'items array is required and must not be empty');
      }

      /** @type {string[]} */
      const updated = [];
      /** @type {Array<{ filename: string; reason: string }>} */
      const skipped = [];

      await pMap(items, async (item) => {
        try {
          if (!item.filename || !item.docType || typeof item.rank !== 'number') {
            skipped.push({ filename: item.filename || '?', reason: 'missing filename, docType, or rank' });
            return;
          }
          const docType  = assertDocType(item.docType, TYPE_CONFIG);
          const filename = assertFilename(item.filename);
          const cfg      = TYPE_CONFIG[docType];
          const filepath = path.join(cfg.dir(), filename);
          try {
            await fs.promises.access(filepath);
          } catch {
            skipped.push({ filename, reason: 'not found' });
            return;
          }

          const content = await fs.promises.readFile(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Rank', String(item.rank));
          await fs.promises.writeFile(filepath, patched);
          updated.push(filename);
        } catch (entryErr) {
          skipped.push({ filename: item.filename, reason: entryErr instanceof Error ? entryErr.message : 'invalid' });
        }
      }, { concurrency: BATCH_CONCURRENCY });

      if (updated.length) {
        await docIndex.invalidateAll();
        broadcast({ type: 'title_updated' });
      }

      logInfo('POST /api/docs/rerank-canvas', `Ranked ${updated.length} item(s) from canvas, skipped ${skipped.length}`);
      res.json({ success: true, updated: updated.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['VALIDATION_ERROR'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/apply-distribution ── batch assign sprints ──────────────
  router.post('/api/docs/apply-distribution', async (req, res) => {
    try {
      const { assignments } = req.body;
      if (!Array.isArray(assignments) || !assignments.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'assignments array is required');
      }

      for (const entry of assignments) {
        if (typeof entry.docType !== 'string' || typeof entry.filename !== 'string' || typeof entry.sprint !== 'string') {
          return sendError(res, 400, 'VALIDATION_ERROR', 'Each assignment must have docType, filename, and sprint as strings');
        }
      }

      // Build a global sprint order from .pi-settings.json so we can enforce dependency ordering
      const piSettingsPath = path.join(rootDir, '.pi-settings.json');
      /** @type {string[]} */
      let sprintOrder = [];
      try {
        const raw = await fs.promises.readFile(piSettingsPath, 'utf-8');
        const settings = JSON.parse(raw);
        for (const piSprints of Object.values(settings.sprints || {})) {
          for (const s of /** @type {Array<{ name: string }>} */ (piSprints)) {
            if (!sprintOrder.includes(s.name)) sprintOrder.push(s.name);
          }
        }
      } catch { /* no pi-settings, skip dependency enforcement */ }

      // Mutable sprint map: filename → sprint
      const sprintMap = new Map(assignments.map(a => [a.filename, a.sprint]));
      const depWarnings = [];

      if (sprintOrder.length) {
        const sprintIdx = new Map(sprintOrder.map((s, i) => [s, i]));
        let changed = true;
        let iter = 0;
        while (changed && iter++ < 30) {
          changed = false;
          for (const [filename, sprint] of sprintMap) {
            const entry = docIndex.get(filename);
            if (!entry?.blocks?.length) continue;
            const aIdx = sprintIdx.get(sprint) ?? -1;
            for (const blockedFn of entry.blocks) {
              if (!sprintMap.has(blockedFn)) continue;
              const bIdx = sprintIdx.get(sprintMap.get(blockedFn)) ?? -1;
              if (aIdx >= bIdx && aIdx !== -1) {
                const newIdx = aIdx + 1;
                if (newIdx < sprintOrder.length) {
                  const newSprint = sprintOrder[newIdx];
                  depWarnings.push({ blocker: filename, blocked: blockedFn, message: `Moved ${blockedFn} to ${newSprint} to maintain dependency order` });
                  sprintMap.set(blockedFn, newSprint);
                  changed = true;
                } else {
                  depWarnings.push({ blocker: filename, blocked: blockedFn, message: `Cannot move ${blockedFn} — no later sprint available` });
                }
              }
            }
          }
        }
      }

      /** @type {Array<{ filename: string; docType: string; sprint: string | undefined }>} */
      const updated = [];
      /** @type {Array<{ filename: string; reason: string }>} */
      const skipped = [];

      await pMap(assignments, async (entry) => {
        try {
          const docType  = assertDocType(entry.docType, TYPE_CONFIG);
          const filename = assertFilename(entry.filename);
          const cfg      = TYPE_CONFIG[docType];
          const filepath = path.join(cfg.dir(), filename);
          try {
            await fs.promises.access(filepath);
          } catch {
            skipped.push({ filename, reason: 'not found' });
            return;
          }

          const adjustedSprint = sprintMap.get(filename) || entry.sprint;
          const content = await fs.promises.readFile(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Sprint', adjustedSprint || 'TBD');
          await fs.promises.writeFile(filepath, patched);
          updated.push({ filename, docType, sprint: adjustedSprint });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr instanceof Error ? entryErr.message : 'invalid' });
        }
      }, { concurrency: BATCH_CONCURRENCY });

      if (updated.length) {
        await docIndex.invalidateAll();
        broadcast({ type: 'batch_sprint_updated', filenames: updated.map(u => u.filename) });
      }

      for (const u of updated) {
        logAudit({ op: 'update', docType: u.docType, filename: u.filename, fields: { sprint: u.sprint }, source: 'api' });
      }
      logInfo('POST /api/docs/apply-distribution', `Assigned ${updated.length} item(s), skipped ${skipped.length}`);
      res.json({ success: true, updated: updated.length, skipped, assignments: updated, warnings: depWarnings });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
