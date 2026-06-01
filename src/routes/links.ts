// ── Hierarchy & linking routes ────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, parseApiError, assertDocType, assertFilename, normalizeType } from '../utils/routeHelpers.js';
import { setFrontmatterField, extractFrontmatterField, removeFrontmatterField } from '../utils/transforms.js';
import { VALID_LINK_TYPES } from '../utils/validate.js';
import type { RouteContext } from '../types.js';

export default function linksRoutes({ TYPE_CONFIG, FEATURES_DIR, EPICS_DIR, STORIES_DIR, SPIKES_DIR, BUGS_DIR, broadcast, logInfo, docIndex }: RouteContext) {
  const router = Router();

  // ── GET /api/links/:type/:filename ─────────────────────────────────────────
  router.get('/api/links/:type/:filename', (req, res) => {
    try {
      const docType  = assertDocType(req.params.type, TYPE_CONFIG);
      const filename = assertFilename(req.params.filename);

      let parent: { docType: string; filename: string; title: string; jiraId: string; status: string } | null = null;
      let children: Array<{ docType: string; filename: string; title: string; jiraId: string; status: string }> = [];

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
      const parallel  = (entry?.parallel  || []).map(fn => {
        const e = docIndex.get(fn);
        return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
      });

      res.json({ parent, children, blocks, blockedBy, parallel });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/links/feature/:filename/deep ─────────────────────────────────
  // Returns the full feature → epics → children hierarchy in one call,
  // eliminating N+1 fetches from the multi-panel view.
  router.get('/api/links/feature/:filename/deep', (req, res) => {
    try {
      const filename = assertFilename(req.params.filename);
      const featureEntry = docIndex.get(filename);

      const featureObj = {
        filename,
        title: featureEntry?.title || filename,
      };

      const epicEntries = docIndex.getAll()
        .filter(e => e.docType === 'epic' && e.parentFilename === filename);

      const epics = epicEntries.map(epicEntry => {
        const epicFilename = epicEntry.filename;

        const children = docIndex.getAll()
          .filter(e => ['story', 'spike', 'bug'].includes(e.docType) && e.parentFilename === epicFilename)
          .map(e => ({
            docType: e.docType,
            filename: e.filename,
            title: e.title,
            jiraId: e.jiraId || 'TBD',
            status: e.status || 'Draft',
            storyPoints: e.storyPoints ?? null,
          }));

        const blocks = (epicEntry.blocks || []).map(fn => {
          const e = docIndex.get(fn);
          return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
        });
        const blockedBy = (epicEntry.blockedBy || []).map(fn => {
          const e = docIndex.get(fn);
          return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
        });
        const parallel = (epicEntry.parallel || []).map(fn => {
          const e = docIndex.get(fn);
          return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
        });

        return {
          filename: epicFilename,
          title: epicEntry.title,
          docType: 'epic',
          storyPoints: epicEntry.storyPoints ?? null,
          status: epicEntry.status || 'Draft',
          jiraId: epicEntry.jiraId || 'TBD',
          children,
          blocks,
          blockedBy,
          parallel,
        };
      });

      res.json({ feature: featureObj, epics });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/link ─────────────────────────────────────────────────────────
  router.post('/api/link', (req, res) => {
    const LINK_RULES: Record<string, { field: string; sourceDir: () => string; targetDir: () => string }> = {
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

      if (linkType !== undefined && !(VALID_LINK_TYPES as readonly string[]).includes(linkType)) {
        return sendError(res, 400, 'VALIDATION_ERROR', `linkType must be one of: ${VALID_LINK_TYPES.join(', ')}`);
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

        // Cycle detection: BFS from tgtFile following Blocks links; error if we reach srcFile
        const visited = new Set();
        const queue   = [tgtFile];
        while (queue.length) {
          const fn = queue.shift() as string;
          if (fn === srcFile) {
            return sendError(res, 400, 'CYCLE_DETECTED', `Adding this dependency would create a cycle: ${tgtFile} already (directly or transitively) blocks ${srcFile}`);
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

        broadcast({ type: 'link_updated', linkType: 'blocks', sourceFilename: srcFile, targetFilename: tgtFile });
        logInfo('POST /api/link', `${srcFile} blocks ${tgtFile}`);
        return res.json({ success: true, linkType: 'blocks', sourceFilename: srcFile, targetFilename: tgtFile });
      }

      // ── Parallel link ─────────────────────────────────────────────────────
      if (linkType === 'parallel') {
        const srcType = normalizeType(sourceType);
        const tgtType = normalizeType(targetType);
        const leafTypes = new Set(['story', 'spike', 'bug']);
        if (!leafTypes.has(srcType)) return sendError(res, 400, 'INVALID_LINK', 'Only leaf types (story, spike, bug) can have parallel links');
        if (!leafTypes.has(tgtType)) return sendError(res, 400, 'INVALID_LINK', 'Only leaf types (story, spike, bug) can have parallel links');
        if (srcFile === tgtFile) return sendError(res, 400, 'INVALID_LINK', 'A story cannot be parallel with itself');

        const srcCfg = TYPE_CONFIG[srcType];
        const tgtCfg = TYPE_CONFIG[tgtType];
        const srcPath = path.join(srcCfg.dir(), srcFile);
        const tgtPath = path.join(tgtCfg.dir(), tgtFile);
        if (!fs.existsSync(srcPath)) return sendError(res, 404, 'NOT_FOUND', 'Source document not found');
        if (!fs.existsSync(tgtPath)) return sendError(res, 404, 'NOT_FOUND', 'Target document not found');

        // Append tgtFile to source's Parallel field
        const srcContent = fs.readFileSync(srcPath, 'utf-8');
        const existingParallelSrc = extractFrontmatterField(srcContent, 'Parallel');
        const parallelSrcArr = existingParallelSrc ? existingParallelSrc.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (!parallelSrcArr.includes(tgtFile)) {
          parallelSrcArr.push(tgtFile);
          fs.writeFileSync(srcPath, setFrontmatterField(srcContent, 'Parallel', parallelSrcArr.join(', ')));
          docIndex.invalidate(srcType, srcFile);
        }

        // Append srcFile to target's Parallel field (symmetric)
        const tgtContent = fs.readFileSync(tgtPath, 'utf-8');
        const existingParallelTgt = extractFrontmatterField(tgtContent, 'Parallel');
        const parallelTgtArr = existingParallelTgt ? existingParallelTgt.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (!parallelTgtArr.includes(srcFile)) {
          parallelTgtArr.push(srcFile);
          fs.writeFileSync(tgtPath, setFrontmatterField(tgtContent, 'Parallel', parallelTgtArr.join(', ')));
          docIndex.invalidate(tgtType, tgtFile);
        }

        broadcast({ type: 'link_updated', linkType: 'parallel', sourceFilename: srcFile, targetFilename: tgtFile });
        logInfo('POST /api/link', `${srcFile} parallel ${tgtFile}`);
        return res.json({ success: true, linkType: 'parallel', sourceFilename: srcFile, targetFilename: tgtFile });
      }

      // ── Hierarchy link ────────────────────────────────────────────────────
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
      if (!['blocks', 'parallel'].includes(linkType)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Only linkType "blocks" or "parallel" supports DELETE');
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

      if (linkType === 'parallel') {
        // Remove tgt from source's Parallel field
        if (srcPath && fs.existsSync(srcPath)) {
          const srcContent = fs.readFileSync(srcPath, 'utf-8');
          const existing   = extractFrontmatterField(srcContent, 'Parallel') || '';
          const filtered   = existing.split(',').map(s => s.trim()).filter(s => s && s !== tgtFile && s !== 'TBD');
          const updated    = filtered.length
            ? setFrontmatterField(srcContent, 'Parallel', filtered.join(', '))
            : removeFrontmatterField(srcContent, 'Parallel');
          fs.writeFileSync(srcPath, updated);
          docIndex.invalidate(srcType, srcFile);
        }
        // Remove src from target's Parallel field
        if (tgtPath && fs.existsSync(tgtPath)) {
          const tgtContent = fs.readFileSync(tgtPath, 'utf-8');
          const existing   = extractFrontmatterField(tgtContent, 'Parallel') || '';
          const filtered   = existing.split(',').map(s => s.trim()).filter(s => s && s !== srcFile && s !== 'TBD');
          const updated    = filtered.length
            ? setFrontmatterField(tgtContent, 'Parallel', filtered.join(', '))
            : removeFrontmatterField(tgtContent, 'Parallel');
          fs.writeFileSync(tgtPath, updated);
          docIndex.invalidate(tgtType, tgtFile);
        }
        broadcast({ type: 'link_updated', linkType: 'parallel', sourceFilename: srcFile, targetFilename: tgtFile });
        logInfo('DELETE /api/link', `removed parallel: ${srcFile} ↔ ${tgtFile}`);
      } else {
        // Remove from Blocks on source
        if (srcPath && fs.existsSync(srcPath)) {
          const srcContent = fs.readFileSync(srcPath, 'utf-8');
          const existing   = extractFrontmatterField(srcContent, 'Blocks') || '';
          const filtered   = existing.split(',').map(s => s.trim()).filter(s => s && s !== tgtFile && s !== 'TBD');
          const updated    = filtered.length
            ? setFrontmatterField(srcContent, 'Blocks', filtered.join(', '))
            : removeFrontmatterField(srcContent, 'Blocks');
          fs.writeFileSync(srcPath, updated);
          docIndex.invalidate(srcType, srcFile);
        }
        // Remove from Blocked_By on target
        if (tgtPath && fs.existsSync(tgtPath)) {
          const tgtContent = fs.readFileSync(tgtPath, 'utf-8');
          const existing   = extractFrontmatterField(tgtContent, 'Blocked_By') || '';
          const filtered   = existing.split(',').map(s => s.trim()).filter(s => s && s !== srcFile && s !== 'TBD');
          const updated    = filtered.length
            ? setFrontmatterField(tgtContent, 'Blocked_By', filtered.join(', '))
            : removeFrontmatterField(tgtContent, 'Blocked_By');
          fs.writeFileSync(tgtPath, updated);
          docIndex.invalidate(tgtType, tgtFile);
        }
        broadcast({ type: 'link_updated', linkType: 'blocks', sourceFilename: srcFile, targetFilename: tgtFile });
        logInfo('DELETE /api/link', `removed blocks: ${srcFile} → ${tgtFile}`);
      }
      res.json({ success: true });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
