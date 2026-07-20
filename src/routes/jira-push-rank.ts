// ── JIRA rank-sync route ──────────────────────────────────────────────────────
// Handles POST /api/jira/push-rank — syncs local rank order to JIRA backlog.
import { Router } from 'express';
import { sendError, parseApiError } from '../utils/routeHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { JiraPushRankSchema } from '../schemas/jira.js';
import type { JiraRouteContext } from '../types.js';

export default function jiraPushRankRoutes({ jiraRequest, logInfo, logError }: JiraRouteContext) {
  const router = Router();

  // ── POST /api/jira/push-rank ── sync local rank order to JIRA backlog ────────
  router.post('/api/jira/push-rank', validateBody(JiraPushRankSchema), async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    try {
      const { key, beforeKey, afterKey } = req.body;
      if (!key) return sendError(res, 400, 'VALIDATION_ERROR', 'key is required');
      if (!beforeKey && !afterKey)
        return sendError(res, 400, 'VALIDATION_ERROR', 'beforeKey or afterKey is required');

      const body = beforeKey ? { rankBeforeIssue: beforeKey } : { rankAfterIssue: afterKey };
      await jiraRequest('PUT', `/issue/${key}/rank`, body);

      logInfo(
        'POST /api/jira/push-rank',
        `Ranked ${key} ${beforeKey ? 'before' : 'after'} ${beforeKey || afterKey}`
      );
      res.json({ success: true, key, beforeKey: beforeKey || null, afterKey: afterKey || null });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/jira/push-rank',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
