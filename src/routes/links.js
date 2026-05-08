// ── Hierarchy & linking routes ────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, parseApiError, assertDocType, assertFilename, normalizeType } from '../utils/routeHelpers.js';
import { setFrontmatterField, extractFrontmatterField } from '../utils/transforms.js';

export default function linksRoutes({ TYPE_CONFIG, FEATURES_DIR, EPICS_DIR, STORIES_DIR, SPIKES_DIR, BUGS_DIR, broadcast, logInfo, docIndex }) {
  const router = Router();

  // ── GET /api/links/:type/:filename ─────────────────────────────────────────
  router.get('/api/links/:type/:filename', (req, res) => {
    try {
      const docType  = assertDocType(req.params.type, TYPE_CONFIG);
      const filename = assertFilename(req.params.filename);

      let parent   = null;
      let children = [];

      if (docType === 'epic') {
        // Resolve parent feature from the index
        const epicEntry = docIndex.get(filename);
        if (epicEntry?.parentFilename) {
          const parentEntry = docIndex.get(epicEntry.parentFilename);
          if (parentEntry) {
            parent = {
              docType: 'feature',
              filename: epicEntry.parentFilename,
              title:  parentEntry.title,
              jiraId: parentEntry.jiraId || 'TBD',
              status: parentEntry.status || 'Draft',
            };
          }
        }

        // Resolve children (stories, spikes, bugs) from the index
        children = docIndex.getAll()
          .filter(e => ['story', 'spike', 'bug'].includes(e.docType) && e.parentFilename === filename)
          .map(e => ({
            docType: e.docType, filename: e.filename,
            title:  e.title,
            jiraId: e.jiraId || 'TBD',
            status: e.status || 'Draft',
          }));
      } else if (docType === 'feature') {
        // Resolve children (epics) from the index
        children = docIndex.getAll()
          .filter(e => e.docType === 'epic' && e.parentFilename === filename)
          .map(e => ({
            docType: 'epic', filename: e.filename,
            title:  e.title,
            jiraId: e.jiraId || 'TBD',
            status: e.status || 'Draft',
          }));
      }

      // Resolve block dependencies from the index
      const entry = docIndex.get(filename);
      const blocks    = (entry?.blocks    || []).map(fn => {
        const e = docIndex.get(fn);
        return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
      });
      const blockedBy = (entry?.blockedBy || []).map(fn => {
        const e = docIndex.get(fn);
        return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
      });

      res.json({ parent, children, blocks, blockedBy });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/link ─────────────────────────────────────────────────────────
  router.post('/api/link', (req, res) => {
    const LINK_RULES = {
      'epic→feature': { field: 'Feature_ID', sourceDir: () => EPICS_DIR,   targetDir: () => FEATURES_DIR },
      'story→epic':   { field: 'Epic_ID',    sourceDir: () => STORIES_DIR, targetDir: () => EPICS_DIR    },
      'spike→epic':   { field: 'Epic_ID',    sourceDir: () => SPIKES_DIR,  targetDir: () => EPICS_DIR    },
      'bug→epic':     { field: 'Epic_ID',    sourceDir: () => BUGS_DIR,    targetDir: () => EPICS_DIR    },
    };

    try {
      const { sourceType, sourceFilename, targetType, targetFilename, linkType } = req.body;
      if (
        typeof sourceType !== 'string' || !sourceType ||
        typeof sourceFilename !== 'string' || !sourceFilename ||
        typeof targetType !== 'string' || !targetType ||
        typeof targetFilename !== 'string' || !targetFilename
      ) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'sourceType, sourceFilename, targetType and targetFilename are required');
      }

      const srcFile = assertFilename(sourceFilename);
      const tgtFile = assertFilename(targetFilename);

      // ── Blocks link (dependency) ────────────────────────────────────────────
      if (linkType === 'blocks') {
        const srcType = normalizeType(sourceType);
        const tgtType = normalizeType(targetType);
        const srcCfg  = TYPE_CONFIG[srcType];
        const tgtCfg  = TYPE_CONFIG[tgtType];
        if (!srcCfg) return sendError(res, 400, 'INVALID_TYPE', `Unknown type: ${sourceType}`);
        if (!tgtCfg) return sendError(res, 400, 'INVALID_TYPE', `Unknown type: ${targetType}`);
        if (srcFile === tgtFile) return sendError(res, 400, 'INVALID_LINK', 'A story cannot block itself');

        const srcPath = path.join(srcCfg.dir(), srcFile);
        const tgtPath = path.join(tgtCfg.dir(), tgtFile);
        if (!fs.existsSync(srcPath)) return sendError(res, 404, 'NOT_FOUND', 'Source document not found');
        if (!fs.existsSync(tgtPath)) return sendError(res, 404, 'NOT_FOUND', 'Target document not found');

        // Cycle detection: DFS from tgtFile following Blocks links; error if we reach srcFile
        function detectCycle(startFile, searchFor, visited = new Set()) {
          if (visited.has(startFile)) return false;
          visited.add(startFile);
          const entry = docIndex.get(startFile);
          for (const blocked of (entry?.blocks || [])) {
            if (blocked === searchFor) return true;
            if (detectCycle(blocked, searchFor, visited)) return true;
          }
          return false;
        }
        if (detectCycle(tgtFile, srcFile)) {
          return sendError(res, 400, 'CYCLE_DETECTED', `Adding this dependency would create a cycle: ${tgtFile} already (directly or transitively) blocks ${srcFile}`);
        }

        // Update Blocks on source (append if not already present)
        const srcContent  = fs.readFileSync(srcPath, 'utf-8');
        const existBlocks = extractFrontmatterField(srcContent, 'Blocks') || '';
        const blocksList  = existBlocks.split(',').map(s => s.trim()).filter(Boolean);
        if (!blocksList.includes(tgtFile)) {
          blocksList.push(tgtFile);
          const updatedSrc = setFrontmatterField(srcContent, 'Blocks', blocksList.join(', '));
          fs.writeFileSync(srcPath, updatedSrc);
          docIndex.invalidate(srcType, srcFile);
        }

        // Update Blocked_By on target (append if not already present)
        const tgtContent     = fs.readFileSync(tgtPath, 'utf-8');
        const existBlockedBy = extractFrontmatterField(tgtContent, 'Blocked_By') || '';
        const blockedByList  = existBlockedBy.split(',').map(s => s.trim()).filter(Boolean);
        if (!blockedByList.includes(srcFile)) {
          blockedByList.push(srcFile);
          const updatedTgt = setFrontmatterField(tgtContent, 'Blocked_By', blockedByList.join(', '));
          fs.writeFileSync(tgtPath, updatedTgt);
          docIndex.invalidate(tgtType, tgtFile);
        }

        broadcast({ type: 'link_updated', linkType: 'blocks', sourceFilename: srcFile, targetFilename: tgtFile });
        logInfo('POST /api/link', `${srcFile} blocks ${tgtFile}`);
        return res.json({ success: true, linkType: 'blocks', sourceFilename: srcFile, targetFilename: tgtFile });
      }

      // ── Hierarchy link (existing behaviour) ────────────────────────────────
      const key  = `${normalizeType(sourceType)}→${normalizeType(targetType)}`;
      const rule = LINK_RULES[key];
      if (!rule) {
        return sendError(res, 400, 'INVALID_LINK', `Cannot link ${sourceType} → ${targetType}`, {
          allowed: Object.keys(LINK_RULES),
        });
      }

      const srcPath = path.join(rule.sourceDir(), srcFile);
      const tgtPath = path.join(rule.targetDir(), tgtFile);

      if (!fs.existsSync(srcPath)) return sendError(res, 404, 'NOT_FOUND', 'Source document not found');
      if (!fs.existsSync(tgtPath)) return sendError(res, 404, 'NOT_FOUND', 'Target document not found');

      const content = fs.readFileSync(srcPath, 'utf-8');
      const updated = setFrontmatterField(content, rule.field, tgtFile);
      fs.writeFileSync(srcPath, updated);
      docIndex.invalidate(normalizeType(sourceType), srcFile);

      broadcast({ type: 'link_updated', sourceType, sourceFilename: srcFile, targetType, targetFilename: tgtFile });
      logInfo('POST /api/link', `${srcFile} → ${tgtFile} (${rule.field})`);
      res.json({ success: true, field: rule.field, targetFilename: tgtFile });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── DELETE /api/link ── remove a blocks dependency ─────────────────────────
  router.delete('/api/link', (req, res) => {
    try {
      const { sourceType, sourceFilename, targetType, targetFilename, linkType } = req.body;
      if (linkType !== 'blocks') {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Only linkType "blocks" supports DELETE');
      }
      if (
        typeof sourceFilename !== 'string' || !sourceFilename ||
        typeof targetFilename !== 'string' || !targetFilename
      ) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'sourceFilename and targetFilename are required');
      }

      const srcType = normalizeType(sourceType || 'story');
      const tgtType = normalizeType(targetType || 'story');
      const srcFile = assertFilename(sourceFilename);
      const tgtFile = assertFilename(targetFilename);
      const srcCfg  = TYPE_CONFIG[srcType];
      const tgtCfg  = TYPE_CONFIG[tgtType];

      const srcPath = srcCfg ? path.join(srcCfg.dir(), srcFile) : null;
      const tgtPath = tgtCfg ? path.join(tgtCfg.dir(), tgtFile) : null;

      // Remove from Blocks on source
      if (srcPath && fs.existsSync(srcPath)) {
        const srcContent = fs.readFileSync(srcPath, 'utf-8');
        const existing   = extractFrontmatterField(srcContent, 'Blocks') || '';
        const filtered   = existing.split(',').map(s => s.trim()).filter(s => s && s !== tgtFile);
        const updated    = setFrontmatterField(srcContent, 'Blocks', filtered.length ? filtered.join(', ') : 'TBD');
        fs.writeFileSync(srcPath, updated);
        docIndex.invalidate(srcType, srcFile);
      }

      // Remove from Blocked_By on target
      if (tgtPath && fs.existsSync(tgtPath)) {
        const tgtContent = fs.readFileSync(tgtPath, 'utf-8');
        const existing   = extractFrontmatterField(tgtContent, 'Blocked_By') || '';
        const filtered   = existing.split(',').map(s => s.trim()).filter(s => s && s !== srcFile);
        const updated    = setFrontmatterField(tgtContent, 'Blocked_By', filtered.length ? filtered.join(', ') : 'TBD');
        fs.writeFileSync(tgtPath, updated);
        docIndex.invalidate(tgtType, tgtFile);
      }

      broadcast({ type: 'link_updated', linkType: 'blocks', sourceFilename: srcFile, targetFilename: tgtFile });
      logInfo('DELETE /api/link', `removed blocks: ${srcFile} → ${tgtFile}`);
      res.json({ success: true });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
