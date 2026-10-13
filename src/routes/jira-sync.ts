// ── JIRA sync routes ──────────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  sendError,
  parseApiError,
  handleRouteError,
  assertDocType,
  assertFilename,
  fileExists,
} from '../utils/routeHelpers.js';
import { extractFrontmatterField } from '../utils/transforms.js';
import { createJiraSyncService } from '../services/jiraSyncService.js';
import { logAudit } from '../utils/auditLog.js';
import { validateBody } from '../utils/validateMiddleware.js';
import {
  JiraSyncStatusSchema,
  JiraUpdateFromJiraSchema,
  JiraSyncPullPreviewSchema,
  JiraCheckAllSchema,
} from '../schemas/jira.js';
import type { JiraRouteContext } from '../types.js';
import { writeFileAtomic } from '../utils/fileWrite.js';

export default function jiraSyncRoutes({
  TYPE_CONFIG,
  FIELD_EPIC_NAME,
  FIELD_EPIC_LINK,
  FIELD_STORY_POINTS,
  INBOX_DIR,
  JIRA_PROJECT,
  jiraRequest,
  jiraIssueToMarkdown,
  extractJiraSummary,
  findLocalFileByJiraId,
  broadcast,
  logInfo,
  logWarn,
  logError,
  docIndex,
}: JiraRouteContext) {
  const router = Router();
  const { syncStatusFromIssue, mergeFromJiraIssue, checkAll, buildPullPreview } =
    createJiraSyncService({
      INBOX_DIR,
      FIELD_STORY_POINTS,
      FIELD_EPIC_NAME,
      FIELD_EPIC_LINK,
      JIRA_PROJECT,
      TYPE_CONFIG,
      jiraRequest,
      jiraIssueToMarkdown,
      extractJiraSummary,
      findLocalFileByJiraId,
      docIndex,
      logWarn,
    });

  // ── POST /api/jira/sync-status/:type/:filename ────────────────────────────
  router.post(
    '/api/jira/sync-status/:type/:filename',
    validateBody(JiraSyncStatusSchema),
    async (req, res) => {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
      try {
        const docType = assertDocType(req.params.type, TYPE_CONFIG);
        const cfg = TYPE_CONFIG[docType];
        const filename = assertFilename(req.params.filename);
        const filepath = path.join(cfg.dir(), filename);
        if (!(await fileExists(filepath)))
          return sendError(res, 404, 'NOT_FOUND', 'Document not found');

        const content = await fs.promises.readFile(filepath, 'utf-8');
        const jiraId = extractFrontmatterField(content, 'JIRA_ID');
        if (!jiraId || jiraId === 'TBD')
          return sendError(res, 400, 'NO_JIRA_ID', 'Document has no JIRA_ID');

        const issue = await jiraRequest(
          'GET',
          `/issue/${jiraId}?fields=status,labels,${FIELD_STORY_POINTS},summary,description`
        );
        const { updated, jiraStatus, jiraSp } = await syncStatusFromIssue({
          content,
          filename,
          issue,
        });

        await writeFileAtomic(filepath, updated);
        await docIndex.invalidate(docType, filename);
        broadcast({ type: 'title_updated', filename, docType });

        logAudit({
          op: 'jira-sync',
          docType,
          filename,
          fields: { jiraStatus, storyPoints: jiraSp },
          source: 'jira-sync',
        });
        logInfo(
          'POST /api/jira/sync-status',
          `Synced status for ${jiraId}: ${jiraStatus}, SP: ${jiraSp}`
        );
        res.json({ success: true, jiraStatus, storyPoints: jiraSp });
      } catch (err) {
        handleRouteError(res, err, { scope: 'POST /api/jira/sync-status', logError });
      }
    }
  );

  // ── POST /api/jira/update-from-jira/:docType/:filename ────────────────────
  router.post(
    '/api/jira/update-from-jira/:docType/:filename',
    validateBody(JiraUpdateFromJiraSchema),
    async (req, res) => {
      try {
        if (!process.env.JIRA_API_TOKEN)
          return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

        const docType = assertDocType(req.params.docType, TYPE_CONFIG);
        const filename = assertFilename(req.params.filename);
        const cfg = TYPE_CONFIG[docType];
        const filepath = path.join(cfg.dir(), filename);

        if (!(await fileExists(filepath)))
          return sendError(res, 404, 'NOT_FOUND', 'Document not found');

        const existing = await fs.promises.readFile(filepath, 'utf-8');

        const jiraKey =
          (req.body?.jiraKey || '').trim().toUpperCase() ||
          extractFrontmatterField(existing, 'JIRA_ID');
        if (!jiraKey || jiraKey === 'TBD') {
          return sendError(
            res,
            400,
            'VALIDATION_ERROR',
            'No JIRA key provided and JIRA_ID in file is TBD'
          );
        }

        const issue = await jiraRequest(
          'GET',
          `/issue/${jiraKey}?fields=summary,issuetype,status,priority,description,fixVersions,labels,${FIELD_EPIC_NAME},${FIELD_STORY_POINTS}`
        );

        const { merged } = await mergeFromJiraIssue({ existing, filename, issue });

        await writeFileAtomic(filepath, merged);
        await docIndex.invalidate(docType, filename);
        broadcast({ type: `${docType}_created`, filename, docType });

        logAudit({ op: 'jira-sync', docType, filename, fields: { jiraKey }, source: 'jira-sync' });
        logInfo('POST /api/jira/update-from-jira', `Updated ${filename} from JIRA ${jiraKey}`);
        res.json({ key: jiraKey, filename, docType });
      } catch (err) {
        const apiErr = parseApiError(err);
        logError(
          'POST /api/jira/update-from-jira',
          apiErr.message,
          apiErr.details as Record<string, unknown> | undefined
        );
        sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
      }
    }
  );

  // ── POST /api/jira/pull-preview ──────────────────────────────────────────────
  router.post(
    '/api/jira/pull-preview',
    validateBody(JiraSyncPullPreviewSchema),
    async (req, res) => {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      try {
        const { jiraKey, includeChildren = false } = req.body;
        const items = await buildPullPreview({ jiraKey, includeChildren });
        res.json({ items });
      } catch (err) {
        handleRouteError(res, err, { scope: 'POST /api/jira/pull-preview', logError });
      }
    }
  );

  // ── POST /api/jira/check-all ────────────────────────────────────────────────
  router.post('/api/jira/check-all', validateBody(JiraCheckAllSchema), async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const linkedDocs = docIndex
        .getAll()
        .filter((e) => e.jiraId)
        .map((e) => ({ filename: e.filename, docType: e.docType, jiraId: e.jiraId as string }));
      if (linkedDocs.length === 0)
        return res.json({ changed: [], skipped: [], errors: [], total: 0 });

      const { changed, skipped, errors } = await checkAll(linkedDocs);

      logInfo(
        'POST /api/jira/check-all',
        `Checked ${linkedDocs.length}: ${changed.length} changed, ${skipped.length} unchanged, ${errors.length} errors`
      );
      res.json({ changed, skipped, errors, total: linkedDocs.length });
    } catch (err) {
      handleRouteError(res, err, { scope: 'POST /api/jira/check-all', logError });
    }
  });

  return router;
}
