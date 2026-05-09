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

      // Resolve blocks and blockedBy from the index
      const entry = docIndex.get(filename);
      const blocks    = (entry?.blocks    || []).map(fn => {
        const e = docIndex.get(fn);
        return { filename: fn, title: e?.title || fn, docType: e?.docType || 'story' };
      });
      const blockedBy = (entry?.blockedBy || []).map(fn => {
        const e = docIndex.get(fn);
        return { filename: fn, title: e?.title || fn, docType: e?.docType || 'story' };
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

      // ── blocks dependency link ─────────────────────────────────────────────
      if (linkType === 'blocks') {
        const srcType = assertDocType(normalizeType(sourceType), TYPE_CONFIG);
        const tgtType = assertDocType(normalizeType(targetType), TYPE_CONFIG);
        const srcFile = assertFilename(sourceFilename);
        const tgtFile = assertFilename(targetFilename);
        const srcPath = path.join(TYPE_CONFIG[srcType].dir(), srcFile);
        const tgtPath = path.join(TYPE_CONFIG[tgtType].dir(), tgtFile);

        if (!fs.existsSync(srcPath)) return sendError(res, 404, 'NOT_FOUND', 'Source document not found');
        if (!fs.existsSync(tgtPath)) return sendError(res, 404, 'NOT_FOUND', 'Target document not found');
        if (srcFile === tgtFile) return sendError(res, 400, 'INVALID_LINK', 'A story cannot block itself');

        // Cycle detection: BFS from target following Blocks links
        // If we reach source, this new link would create a cycle
        const visited = new Set();
        const queue   = [tgtFile];
        while (queue.length) {
          const fn = queue.shift();
          if (fn === srcFile) {
            return sendError(res, 400, 'CYCLE_DETECTED', `This dependency would create a cycle: ${srcFile} → … → ${srcFile}`);
          }
          if (visited.has(fn)) continue;
          visited.add(fn);
          for (const blocked of (docIndex.get(fn)?.blocks || [])) queue.push(blocked);
        }

        // Append tgtFile to source's Blocks field
        const srcContent = fs.readFileSync(srcPath, 'utf-8');
        const existingBlocks = extractFrontmatterField(srcContent, 'Blocks');
        const blocksArr = existingBlocks ? existingBlocks.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (!blocksArr.includes(tgtFile)) {
          blocksArr.push(tgtFile);
          fs.writeFileSync(srcPath, setFrontmatterField(srcContent, 'Blocks', blocksArr.join(', ')));
          docIndex.invalidate(srcType, srcFile);
        }

        // Append srcFile to target's Blocked_By field
        const tgtContent = fs.readFileSync(tgtPath, 'utf-8');
        const existingBlockedBy = extractFrontmatterField(tgtContent, 'Blocked_By');
        const blockedByArr = existingBlockedBy ? existingBlockedBy.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (!blockedByArr.includes(srcFile)) {
          blockedByArr.push(srcFile);
          fs.writeFileSync(tgtPath, setFrontmatterField(tgtContent, 'Blocked_By', blockedByArr.join(', ')));
          docIndex.invalidate(tgtType, tgtFile);
        }

        broadcast({ type: 'link_updated', linkType: 'blocks', sourceType, sourceFilename: srcFile, targetType, targetFilename: tgtFile });
        logInfo('POST /api/link', `${srcFile} blocks ${tgtFile}`);
        return res.json({ success: true, linkType: 'blocks', sourceFilename: srcFile, targetFilename: tgtFile });
      }

      // ── parent-child hierarchy link ────────────────────────────────────────
      const key  = `${normalizeType(sourceType)}→${normalizeType(targetType)}`;
      const rule = LINK_RULES[key];
      if (!rule) {
        return sendError(res, 400, 'INVALID_LINK', `Cannot link ${sourceType} → ${targetType}`, {
          allowed: Object.keys(LINK_RULES),
        });
      }

      const srcFile = assertFilename(sourceFilename);
      const tgtFile = assertFilename(targetFilename);
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

  return router;
}
