// ── AI Time Saved routes: log AI-assisted actions, chart data, PDF/PPTX export ─
import { Router } from 'express';
import { sendError, parseApiError } from '../utils/routeHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { AiSavingsLogSchema } from '../schemas/ai-savings.js';
import {
  createAiSavingsService,
  buildSavingsPdf,
  buildSavingsPptx,
} from '../services/aiSavingsService.js';
import type { AiSavingsRouteContext } from '../types.js';

export default function aiSavingsRoutes({ rootDir, logInfo, logError }: AiSavingsRouteContext) {
  const router = Router();
  const service = createAiSavingsService(rootDir);

  // ── GET /api/ai-savings ─────────────────────────────────────────────────────
  router.get('/api/ai-savings', async (_req, res) => {
    try {
      const { entries, totalMinutes } = await service.getAll();
      res.json({ entries, total_minutes: totalMinutes });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('GET /api/ai-savings', apiErr.message);
      sendError(res, 500, apiErr.code, apiErr.message);
    }
  });

  // ── POST /api/ai-savings/log ────────────────────────────────────────────────
  router.post('/api/ai-savings/log', validateBody(AiSavingsLogSchema), async (req, res) => {
    try {
      const entry = await service.appendEntry(req.body);
      logInfo(
        'POST /api/ai-savings/log',
        `${entry.action_type} x${entry.item_count} (${entry.time_saved_minutes}m saved)`
      );
      res.json({ entry });
    } catch (err) {
      const apiErr = parseApiError(err, 'VALIDATION_ERROR', 'Failed to log AI savings entry');
      logError('POST /api/ai-savings/log', apiErr.message);
      sendError(res, 400, apiErr.code, apiErr.message);
    }
  });

  // ── GET /api/ai-savings/export/pdf ──────────────────────────────────────────
  router.get('/api/ai-savings/export/pdf', async (_req, res) => {
    try {
      const { entries, totalMinutes } = await service.getAll();
      const buffer = await buildSavingsPdf(entries, totalMinutes);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="ai-time-saved-report.pdf"');
      res.send(buffer);
    } catch (err) {
      const apiErr = parseApiError(err, 'EXPORT_FAILED', 'PDF export failed');
      logError('GET /api/ai-savings/export/pdf', apiErr.message);
      sendError(res, 500, apiErr.code, apiErr.message);
    }
  });

  // ── GET /api/ai-savings/export/pptx ─────────────────────────────────────────
  router.get('/api/ai-savings/export/pptx', async (_req, res) => {
    try {
      const { entries, totalMinutes } = await service.getAll();
      const buffer = await buildSavingsPptx(entries, totalMinutes);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="ai-time-saved-report.pptx"');
      res.send(buffer);
    } catch (err) {
      const apiErr = parseApiError(err, 'EXPORT_FAILED', 'PPTX export failed');
      logError('GET /api/ai-savings/export/pptx', apiErr.message);
      sendError(res, 500, apiErr.code, apiErr.message);
    }
  });

  return router;
}
