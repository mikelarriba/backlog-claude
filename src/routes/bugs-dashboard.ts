// ── Bug Dashboard routes — JIRA data pipeline & AI analysis ──────────────────
import { Router } from 'express';
import path from 'node:path';
import { sendError, setupSSE, parseApiError } from '../utils/routeHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { BugAnalyzeSchema } from '../schemas/bugs-dashboard.js';
import type { JiraRouteContext } from '../types.js';
import {
  assembleDashboard,
  buildAnalysisPrompt,
  createDashboardCache,
  fetchBugs,
  loadHistory,
  loadLatestReport,
  recordTodaySnapshot,
  saveHistory,
  seedSnapshots,
  saveReport,
  selectCachedBugs,
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
  const cache = createDashboardCache();
  // Sibling of docs/bugs/ — e.g. docs/bug-analysis/.
  const ANALYSIS_DIR = path.join(path.dirname(BUGS_DIR), 'bug-analysis');
  // Persisted daily snapshot history backing the chart. Lives under
  // bug-analysis/ (derived data) — NOT docs/bugs/, whose *.md files are indexed
  // as bug documents, which would turn this file into a phantom bug.
  const HISTORY_FILE = path.join(ANALYSIS_DIR, 'history.md');

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

      const cached = force ? null : cache.get();
      if (cached) {
        send({ type: 'progress', stage: 'cache', message: 'Using cached data…' });
        send({ type: 'complete', data: cached });
        return res.end();
      }

      const now = Date.now();

      // The chart is driven by persisted daily snapshots. On the first-ever load
      // (empty history) we seed ~12 weeks from a one-off changelog replay, which
      // is the only path that needs the (heavier) changelog expansion.
      const history = await loadHistory(HISTORY_FILE);
      const needSeed = history.length === 0;

      const deps = { project: JIRA_PROJECT, label: JIRA_LABEL, jiraRequest, logInfo };
      const onProg = (p: Parameters<typeof send>[0]) =>
        send({ type: 'progress', ...(p as object) });

      // Always fetch the full set (closed included) so counts and the table are
      // complete; the client filters the table by the "Include closed" toggle.
      // Seeding needs the changelog; if that heavier fetch fails (e.g. JIRA
      // timeout under load), fall back to a lightweight fetch and skip seeding —
      // the dashboard still renders today's data, and the seed is retried on the
      // next load (history stays empty because we don't persist a seedless run).
      let fetchedBugs: unknown[];
      let seeded: Awaited<ReturnType<typeof loadHistory>>;
      let persist = true;
      try {
        fetchedBugs = await fetchBugs(true, deps, onProg, needSeed);
        seeded = needSeed ? seedSnapshots(fetchedBugs) : history;
      } catch (seedErr) {
        if (!needSeed) throw seedErr;
        logError('GET /api/bugs/dashboard (seed)', parseApiError(seedErr).message);
        send({ type: 'progress', stage: 'fetching', message: 'Retrying without history…' });
        fetchedBugs = await fetchBugs(true, deps, onProg, false);
        seeded = [];
        persist = false; // don't lock in an empty history; retry seed next load
      }

      send({
        type: 'progress',
        stage: 'processing',
        message: `Processing ${fetchedBugs.length} bugs…`,
        fetched: fetchedBugs.length,
        total: fetchedBugs.length,
      });

      // Record/refresh today's row; persist unless the seed failed this run.
      const updatedHistory = recordTodaySnapshot(seeded, fetchedBugs);
      if (persist) {
        try {
          await saveHistory(HISTORY_FILE, updatedHistory);
        } catch (histErr) {
          // A persistence failure must not break the dashboard response.
          logError('GET /api/bugs/dashboard (history)', parseApiError(histErr).message);
        }
      }

      const data = assembleDashboard(fetchedBugs, updatedHistory);
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

      // Same freshness check the GET route uses for cache reuse — without it this
      // route could silently analyze arbitrarily stale data (#540).
      const selected = selectCachedBugs(cache, bugKeys);
      if (!selected) {
        return sendError(
          res,
          400,
          'STALE_CACHE',
          'Dashboard data is stale — reload the dashboard before analyzing.'
        );
      }

      if (selected.length === 0)
        return sendError(
          res,
          400,
          'NO_BUGS_FOUND',
          'None of the specified bug keys were found. Load the dashboard first.'
        );

      const prompt = buildAnalysisPrompt(selected);

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
