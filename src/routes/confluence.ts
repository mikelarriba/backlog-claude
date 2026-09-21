// ── Confluence AI-analysis routes ─────────────────────────────────────────────
// Takes a list of JIRA issue IDs, fetches their descriptions, and asks Claude
// to identify which Confluence pages need to be Created, Updated, or Deleted.
// /analyze now (#557) also lists the space's existing page tree — titles and
// hierarchy only, best-effort — to ground those suggestions in real pages.
// (#558) It also loads the editable "documentation-guidance" skill and folds
// it into the prompt, so the PO can tune how deep/shallow doc updates go
// without a code change. It still never writes to Confluence itself; that's
// /execute below.
//
// #670: the JIRA-key union fetching, AI-suggestion parsing, page-link
// resolution, and /execute + /undo Create/Update/Delete orchestration all
// live in confluenceAnalysisService.ts — this file only parses requests,
// calls the service, and shapes responses (thin-route pattern, see
// CONTRIBUTING.md).
import { Router } from 'express';
import { sendError, parseApiError } from '../utils/routeHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import {
  ConfluenceAnalyzeSchema,
  ConfluenceExecuteSchema,
  ConfluenceExportSchema,
} from '../schemas/confluence.js';
import { buildConfluenceSuggestionsPdf } from '../services/confluencePdfExport.js';
import { getSnapshot, deleteSnapshot } from '../services/confluenceSnapshotStore.js';
import {
  analyzeConfluence,
  executeConfluenceSuggestions,
  undoConfluenceSnapshot,
  type ConfluenceSuggestion,
} from '../services/confluenceAnalysisService.js';
import type { ConfluenceRouteContext } from '../types.js';

// Confluence credentials are read from process.env directly (not from the
// context's CONFLUENCE_BASE/CONFLUENCE_SPACE_KEY, which are captured once at
// server startup) so this guard — like GET /api/confluence/test's — always
// reflects the *current* environment. This also lets integration tests toggle
// CONFLUENCE_BASE_URL/CONFLUENCE_API_TOKEN mid-suite without restarting the app.
function confluenceNotConfigured(): boolean {
  return !process.env.CONFLUENCE_BASE_URL || !process.env.CONFLUENCE_API_TOKEN;
}

export default function confluenceRoutes({
  jiraPagedRequest,
  callClaude,
  loadCommand,
  logError,
  logWarn,
  CONFLUENCE_BASE,
  confluenceGetSpace,
  confluenceGetPageByTitle,
  confluenceListPages,
  confluenceCreatePage,
  confluenceUpdatePage,
  confluenceDeletePage,
}: ConfluenceRouteContext) {
  const router = Router();

  // ── POST /api/confluence/analyze ────────────────────────────────────────────
  router.post(
    '/api/confluence/analyze',
    validateBody(ConfluenceAnalyzeSchema),
    async (req, res) => {
      try {
        const { jiraIds } = req.body;
        const epics = (req.body.epics ?? []) as Array<{
          key: string;
          summary?: string;
          closedChildKeys?: string[];
        }>;

        if (!process.env.JIRA_API_TOKEN) {
          return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
        }

        const result = await analyzeConfluence({
          jiraIds,
          epics,
          jiraPagedRequest,
          callClaude,
          loadCommand,
          logError,
          logWarn,
          confluenceListPages,
          confluenceConfigured: !confluenceNotConfigured(),
          CONFLUENCE_BASE,
        });

        if (!result.ok) {
          return sendError(res, 400, result.code, result.message, {
            unreachable: result.unreachable,
          });
        }

        res.json({ suggestions: result.suggestions, warnings: result.warnings });
      } catch (err) {
        const apiErr = parseApiError(err);
        logError(
          'POST /api/confluence/analyze',
          apiErr.message,
          apiErr.details as Record<string, unknown> | undefined
        );
        sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
      }
    }
  );

  // ── POST /api/confluence/export/pdf ─────────────────────────────────────────
  // Renders the client's current AI-analysis report (from /analyze, possibly
  // trimmed/edited client-side) as a PDF. POST (not GET) because the
  // suggestions array is client-side state, not something this server can
  // look up — there's no server-side "last analysis" to key a GET off of.
  // Pure formatting: no Confluence/JIRA calls, no snapshot, nothing applied.
  router.post(
    '/api/confluence/export/pdf',
    validateBody(ConfluenceExportSchema),
    async (req, res) => {
      try {
        const { suggestions, scope } = req.body as {
          suggestions: ConfluenceSuggestion[];
          scope?: string;
        };
        const buffer = await buildConfluenceSuggestionsPdf(suggestions, { scope });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="proposed-documentation-changes.pdf"'
        );
        res.send(buffer);
      } catch (err) {
        const apiErr = parseApiError(err, 'EXPORT_FAILED', 'PDF export failed');
        logError('POST /api/confluence/export/pdf', apiErr.message);
        sendError(res, 500, apiErr.code, apiErr.message);
      }
    }
  );

  // ── GET /api/confluence/test ────────────────────────────────────────────────
  // Connection test used to verify Confluence credentials (env vars only — no
  // Settings UI, see #373). Reads process.env directly (rather than a
  // startup-baked config value) so it always reflects the current environment,
  // mirroring the /api/confluence/analyze JIRA-token check above. Returns
  // `{ok:false, error}` with a 503 on failure (not the standard sendError
  // envelope) — the frontend treats this endpoint specially as a live probe.
  router.get('/api/confluence/test', async (req, res) => {
    if (!process.env.CONFLUENCE_BASE_URL || !process.env.CONFLUENCE_API_TOKEN) {
      return sendError(
        res,
        503,
        'CONFLUENCE_NOT_CONFIGURED',
        'Confluence credentials not configured'
      );
    }
    try {
      const space = await confluenceGetSpace();
      res.json({ ok: true, spaceKey: space.key });
    } catch (err) {
      res.status(503).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── POST /api/confluence/execute ────────────────────────────────────────────
  // Applies the user's selected suggestions (from /analyze) against Confluence.
  // See executeConfluenceSuggestions() for the per-suggestion partial-success
  // and undo-snapshot semantics.
  router.post(
    '/api/confluence/execute',
    validateBody(ConfluenceExecuteSchema),
    async (req, res) => {
      try {
        const { suggestions } = req.body;

        if (confluenceNotConfigured()) {
          return sendError(
            res,
            503,
            'CONFLUENCE_NOT_CONFIGURED',
            'Confluence credentials not configured'
          );
        }

        const { snapshotId, results } = await executeConfluenceSuggestions({
          suggestions,
          confluenceGetPageByTitle,
          confluenceCreatePage,
          confluenceUpdatePage,
          confluenceDeletePage,
        });

        res.json({ snapshotId, results });
      } catch (err) {
        const apiErr = parseApiError(err);
        logError(
          'POST /api/confluence/execute',
          apiErr.message,
          apiErr.details as Record<string, unknown> | undefined
        );
        sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
      }
    }
  );

  // ── POST /api/confluence/undo/:snapshotId ───────────────────────────────────
  // Reverses a prior /execute call using its stored snapshot. The snapshot is
  // removed after the attempt regardless of how many individual reversals
  // succeeded, per the issue spec (a snapshot is a single-use undo window,
  // not a retryable queue). See undoConfluenceSnapshot() for the per-op
  // partial-success semantics.
  router.post('/api/confluence/undo/:snapshotId', async (req, res) => {
    try {
      const { snapshotId } = req.params;
      const snapshot = getSnapshot(snapshotId);
      if (!snapshot) {
        return sendError(
          res,
          404,
          'SNAPSHOT_NOT_FOUND',
          'Undo window expired or snapshot not found'
        );
      }

      if (confluenceNotConfigured()) {
        return sendError(
          res,
          503,
          'CONFLUENCE_NOT_CONFIGURED',
          'Confluence credentials not configured'
        );
      }

      const results = await undoConfluenceSnapshot({
        operations: snapshot.operations,
        confluenceGetPageByTitle,
        confluenceCreatePage,
        confluenceUpdatePage,
        confluenceDeletePage,
      });

      deleteSnapshot(snapshotId);
      res.json({ results });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/confluence/undo',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
