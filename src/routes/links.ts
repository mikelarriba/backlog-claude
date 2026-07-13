// ── Hierarchy & linking routes ────────────────────────────────────────────────
import { Router } from 'express';
import {
  sendError,
  parseApiError,
  assertDocType,
  assertFilename,
  normalizeType,
} from '../utils/routeHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { CreateLinkSchema, DeleteLinkSchema } from '../schemas/links.js';
import {
  applyHierarchyLink,
  applyBlocksLink,
  applyParallelLink,
  removeBlocksLink,
  removeParallelLink,
} from '../services/linksService.js';
import type { RouteContext } from '../types.js';

export default function linksRoutes({
  TYPE_CONFIG,
  FEATURES_DIR,
  EPICS_DIR,
  STORIES_DIR,
  SPIKES_DIR,
  BUGS_DIR,
  broadcast,
  logInfo,
  docIndex,
}: RouteContext) {
  const router = Router();

  const linksCtx = {
    TYPE_CONFIG,
    FEATURES_DIR,
    EPICS_DIR,
    STORIES_DIR,
    SPIKES_DIR,
    BUGS_DIR,
    broadcast,
    logInfo,
    docIndex,
  };

  // ── GET /api/links/:type/:filename ─────────────────────────────────────────
  router.get('/api/links/:type/:filename', (req, res) => {
    try {
      const docType = assertDocType(req.params.type, TYPE_CONFIG);
      const filename = assertFilename(req.params.filename);

      let parent: {
        docType: string;
        filename: string;
        title: string;
        jiraId: string;
        status: string;
      } | null = null;
      let children: Array<{
        docType: string;
        filename: string;
        title: string;
        jiraId: string;
        status: string;
      }> = [];

      if (docType === 'epic') {
        const epicEntry = docIndex.get(filename);
        if (epicEntry?.parentFilename) {
          const parentEntry = docIndex.get(epicEntry.parentFilename);
          if (parentEntry) {
            parent = {
              docType: 'feature',
              filename: epicEntry.parentFilename,
              title: parentEntry.title,
              jiraId: parentEntry.jiraId || 'TBD',
              status: parentEntry.status || 'Draft',
            };
          }
        }

        children = docIndex
          .getAll()
          .filter(
            (e) => ['story', 'spike', 'bug'].includes(e.docType) && e.parentFilename === filename
          )
          .map((e) => ({
            docType: e.docType,
            filename: e.filename,
            title: e.title,
            jiraId: e.jiraId || 'TBD',
            status: e.status || 'Draft',
          }));
      } else if (docType === 'feature') {
        children = docIndex
          .getAll()
          .filter((e) => e.docType === 'epic' && e.parentFilename === filename)
          .map((e) => ({
            docType: 'epic',
            filename: e.filename,
            title: e.title,
            jiraId: e.jiraId || 'TBD',
            status: e.status || 'Draft',
          }));
      }

      const entry = docIndex.get(filename);
      const blocks = (entry?.blocks || []).map((fn) => {
        const e = docIndex.get(fn);
        return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
      });
      const blockedBy = (entry?.blockedBy || []).map((fn) => {
        const e = docIndex.get(fn);
        return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
      });
      const parallel = (entry?.parallel || []).map((fn) => {
        const e = docIndex.get(fn);
        return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
      });

      res.json({ parent, children, blocks, blockedBy, parallel });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(
        res,
        ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500,
        apiErr.code,
        apiErr.message,
        apiErr.details
      );
    }
  });

  // ── GET /api/links/feature/:filename/deep ─────────────────────────────────
  router.get('/api/links/feature/:filename/deep', (req, res) => {
    try {
      const filename = assertFilename(req.params.filename);
      const featureEntry = docIndex.get(filename);

      const featureObj = {
        filename,
        title: featureEntry?.title || filename,
      };

      const epicEntries = docIndex
        .getAll()
        .filter((e) => e.docType === 'epic' && e.parentFilename === filename);

      const epics = epicEntries.map((epicEntry) => {
        const epicFilename = epicEntry.filename;

        const children = docIndex
          .getAll()
          .filter(
            (e) =>
              ['story', 'spike', 'bug'].includes(e.docType) && e.parentFilename === epicFilename
          )
          .map((e) => ({
            docType: e.docType,
            filename: e.filename,
            title: e.title,
            jiraId: e.jiraId || 'TBD',
            status: e.status || 'Draft',
            storyPoints: e.storyPoints ?? null,
          }));

        const blocks = (epicEntry.blocks || []).map((fn) => {
          const e = docIndex.get(fn);
          return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
        });
        const blockedBy = (epicEntry.blockedBy || []).map((fn) => {
          const e = docIndex.get(fn);
          return { filename: fn, title: e?.title || fn, docType: e?.docType || null };
        });
        const parallel = (epicEntry.parallel || []).map((fn) => {
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
      sendError(
        res,
        apiErr.code === 'INVALID_FILENAME' ? 400 : 500,
        apiErr.code,
        apiErr.message,
        apiErr.details
      );
    }
  });

  // ── POST /api/link ─────────────────────────────────────────────────────────
  router.post('/api/link', validateBody(CreateLinkSchema), async (req, res) => {
    try {
      const { sourceType, sourceFilename, targetType, targetFilename, linkType } = req.body;

      const srcFile = assertFilename(sourceFilename);
      const tgtFile = assertFilename(targetFilename);

      let result;

      if (linkType === 'blocks') {
        const srcType = normalizeType(sourceType);
        const tgtType = normalizeType(targetType);
        result = await applyBlocksLink(srcType, srcFile, tgtType, tgtFile, linksCtx);
      } else if (linkType === 'parallel') {
        const srcType = normalizeType(sourceType);
        const tgtType = normalizeType(targetType);
        result = await applyParallelLink(srcType, srcFile, tgtType, tgtFile, linksCtx);
      } else {
        result = await applyHierarchyLink(
          normalizeType(sourceType),
          srcFile,
          normalizeType(targetType),
          tgtFile,
          linksCtx
        );
      }

      if ('status' in result) {
        return sendError(res, result.status, result.code, result.message, result.details);
      }

      return res.json(result);
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(
        res,
        apiErr.code === 'INVALID_FILENAME' ? 400 : 500,
        apiErr.code,
        apiErr.message,
        apiErr.details
      );
    }
  });

  // ── DELETE /api/link ── remove a blocks dependency ─────────────────────────
  router.delete('/api/link', validateBody(DeleteLinkSchema), async (req, res) => {
    try {
      const { sourceType, sourceFilename, targetType, targetFilename, linkType } = req.body;

      const srcType = normalizeType(sourceType || 'story');
      const tgtType = normalizeType(targetType || 'story');
      const srcFile = assertFilename(sourceFilename);
      const tgtFile = assertFilename(targetFilename);

      if (linkType === 'parallel') {
        await removeParallelLink(srcType, srcFile, tgtType, tgtFile, linksCtx);
      } else {
        await removeBlocksLink(srcType, srcFile, tgtType, tgtFile, linksCtx);
      }

      res.json({ success: true });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(
        res,
        apiErr.code === 'INVALID_FILENAME' ? 400 : 500,
        apiErr.code,
        apiErr.message,
        apiErr.details
      );
    }
  });

  return router;
}
