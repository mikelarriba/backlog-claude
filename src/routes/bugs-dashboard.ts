// ── Bug Dashboard routes — JIRA data pipeline & AI analysis ──────────────────
import { Router } from 'express';
import path from 'node:path';
import { sendError, setupSSE, parseApiError } from '../utils/routeHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { BugAnalyzeSchema } from '../schemas/bugs-dashboard.js';
import type { JiraRouteContext } from '../types.js';
import {
  buildDashboardData,
  createDashboardCaches,
  fetchBugs,
  loadLatestReport,
  saveReport,
} from '../services/bugsDashboardService.js';

// Pure helpers moved to the service; re-exported so existing importers keep working.
export { statusAtDate, buildTimeSeries, buildStats } from '../services/bugsDashboardService.js';

export default function bugsDashboardRoutes({
  JIRA_PROJECT,
  JIRA_LABEL,
  JIRA_BASE,
  BUGS_DIR,
  jiraRequest,
  streamClaude,
  aiSavings,
  logInfo,
  logError,
}: JiraRouteContext) {
  const router = Router();
  const caches = createDashboardCaches();
  // Sibling of docs/bugs/ — e.g. docs/bug-analysis/.
  const ANALYSIS_DIR = path.join(path.dirname(BUGS_DIR), 'bug-analysis');

  // GET /api/bugs/dashboard — SSE streaming with progress events
  router.get('/api/bugs/dashboard', async (_req, res) => {
    setupSSE(res);
    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      if (!process.env.JIRA_API_TOKEN) {
        send({
          type: 'error',
          code: 'JIRA_NOT_CONFIGURED',
          message:
            'JIRA API token not configured. Set the JIRA_API_TOKEN environment variable to connect to JIRA.',
        });
        return res.end();
      }

      const force = _req.query.force === 'true';
      const includeClosed = _req.query.includeClosed === 'true';
      const cache = includeClosed ? caches.all : caches.open;

      const cached = force ? null : cache.get();
      if (cached) {
        send({ type: 'progress', stage: 'cache', message: 'Using cached data…' });
        send({ type: 'complete', data: cached });
        return res.end();
      }

      const now = Date.now();
      const fetchedBugs = await fetchBugs(
        includeClosed,
        { project: JIRA_PROJECT, label: JIRA_LABEL, jiraRequest, logInfo },
        (p) => send({ type: 'progress', ...p })
      );

      send({
        type: 'progress',
        stage: 'processing',
        message: `Processing ${fetchedBugs.length} bugs…`,
        fetched: fetchedBugs.length,
        total: fetchedBugs.length,
      });

      const data = buildDashboardData(fetchedBugs);
      cache.set(data, now);

      send({ type: 'complete', data });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('GET /api/bugs/dashboard', apiErr.message);
      try {
        send({ type: 'error', code: apiErr.code, message: apiErr.message });
        res.end();
      } catch {
        /* response already closed */
      }
    }
  });

  // POST /api/bugs/dashboard/analyze
  router.post('/api/bugs/dashboard/analyze', validateBody(BugAnalyzeSchema), async (req, res) => {
    try {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const { bugKeys } = req.body as { bugKeys: string[] };

      // Apply the same freshness check the GET route uses for cache reuse —
      // without it this route could silently analyze arbitrarily stale
      // status/resolution/assignee data (#540).
      const freshOpen = caches.open.get();
      const freshAll = caches.all.get();
      if (!freshOpen && !freshAll) {
        return sendError(
          res,
          400,
          'STALE_CACHE',
          'Dashboard data is stale — reload the dashboard before analyzing.'
        );
      }

      const cachedBugs = [...(freshOpen?.bugs ?? []), ...(freshAll?.bugs ?? [])].filter(
        (b, i, arr) => arr.findIndex((x) => x.key === b.key) === i
      );
      const selected = cachedBugs.filter((b) => bugKeys.includes(b.key));

      if (selected.length === 0)
        return sendError(
          res,
          400,
          'NO_BUGS_FOUND',
          'None of the specified bug keys were found. Load the dashboard first.'
        );

      const bugDetails = selected
        .map(
          (b) =>
            `- ${b.key}: ${b.summary} [${b.status}] Priority: ${b.priority}` +
            (b.assignee ? ` Assignee: ${b.assignee}` : '') +
            (b.resolutionDate ? ` (Resolved: ${b.resolutionDate.slice(0, 10)})` : '')
        )
        .join('\n');

      const prompt = `You are a software development analyst. Analyze these ${selected.length} selected bugs and provide actionable insights:\n\n${bugDetails}\n\nPlease provide:\n1. Prioritization: Rank bugs by severity/impact and explain the ordering\n2. Fix Strategy: Which bugs can be batched or fixed together? Common root causes?\n3. Recommendations: Specific next steps for the top 3 most critical bugs\n4. Patterns: Any concerning trends or patterns you notice?\n\nBe concise and actionable.`;

      setupSSE(res);
      const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

      let fullText = '';
      await streamClaude(prompt, (chunk: string) => {
        fullText += chunk;
        send({ text: chunk });
      });

      // Persist the completed analysis (with JIRA links) so it can be reopened
      // later. A save failure must not fail the request — the user already has
      // the streamed result — so it's logged and reported as report: null.
      let report: { filename: string; savedAt: string } | null = null;
      try {
        report = await saveReport(ANALYSIS_DIR, selected, fullText, JIRA_BASE);
        logInfo('bugs-dashboard', `Saved analysis report ${report.filename}`);
      } catch (saveErr) {
        logError('POST /api/bugs/dashboard/analyze (save)', parseApiError(saveErr).message);
      }

      // Log the completed run to the AI Time Saved report. Flat per-run
      // benchmark (item_count is metadata only — see computeTimeSavedMinutes).
      // A logging failure must not fail the request — the user already has the
      // streamed result — so it's fire-and-forget with its own catch.
      aiSavings
        .appendEntry({
          action_type: 'bug_analysis',
          item_count: selected.length,
          jira_keys: selected.map((b) => b.key),
        })
        .catch((logErr) =>
          logError('POST /api/bugs/dashboard/analyze (savings)', parseApiError(logErr).message)
        );

      send({ done: true, report });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/bugs/dashboard/analyze', apiErr.message);
      if (!res.headersSent) {
        return sendError(res, 500, apiErr.code, apiErr.message);
      }
      try {
        res.write(
          `data: ${JSON.stringify({ error: { code: apiErr.code, message: apiErr.message } })}\n\n`
        );
        res.end();
      } catch {
        /* response already closed */
      }
    }
  });

  // GET /api/bugs/dashboard/analyses/latest — most recent saved analysis report.
  // Backs the "expand last analysis" floating button, which can reopen a report
  // even after a page reload or server restart.
  router.get('/api/bugs/dashboard/analyses/latest', async (_req, res) => {
    try {
      const report = await loadLatestReport(ANALYSIS_DIR);
      if (!report) return sendError(res, 404, 'NO_REPORT', 'No saved analysis reports yet.');
      res.json(report);
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('GET /api/bugs/dashboard/analyses/latest', apiErr.message);
      sendError(res, 500, apiErr.code, apiErr.message);
    }
  });

  return router;
}
