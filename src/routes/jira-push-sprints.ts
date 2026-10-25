// ── JIRA push-sprints routes ──────────────────────────────────────────────────
import { Router, type Response } from 'express';
import { sendError, parseApiError, handleRouteError, setupSSE } from '../utils/routeHelpers.js';
import { ensureSprintCache } from '../services/jiraService.js';
import {
  resolveActiveSprints,
  scanBoardSprints,
  importSprintIssues,
  buildSprintPushPreview,
  scanUnimportedSprints,
  pushSprintAssignments,
} from '../services/jiraSprintService.js';
import { config } from '../config/env.js';
import { validateBody } from '../utils/validateMiddleware.js';
import {
  JiraPushSprintsPreviewSchema,
  JiraPushSprintsSchema,
  JiraPullSprintPreviewSchema,
  JiraPullSprintSchema,
} from '../schemas/jira.js';
import type { JiraRouteContext } from '../types.js';

export default function jiraPushSprintsRoutes({
  TYPE_CONFIG,
  JIRA_BOARD_ID,
  FIELD_STORY_POINTS,
  jiraRequest,
  jiraAgileRequest,
  jiraIssueToMarkdown,
  broadcast,
  logInfo,
  logWarn,
  logError,
  docIndex,
}: JiraRouteContext) {
  const router = Router();

  // 503 when the JIRA token is missing; with `board`, 400 when no board is configured.
  // Returns false after sending the error response.
  function requireJira(res: Response, { board = false }: { board?: boolean } = {}): boolean {
    if (!process.env.JIRA_API_TOKEN) {
      sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
      return false;
    }
    if (board && !JIRA_BOARD_ID) {
      sendError(res, 400, 'NO_BOARD', 'JIRA_BOARD_ID not configured');
      return false;
    }
    return true;
  }

  // Log a failure and report it on an open SSE stream.
  function sendSseError(send: (payload: unknown) => unknown, err: unknown, scope: string) {
    const apiErr = parseApiError(err);
    logError(scope, apiErr.message, apiErr.details as Record<string, unknown> | undefined);
    send({ type: 'error', message: apiErr.message });
  }

  // ── POST /api/jira/push-sprints-preview ── compare local vs JIRA sprint state (SSE) ─
  router.post(
    '/api/jira/push-sprints-preview',
    validateBody(JiraPushSprintsPreviewSchema),
    async (req, res) => {
      if (!requireJira(res, { board: true })) return;

      setupSSE(res);
      const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

      try {
        const { items = [], selectedSprints = [] } = req.body as {
          items: Array<{
            filename: string;
            sprint: string | null;
            jiraId: string;
            title: string;
            docType: string;
          }>;
          selectedSprints: string[];
        };

        send({ type: 'progress', message: 'Loading sprint data from JIRA board…' });
        const sprintMap = await ensureSprintCache(jiraAgileRequest, JIRA_BOARD_ID);

        const { activeSprintMap, localToJira, jiraToLocal } = resolveActiveSprints(
          selectedSprints,
          sprintMap
        );

        if (!activeSprintMap.size) {
          const jiraNames = [...sprintMap.keys()].slice(0, 5).join(', ');
          send({
            type: 'error',
            message: `No matching JIRA sprints found. Local names: ${selectedSprints.join(', ')}. JIRA names on board: ${jiraNames}…`,
          });
          res.end();
          return;
        }

        // Filter items to those whose local sprint maps to a selected JIRA sprint (or have no sprint)
        const filteredItems = items.filter((i) => {
          if (!i.sprint || i.sprint === 'TBD') return true;
          return localToJira.has(i.sprint);
        });

        // ── Step 1: Scan selected sprints from the board (parallel, capped at JIRA_CONCURRENCY) ──
        const sprintEntries = [...activeSprintMap.entries()];
        const totalSteps = sprintEntries.length;
        send({
          type: 'progress',
          message: `Scanning ${totalSteps} sprint(s) on JIRA board…`,
          phase: 1,
          total: totalSteps,
        });

        const jiraSprintMap = await scanBoardSprints(sprintEntries, jiraToLocal, {
          boardId: JIRA_BOARD_ID,
          concurrency: config.JIRA_CONCURRENCY,
          jiraAgileRequest,
          logWarn,
          onProgress: send,
        });

        // ── Step 2 & 3: Compare local items vs. the JIRA sprint map, and detect
        // JIRA-only issues not in the local set (pure diff logic — see service). ──
        send({
          type: 'progress',
          message: `Comparing ${filteredItems.length} local items…`,
          phase: 2,
          current: totalSteps,
          total: totalSteps,
        });

        const { changes, errors, stats } = buildSprintPushPreview({
          filteredItems,
          jiraSprintMap,
          sprintMap,
          localToJira,
          jiraToLocal,
          findByJiraId: (jiraId) => docIndex.findByJiraId(jiraId),
          getLocalEntry: (filename) => docIndex.get(filename),
        });

        logInfo(
          'POST /api/jira/push-sprints-preview',
          `${stats.adds} add, ${stats.changes} change, ${stats.pulls} pull, ${stats.unchanged} unchanged, ${errors.length} errors`
        );
        send({ type: 'result', changes, errors, stats });
        res.end();
      } catch (err) {
        sendSseError(send, err, 'POST /api/jira/push-sprints-preview');
        res.end();
      }
    }
  );

  // ── POST /api/jira/push-sprints ── push/pull sprint assignments ─────────────
  router.post('/api/jira/push-sprints', validateBody(JiraPushSprintsSchema), async (req, res) => {
    if (!requireJira(res, { board: true })) return;

    try {
      const { items = [] } = req.body;
      const results = await pushSprintAssignments(items, {
        boardId: JIRA_BOARD_ID,
        concurrency: config.JIRA_CONCURRENCY,
        typeConfig: TYPE_CONFIG,
        jiraAgileRequest,
        docIndex,
        broadcast,
        logInfo,
        logWarn,
      });

      res.json({ results });
    } catch (err) {
      handleRouteError(res, err, { scope: 'POST /api/jira/push-sprints', logError });
    }
  });

  // ── POST /api/jira/pull-sprint-preview ── scan JIRA sprints for issues not in local app (SSE) ──
  router.post(
    '/api/jira/pull-sprint-preview',
    validateBody(JiraPullSprintPreviewSchema),
    async (req, res) => {
      if (!requireJira(res, { board: true })) return;

      setupSSE(res);
      const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

      try {
        const { selectedSprints = [] } = req.body as { selectedSprints: string[] };

        send({ type: 'progress', message: 'Loading sprint data from JIRA board…' });
        const sprintMap = await ensureSprintCache(jiraAgileRequest, JIRA_BOARD_ID);

        const { activeSprintMap } = resolveActiveSprints(selectedSprints, sprintMap);

        if (!activeSprintMap.size) {
          send({
            type: 'error',
            message: `No matching JIRA sprints found for: ${selectedSprints.join(', ')}`,
          });
          res.end();
          return;
        }

        const sprintEntries = [...activeSprintMap.entries()];

        const results = await scanUnimportedSprints(sprintEntries, {
          jiraAgileRequest,
          fieldStoryPoints: FIELD_STORY_POINTS,
          concurrency: config.JIRA_CONCURRENCY,
          findByJiraId: (jiraId) => docIndex.findByJiraId(jiraId),
          onProgress: send,
        });

        send({ type: 'done', results });
        res.end();
      } catch (err) {
        sendSseError(send, err, 'POST /api/jira/pull-sprint-preview');
        res.end();
      }
    }
  );

  // ── POST /api/jira/pull-sprint ── import selected JIRA issues as local docs ──
  router.post('/api/jira/pull-sprint', validateBody(JiraPullSprintSchema), async (req, res) => {
    if (!requireJira(res)) return;

    try {
      const { issues = [] } = req.body as { issues: Array<{ key: string; sprintName: string }> };

      const results = await importSprintIssues(issues, {
        typeConfig: TYPE_CONFIG,
        concurrency: config.JIRA_CONCURRENCY,
        jiraRequest,
        jiraIssueToMarkdown,
        docIndex,
        broadcast,
        logInfo,
        logWarn,
      });

      res.json({ results });
    } catch (err) {
      handleRouteError(res, err, { scope: 'POST /api/jira/pull-sprint', logError });
    }
  });

  return router;
}
