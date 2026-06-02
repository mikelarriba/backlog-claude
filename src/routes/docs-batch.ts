// ── Document batch operation routes ───────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, parseApiError, assertDocType, assertFilename } from '../utils/routeHelpers.js';
import { setFrontmatterField } from '../utils/transforms.js';
import { pMap } from '../utils/pMap.js';
import { logAudit } from '../utils/auditLog.js';
import { TEAMS, WORK_CATEGORIES } from '../config/metadata.js';
import { proposeDistribution } from '../services/distributionService.js';
import type { DistributionDoc } from '../services/distributionService.js';
import type { RouteContext } from '../types.js';

const BATCH_CONCURRENCY = 5;

export default function docsBatchRoutes({ rootDir, TYPE_CONFIG, broadcast, logInfo, docIndex }: RouteContext) {
  const router = Router();

  // ── POST /api/docs/batch-delete ──────────────────────────────────────────
  router.post('/api/docs/batch-delete', async (req, res) => {
    try {
      const { docs } = req.body;
      if (!Array.isArray(docs) || !docs.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'docs array is required and must not be empty');
      }

      const deleted: Array<{ filename: string; docType: string }> = [];
      const skipped: Array<{ filename: string; reason: string }> = [];

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
      const updated: Array<{ filename: string; docType: string }> = [];
      const skipped: Array<{ filename: string; reason: string }> = [];

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

      const piSettingsPath = path.join(rootDir, '.pi-settings.json');
      let sprintCfg: Array<{ name: string; capacity: number; bufferPct?: number }> = [];
      try {
        const raw = await fs.promises.readFile(piSettingsPath, 'utf-8');
        const settings = JSON.parse(raw);
        const defaultBufferPct = settings.defaultBufferPct ?? 0;
        sprintCfg = (settings.sprints && settings.sprints[piName]) || [];
        // Enrich each sprint with bufferPct
        sprintCfg = sprintCfg.map(s => ({
          ...s,
          bufferPct: s.bufferPct ?? defaultBufferPct,
        }));
      } catch {}
      if (!sprintCfg.length) return sendError(res, 400, 'NO_SPRINTS', 'No sprints configured for this PI');

      const leafTypes = new Set(['story', 'spike', 'bug']);
      const leafDocs: DistributionDoc[] = docIndex.getAll()
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

      const epicRankMap = new Map<string, number>();
      for (const e of docIndex.getAll()) {
        if (e.docType === 'epic' || e.docType === 'feature') {
          epicRankMap.set(e.filename, e.rank != null ? e.rank : 9999);
        }
      }

      const result = proposeDistribution(leafDocs, sprintCfg, epicRankMap);
      res.json({ piName, ...result });
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
      const updated: string[] = [];
      const skipped: Array<{ filename: string; reason: string }> = [];

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

      const updated: string[] = [];
      const skipped: Array<{ filename: string; reason: string }> = [];

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
      let sprintOrder: string[] = [];
      try {
        const raw = await fs.promises.readFile(piSettingsPath, 'utf-8');
        const settings = JSON.parse(raw);
        for (const piSprints of Object.values(settings.sprints || {})) {
          for (const s of (piSprints as Array<{ name: string }>) ) {
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

      const updated: Array<{ filename: string; docType: string; sprint: string | undefined }> = [];
      const skipped: Array<{ filename: string; reason: string }> = [];

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

  // ── POST /api/docs/batch-update-field ── bulk assign sprint/team/category ──
  const BATCH_FIELD_MAP: Record<string, { frontmatter: string; allowed: string[] | null }> = {
    sprint:       { frontmatter: 'Sprint',        allowed: null },
    team:         { frontmatter: 'Team',          allowed: TEAMS },
    workCategory: { frontmatter: 'Work_Category', allowed: WORK_CATEGORIES },
  };

  router.post('/api/docs/batch-update-field', async (req, res) => {
    try {
      const { field, value, docs } = req.body;
      const validFields = ['sprint', 'team', 'workCategory'] as const;
      if (!field || !validFields.includes(field)) {
        return sendError(res, 400, 'VALIDATION_ERROR', `field must be one of: ${validFields.join(', ')}`);
      }
      if (!Array.isArray(docs) || !docs.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'docs array is required and must not be empty');
      }

      const { frontmatter, allowed } = BATCH_FIELD_MAP[field as 'sprint' | 'team' | 'workCategory'];
      const newValue = value || 'TBD';
      if (allowed && newValue !== 'TBD' && !allowed.includes(newValue)) {
        return sendError(res, 400, 'VALIDATION_ERROR', `${field} must be one of: ${allowed.join(', ')}, TBD`);
      }

      const updated: Array<{ filename: string; docType: string }> = [];
      const skipped: Array<{ filename: string; reason: string }> = [];

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
          const patched = setFrontmatterField(content, frontmatter, newValue);
          await fs.promises.writeFile(filepath, patched);
          updated.push({ filename, docType });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr instanceof Error ? entryErr.message : 'invalid' });
        }
      }, { concurrency: BATCH_CONCURRENCY });

      if (updated.length) {
        await docIndex.invalidateAll();
        broadcast({ type: 'batch_field_updated', field, value: newValue, filenames: updated.map(u => u.filename) });
      }

      for (const u of updated) {
        logAudit({ op: 'update', docType: u.docType, filename: u.filename, fields: { [field]: newValue }, source: 'api' });
      }
      logInfo('POST /api/docs/batch-update-field', `Updated ${updated.length} ${field}→${newValue}, skipped ${skipped.length}`);
      res.json({ success: true, updated: updated.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
