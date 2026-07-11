// ── Confluence AI-analysis routes ─────────────────────────────────────────────
// Takes a list of JIRA issue IDs, fetches their descriptions, and asks Claude
// to identify which Confluence pages need to be Created, Updated, or Deleted.
// Confluence read/write access does not exist yet (see #373) — this endpoint
// only *proposes* changes; it never talks to Confluence itself.
import { Router } from 'express';
import { sendError, parseApiError } from '../utils/routeHelpers.js';
import { normalizeOutput } from '../services/claudeService.js';
import { buildConfluenceAnalysisPrompt } from '../services/aiPromptBuilder.js';
import { jiraToMarkdown } from '../utils/transforms.js';
import {
  createSnapshot,
  getSnapshot,
  deleteSnapshot,
  type SnapshotOperation,
} from '../services/confluenceSnapshotStore.js';
import type { ConfluenceRouteContext } from '../types.js';

export interface ConfluenceSuggestion {
  pageTitle: string;
  hierarchyPath: string;
  action: 'Create' | 'Update' | 'Delete';
  currentContent: string;
  proposedContent: string;
}

const VALID_ACTIONS = new Set(['Create', 'Update', 'Delete']);

// Exported for unit testing. There's no precedent elsewhere in this codebase
// for parsing structured JSON out of an AI response (the rest of the app has
// Claude emit markdown with literal separators like ===SPLIT===), so this
// establishes the pattern: strip any markdown code fence via the existing
// normalizeOutput() helper, JSON.parse, then shape-validate. Any failure
// throws a plain Error, which the route's catch block below turns into a 500
// via parseApiError/sendError — giving a descriptive error per the issue's
// acceptance criteria without needing a bespoke error type.
export function parseConfluenceSuggestions(raw: string): ConfluenceSuggestion[] {
  const cleaned = normalizeOutput(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI returned a response that was not valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AI response was not a JSON array of suggestions');
  }

  return parsed.map((item, idx) => {
    const s = item as Record<string, unknown> | null;
    if (
      !s ||
      typeof s !== 'object' ||
      typeof s.pageTitle !== 'string' ||
      typeof s.action !== 'string' ||
      !VALID_ACTIONS.has(s.action)
    ) {
      throw new Error(
        `AI response suggestion at index ${idx} is missing required fields (pageTitle, action) or has an invalid action`
      );
    }
    return {
      pageTitle: s.pageTitle,
      hierarchyPath: typeof s.hierarchyPath === 'string' ? s.hierarchyPath : '',
      action: s.action as ConfluenceSuggestion['action'],
      currentContent: typeof s.currentContent === 'string' ? s.currentContent : '',
      proposedContent: typeof s.proposedContent === 'string' ? s.proposedContent : '',
    };
  });
}

export interface ConfluenceExecuteResult {
  pageTitle: string;
  action: ConfluenceSuggestion['action'];
  pageId: string | null;
  success: boolean;
  error?: string;
}

export interface ConfluenceUndoResult {
  pageTitle: string;
  action: ConfluenceSuggestion['action'];
  success: boolean;
  error?: string;
}

// Confluence credentials are read from process.env directly (not from the
// context's CONFLUENCE_BASE/CONFLUENCE_SPACE_KEY, which are captured once at
// server startup) so this guard — like GET /api/confluence/test's — always
// reflects the *current* environment. This also lets integration tests toggle
// CONFLUENCE_BASE_URL/CONFLUENCE_API_TOKEN mid-suite without restarting the app.
function confluenceNotConfigured(): boolean {
  return !process.env.CONFLUENCE_BASE_URL || !process.env.CONFLUENCE_API_TOKEN;
}

export default function confluenceRoutes({
  jiraRequest,
  callClaude,
  logError,
  confluenceGetSpace,
  confluenceGetPageByTitle,
  confluenceCreatePage,
  confluenceUpdatePage,
  confluenceDeletePage,
}: ConfluenceRouteContext) {
  const router = Router();

  // ── POST /api/confluence/analyze ────────────────────────────────────────────
  router.post('/api/confluence/analyze', async (req, res) => {
    try {
      const { jiraIds } = req.body;
      if (!Array.isArray(jiraIds) || jiraIds.length === 0) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'jiraIds must be a non-empty array');
      }
      if (!jiraIds.every((id) => typeof id === 'string' && id.trim())) {
        return sendError(
          res,
          400,
          'VALIDATION_ERROR',
          'jiraIds must be an array of non-empty strings'
        );
      }

      if (!process.env.JIRA_API_TOKEN) {
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
      }

      const issues: Array<{ key: string; summary: string; description: string }> = [];
      const unreachable: Array<{ key: string; error: string }> = [];

      for (const key of jiraIds as string[]) {
        try {
          const issue = (await jiraRequest(
            'GET',
            `/issue/${encodeURIComponent(key)}?fields=summary,description`
          )) as { fields?: { summary?: string; description?: string } };
          issues.push({
            key,
            summary: String(issue.fields?.summary || ''),
            description: jiraToMarkdown(issue.fields?.description || ''),
          });
        } catch (err) {
          const apiErr = parseApiError(err);
          unreachable.push({ key, error: apiErr.message });
        }
      }

      if (unreachable.length > 0) {
        return sendError(
          res,
          400,
          'JIRA_ISSUE_UNREACHABLE',
          `Could not fetch ${unreachable.length} of ${jiraIds.length} JIRA issue(s)`,
          { unreachable }
        );
      }

      const prompt = buildConfluenceAnalysisPrompt({ issues });
      const rawResponse = await callClaude(prompt);

      let suggestions: ConfluenceSuggestion[];
      try {
        suggestions = parseConfluenceSuggestions(rawResponse);
      } catch (err) {
        throw new Error(
          `AI analysis returned an unparseable response: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      res.json({ suggestions });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/confluence/analyze',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

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
  // Each suggestion is applied independently — a failure on one (e.g. its
  // target page can't be found) is recorded as `success:false` and does NOT
  // abort the rest of the batch (acceptance criteria: partial success). Only
  // successfully-applied operations are recorded in the undo snapshot; a
  // failed/skipped suggestion never happened, so there's nothing to reverse.
  router.post('/api/confluence/execute', async (req, res) => {
    try {
      const { suggestions } = req.body;
      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'suggestions must be a non-empty array');
      }
      for (const s of suggestions) {
        const item = s as Record<string, unknown> | null;
        if (
          !item ||
          typeof item !== 'object' ||
          typeof item.pageTitle !== 'string' ||
          !item.pageTitle.trim() ||
          typeof item.action !== 'string' ||
          !VALID_ACTIONS.has(item.action)
        ) {
          return sendError(
            res,
            400,
            'VALIDATION_ERROR',
            'Each suggestion must have a non-empty pageTitle and a valid action (Create, Update, Delete)'
          );
        }
      }

      if (confluenceNotConfigured()) {
        return sendError(
          res,
          503,
          'CONFLUENCE_NOT_CONFIGURED',
          'Confluence credentials not configured'
        );
      }

      const results: ConfluenceExecuteResult[] = [];
      const operations: SnapshotOperation[] = [];

      for (const suggestion of suggestions as ConfluenceSuggestion[]) {
        const { pageTitle, action, proposedContent } = suggestion;
        try {
          if (action === 'Create') {
            const page = await confluenceCreatePage(pageTitle, proposedContent);
            results.push({ pageTitle, action, pageId: page.id, success: true });
            operations.push({
              action: 'Create',
              pageTitle,
              pageId: page.id,
              previousContent: null,
              previousVersion: null,
            });
          } else if (action === 'Update') {
            const page = await confluenceGetPageByTitle(pageTitle);
            if (!page) {
              results.push({
                pageTitle,
                action,
                pageId: null,
                success: false,
                error: `Page not found: ${pageTitle}`,
              });
              continue;
            }
            const updated = await confluenceUpdatePage(
              page.id,
              page.version,
              pageTitle,
              proposedContent
            );
            results.push({ pageTitle, action, pageId: updated.id, success: true });
            operations.push({
              action: 'Update',
              pageTitle,
              pageId: page.id,
              previousContent: page.body,
              previousVersion: page.version,
            });
          } else {
            // action === 'Delete'
            const page = await confluenceGetPageByTitle(pageTitle);
            if (!page) {
              results.push({
                pageTitle,
                action,
                pageId: null,
                success: false,
                error: `Page not found: ${pageTitle}`,
              });
              continue;
            }
            await confluenceDeletePage(page.id);
            results.push({ pageTitle, action, pageId: page.id, success: true });
            operations.push({
              action: 'Delete',
              pageTitle,
              pageId: page.id,
              previousContent: page.body,
              previousVersion: page.version,
            });
          }
        } catch (err) {
          const apiErr = parseApiError(err);
          results.push({ pageTitle, action, pageId: null, success: false, error: apiErr.message });
        }
      }

      const snapshotId = createSnapshot(operations);
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
  });

  // ── POST /api/confluence/undo/:snapshotId ───────────────────────────────────
  // Reverses a prior /execute call using its stored snapshot, applying the
  // inverse of each operation in *reverse* order. Like execute, each reversal
  // is applied independently (partial success) — one failure doesn't stop the
  // rest. The snapshot is removed after the attempt regardless of how many
  // individual reversals succeeded, per the issue spec (a snapshot is a
  // single-use undo window, not a retryable queue).
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

      const results: ConfluenceUndoResult[] = [];
      const reversed = [...snapshot.operations].reverse();

      for (const op of reversed) {
        try {
          if (op.action === 'Create') {
            if (!op.pageId) throw new Error('Snapshot is missing the created page id');
            await confluenceDeletePage(op.pageId);
          } else if (op.action === 'Update') {
            if (!op.pageId || op.previousContent === null || op.previousVersion === null) {
              throw new Error('Snapshot is missing data needed to undo this update');
            }
            // The context only exposes getPageByTitle (no get-by-id), and the
            // title is stable across the original update, so re-fetch by
            // title to get the page's *actual current* version rather than
            // trusting op.previousVersion + 2 (original version, +1 for
            // execute's update, +1 again for this undo) — anything could have
            // changed the page's version between execute and undo (e.g. a
            // manual edit), so re-reading it right before the call is safer
            // than assuming no drift.
            const current = await confluenceGetPageByTitle(op.pageTitle);
            const currentVersion = current ? current.version : op.previousVersion + 1;
            await confluenceUpdatePage(
              op.pageId,
              currentVersion + 1,
              op.pageTitle,
              op.previousContent
            );
          } else {
            // Undo Delete → re-create the page. Best-effort: this creates the
            // page at the space root — the original hierarchy/parent-page
            // placement is not restored (same caveat as the issue spec).
            if (op.previousContent === null) {
              throw new Error('Snapshot is missing data needed to undo this delete');
            }
            await confluenceCreatePage(op.pageTitle, op.previousContent);
          }
          results.push({ pageTitle: op.pageTitle, action: op.action, success: true });
        } catch (err) {
          const apiErr = parseApiError(err);
          results.push({
            pageTitle: op.pageTitle,
            action: op.action,
            success: false,
            error: apiErr.message,
          });
        }
      }

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
