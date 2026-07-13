// ── Document batch operation routes ───────────────────────────────────────────
import { Router } from 'express';
import { sendError, parseApiError, assertDocType } from '../utils/routeHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import {
  BatchDeleteSchema,
  BatchFixVersionSchema,
  DistributeSchema,
  RerankSchema,
  RerankCanvasSchema,
  ApplyDistributionSchema,
  BatchUpdateFieldSchema,
} from '../schemas/docs.js';
import { TEAMS, WORK_CATEGORIES } from '../config/metadata.js';
import {
  batchDelete,
  batchFixVersion,
  computeDistribution,
  runDistribution,
  batchRerank,
  batchRerankCanvas,
  applyDistribution,
  batchUpdateField,
} from '../services/batchService.js';
import type { DocItem, AssignmentItem, RerankItem } from '../services/batchService.js';
import type { RouteContext } from '../types.js';

const BATCH_FIELD_MAP: Record<string, { frontmatter: string; allowed: string[] | null }> = {
  sprint: { frontmatter: 'Sprint', allowed: null },
  team: { frontmatter: 'Team', allowed: TEAMS },
  workCategory: { frontmatter: 'Work_Category', allowed: WORK_CATEGORIES },
};

export default function docsBatchRoutes({
  rootDir,
  TYPE_CONFIG,
  broadcast,
  logInfo,
  logWarn,
  docIndex,
}: RouteContext) {
  const router = Router();

  // ── POST /api/docs/batch-delete ──────────────────────────────────────────
  router.post('/api/docs/batch-delete', validateBody(BatchDeleteSchema), async (req, res) => {
    try {
      const { docs } = req.body;
      const { deleted, skipped } = await batchDelete(docs as DocItem[], { TYPE_CONFIG, logWarn });

      const allTouched = [...deleted.map((d) => d.filename), ...skipped.map((s) => s.filename)];
      await docIndex.invalidateMany(allTouched);
      broadcast({ type: 'batch_deleted', filenames: deleted.map((d) => d.filename) });

      if (skipped.length) {
        logInfo('POST /api/docs/batch-delete', `Skipped entries: ${JSON.stringify(skipped)}`);
      }
      logInfo(
        'POST /api/docs/batch-delete',
        `Deleted ${deleted.length}, skipped ${skipped.length}`
      );
      res.json({ success: true, deleted: deleted.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/batch-fix-version ───────────────────────────────────────
  router.post(
    '/api/docs/batch-fix-version',
    validateBody(BatchFixVersionSchema),
    async (req, res) => {
      try {
        const { fixVersion, docs } = req.body;
        const newValue = fixVersion || 'TBD';
        const { updated, skipped } = await batchFixVersion(docs as DocItem[], newValue, {
          TYPE_CONFIG,
          logWarn,
        });

        if (updated.length) {
          await docIndex.invalidateMany(updated.map((u) => u.filename));
          broadcast({
            type: 'batch_fix_version_updated',
            fixVersion: newValue,
            filenames: updated.map((u) => u.filename),
          });
        }

        logInfo(
          'POST /api/docs/batch-fix-version',
          `Updated ${updated.length}, skipped ${skipped.length}`,
          { fixVersion: newValue }
        );
        res.json({ success: true, updated: updated.length, skipped });
      } catch (err) {
        const apiErr = parseApiError(err);
        sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
      }
    }
  );

  // ── POST /api/docs/distribute ── propose sprint assignments ─────────────────
  router.post('/api/docs/distribute', validateBody(DistributeSchema), async (req, res) => {
    try {
      const { piName } = req.body;
      const computed = await computeDistribution(piName, { rootDir, docIndex, logWarn });

      if ('error' in computed) {
        return sendError(res, 400, computed.error.code, computed.error.message);
      }

      const result = runDistribution(computed.leafDocs, computed.sprintCfg, computed.epicRankMap);
      res.json({ piName, ...result });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/rerank ── batch assign Rank fields ──────────────────────
  router.post('/api/docs/rerank', validateBody(RerankSchema), async (req, res) => {
    try {
      const { type, orderedFilenames } = req.body;
      const docType = assertDocType(type, TYPE_CONFIG);
      const { updated, skipped } = await batchRerank(docType, orderedFilenames as string[], {
        TYPE_CONFIG,
        logWarn,
      });

      if (updated.length) {
        await docIndex.invalidateMany(updated);
        broadcast({ type: 'title_updated', docType });
      }

      logInfo(
        'POST /api/docs/rerank',
        `Ranked ${updated.length} ${docType}(s), skipped ${skipped.length}`
      );
      res.json({ success: true, updated: updated.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(
        res,
        ['VALIDATION_ERROR', 'INVALID_TYPE'].includes(apiErr.code) ? 400 : 500,
        apiErr.code,
        apiErr.message,
        apiErr.details
      );
    }
  });

  // ── POST /api/docs/rerank-canvas ── assign ranks from canvas grid positions ─
  router.post('/api/docs/rerank-canvas', validateBody(RerankCanvasSchema), async (req, res) => {
    try {
      const { items } = req.body;
      const { updated, skipped } = await batchRerankCanvas(items as RerankItem[], {
        TYPE_CONFIG,
        logWarn,
      });

      if (updated.length) {
        await docIndex.invalidateMany(updated);
        broadcast({ type: 'title_updated' });
      }

      logInfo(
        'POST /api/docs/rerank-canvas',
        `Ranked ${updated.length} item(s) from canvas, skipped ${skipped.length}`
      );
      res.json({ success: true, updated: updated.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(
        res,
        ['VALIDATION_ERROR'].includes(apiErr.code) ? 400 : 500,
        apiErr.code,
        apiErr.message,
        apiErr.details
      );
    }
  });

  // ── POST /api/docs/apply-distribution ── batch assign sprints ──────────────
  router.post(
    '/api/docs/apply-distribution',
    validateBody(ApplyDistributionSchema),
    async (req, res) => {
      try {
        const { assignments } = req.body;
        const result = await applyDistribution(assignments as AssignmentItem[], {
          rootDir,
          docIndex,
          TYPE_CONFIG,
          logWarn,
        });

        if ('error' in result) {
          return sendError(res, 400, result.error.code, result.error.message);
        }

        const { updated, skipped, warnings: depWarnings } = result;

        if (updated.length) {
          await docIndex.invalidateMany(updated.map((u) => u.filename));
          broadcast({ type: 'batch_sprint_updated', filenames: updated.map((u) => u.filename) });
        }

        logInfo(
          'POST /api/docs/apply-distribution',
          `Assigned ${updated.length} item(s), skipped ${skipped.length}`
        );
        res.json({
          success: true,
          updated: updated.length,
          skipped,
          assignments: updated,
          warnings: depWarnings,
        });
      } catch (err) {
        const apiErr = parseApiError(err);
        sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
      }
    }
  );

  // ── POST /api/docs/batch-update-field ── bulk assign sprint/team/category ──
  router.post(
    '/api/docs/batch-update-field',
    validateBody(BatchUpdateFieldSchema),
    async (req, res) => {
      try {
        const { field, value, docs } = req.body;

        const { frontmatter, allowed } =
          BATCH_FIELD_MAP[field as 'sprint' | 'team' | 'workCategory'];
        const newValue = value || 'TBD';
        if (allowed && newValue !== 'TBD' && !allowed.includes(newValue)) {
          return sendError(
            res,
            400,
            'VALIDATION_ERROR',
            `${field} must be one of: ${allowed.join(', ')}, TBD`
          );
        }

        const { updated, skipped } = await batchUpdateField(
          docs as DocItem[],
          frontmatter,
          newValue,
          field,
          { TYPE_CONFIG, logWarn }
        );

        if (updated.length) {
          await docIndex.invalidateMany(updated.map((u) => u.filename));
          broadcast({
            type: 'batch_field_updated',
            field,
            value: newValue,
            filenames: updated.map((u) => u.filename),
          });
        }

        logInfo(
          'POST /api/docs/batch-update-field',
          `Updated ${updated.length} ${field}→${newValue}, skipped ${skipped.length}`
        );
        res.json({ success: true, updated: updated.length, skipped });
      } catch (err) {
        const apiErr = parseApiError(err);
        sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
      }
    }
  );

  return router;
}
