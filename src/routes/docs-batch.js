// ── Document batch operation routes ───────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, parseApiError, assertDocType, assertFilename } from '../utils/routeHelpers.js';
import { setFrontmatterField } from '../utils/transforms.js';

export default function docsBatchRoutes({ rootDir, TYPE_CONFIG, broadcast, logInfo, docIndex }) {
  const router = Router();

  // ── POST /api/docs/batch-delete ──────────────────────────────────────────
  router.post('/api/docs/batch-delete', (req, res) => {
    try {
      const { docs } = req.body;
      if (!Array.isArray(docs) || !docs.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'docs array is required and must not be empty');
      }

      const deleted = [];
      const skipped = [];

      for (const entry of docs) {
        try {
          const docType  = assertDocType(entry.type, TYPE_CONFIG);
          const filename = assertFilename(entry.filename);
          const cfg      = TYPE_CONFIG[docType];
          const filepath = path.join(cfg.dir(), filename);

          if (!fs.existsSync(filepath)) {
            skipped.push({ filename, reason: 'not found' });
            continue;
          }

          fs.unlinkSync(filepath);
          deleted.push({ filename, docType });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr.message || 'invalid' });
        }
      }

      if (deleted.length) {
        docIndex.invalidateAll();
        broadcast({ type: 'batch_deleted', filenames: deleted.map(d => d.filename) });
      }

      logInfo('POST /api/docs/batch-delete', `Deleted ${deleted.length}, skipped ${skipped.length}`);
      res.json({ success: true, deleted: deleted.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/batch-fix-version ───────────────────────────────────────
  router.post('/api/docs/batch-fix-version', (req, res) => {
    try {
      const { fixVersion, docs } = req.body;
      if (!Array.isArray(docs) || !docs.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'docs array is required and must not be empty');
      }

      const newValue = fixVersion || 'TBD';
      const updated  = [];
      const skipped  = [];

      for (const entry of docs) {
        try {
          const docType  = assertDocType(entry.type, TYPE_CONFIG);
          const filename = assertFilename(entry.filename);
          const cfg      = TYPE_CONFIG[docType];
          const filepath = path.join(cfg.dir(), filename);

          if (!fs.existsSync(filepath)) {
            skipped.push({ filename, reason: 'not found' });
            continue;
          }

          const content = fs.readFileSync(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Fix_Version', newValue);
          fs.writeFileSync(filepath, patched);
          updated.push({ filename, docType });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr.message || 'invalid' });
        }
      }

      if (updated.length) {
        docIndex.invalidateAll();
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
  router.post('/api/docs/distribute', (req, res) => {
    try {
      const { piName } = req.body;
      if (!piName) return sendError(res, 400, 'VALIDATION_ERROR', 'piName is required');

      // Load sprint config
      const piSettingsPath = path.join(rootDir, '.pi-settings.json');
      let sprintCfg = [];
      try {
        const settings = JSON.parse(fs.readFileSync(piSettingsPath, 'utf-8'));
        sprintCfg = (settings.sprints && settings.sprints[piName]) || [];
      } catch {}
      if (!sprintCfg.length) return sendError(res, 400, 'NO_SPRINTS', 'No sprints configured for this PI');

      // Collect leaf docs in this PI using the index
      const PRIORITY_RANK = { Critical: 0, Major: 0, High: 1, Medium: 2, Low: 3 };
      const leafTypes = new Set(['story', 'spike', 'bug']);
      const leafDocs = docIndex.getAll()
        .filter(e => leafTypes.has(e.docType) && e.fixVersion === piName)
        .map(e => ({
          filename:    e.filename,
          docType:     e.docType,
          title:       e.title,
          storyPoints: e.storyPoints || 0,
          hasEstimate: !!(e.storyPoints),
          priority:    e.priority || 'Medium',
          sprint:      e.sprint || null,
        }));

      // Partition: already-assigned vs unassigned
      const assigned   = leafDocs.filter(d => d.sprint);
      const unassigned = leafDocs.filter(d => !d.sprint);

      // Sort unassigned: priority rank asc, then SP desc (big items first)
      unassigned.sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority] ?? 2;
        const pb = PRIORITY_RANK[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        return b.storyPoints - a.storyPoints;
      });

      // Build sprint buckets, pre-fill with assigned docs
      const buckets = sprintCfg.map(s => ({
        name: s.name,
        capacity: s.capacity,
        assigned: assigned.filter(d => d.sprint === s.name).map(d => ({ ...d, wasAlreadyAssigned: true })),
        usedPoints: assigned.filter(d => d.sprint === s.name).reduce((sum, d) => sum + d.storyPoints, 0),
      }));

      // Greedy fill
      const overflow = [];
      for (const doc of unassigned) {
        let placed = false;
        for (const bucket of buckets) {
          if (bucket.usedPoints + doc.storyPoints <= bucket.capacity) {
            bucket.assigned.push({ ...doc, wasAlreadyAssigned: false });
            bucket.usedPoints += doc.storyPoints;
            placed = true;
            break;
          }
        }
        if (!placed) overflow.push(doc);
      }

      // Generate warnings and suggestions
      const warnings    = [];
      const suggestions = [];
      const noEstimate  = leafDocs.filter(d => !d.hasEstimate);
      if (noEstimate.length) warnings.push(`${noEstimate.length} item(s) have no story point estimates`);
      if (overflow.length) {
        const overflowSP = overflow.reduce((s, d) => s + d.storyPoints, 0);
        warnings.push(`${overflow.length} item(s) (${overflowSP} SP) exceed total capacity`);
      }
      for (const bucket of buckets) {
        const pct = bucket.capacity > 0 ? Math.round((bucket.usedPoints / bucket.capacity) * 100) : 0;
        if (pct > 100) suggestions.push(`${bucket.name} is at ${pct}% capacity — consider moving items to a later sprint`);
        else if (pct < 50 && bucket.capacity > 0) suggestions.push(`${bucket.name} has ${bucket.capacity - bucket.usedPoints} SP free capacity`);
      }

      res.json({ piName, sprints: buckets, overflow, warnings, suggestions });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/rerank ── batch assign Rank fields ──────────────────────
  router.post('/api/docs/rerank', (req, res) => {
    try {
      const { type, orderedFilenames } = req.body;
      if (!type) return sendError(res, 400, 'VALIDATION_ERROR', 'type is required');
      if (!Array.isArray(orderedFilenames) || !orderedFilenames.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'orderedFilenames array is required and must not be empty');
      }

      const docType = assertDocType(type, TYPE_CONFIG);
      const cfg     = TYPE_CONFIG[docType];
      const updated = [];
      const skipped = [];

      for (let i = 0; i < orderedFilenames.length; i++) {
        try {
          const filename = assertFilename(orderedFilenames[i]);
          const filepath = path.join(cfg.dir(), filename);
          if (!fs.existsSync(filepath)) { skipped.push({ filename, reason: 'not found' }); continue; }
          const content = fs.readFileSync(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Rank', String(i + 1));
          fs.writeFileSync(filepath, patched);
          updated.push(filename);
        } catch (entryErr) {
          skipped.push({ filename: orderedFilenames[i], reason: entryErr.message || 'invalid' });
        }
      }

      if (updated.length) {
        docIndex.invalidateAll();
        broadcast({ type: 'title_updated', docType });
      }

      logInfo('POST /api/docs/rerank', `Ranked ${updated.length} ${docType}(s), skipped ${skipped.length}`);
      res.json({ success: true, updated: updated.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['VALIDATION_ERROR', 'INVALID_TYPE'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/apply-distribution ── batch assign sprints ──────────────
  router.post('/api/docs/apply-distribution', (req, res) => {
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
      let sprintOrder = [];
      try {
        const settings = JSON.parse(fs.readFileSync(piSettingsPath, 'utf-8'));
        for (const piSprints of Object.values(settings.sprints || {})) {
          for (const s of piSprints) {
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

      const updated = [];
      const skipped = [];

      for (const entry of assignments) {
        try {
          const docType  = assertDocType(entry.docType, TYPE_CONFIG);
          const filename = assertFilename(entry.filename);
          const cfg      = TYPE_CONFIG[docType];
          const filepath = path.join(cfg.dir(), filename);
          if (!fs.existsSync(filepath)) { skipped.push({ filename, reason: 'not found' }); continue; }

          const adjustedSprint = sprintMap.get(filename) || entry.sprint;
          const content = fs.readFileSync(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Sprint', adjustedSprint || 'TBD');
          fs.writeFileSync(filepath, patched);
          updated.push({ filename, docType, sprint: adjustedSprint });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr.message || 'invalid' });
        }
      }

      if (updated.length) {
        docIndex.invalidateAll();
        broadcast({ type: 'batch_sprint_updated', filenames: updated.map(u => u.filename) });
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
