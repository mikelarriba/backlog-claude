// ── Confluence AI-analysis routes ─────────────────────────────────────────────
// Takes a list of JIRA issue IDs, fetches their descriptions, and asks Claude
// to identify which Confluence pages need to be Created, Updated, or Deleted.
// /analyze now (#557) also lists the space's existing page tree — titles and
// hierarchy only, best-effort — to ground those suggestions in real pages.
// (#558) It also loads the editable "documentation-guidance" skill and folds
// it into the prompt, so the PO can tune how deep/shallow doc updates go
// without a code change. It still never writes to Confluence itself; that's
// /execute below.
import { Router } from 'express';
import { sendError, parseApiError } from '../utils/routeHelpers.js';
import { normalizeOutput } from '../services/claudeService.js';
import {
  buildConfluenceAnalysisPrompt,
  type ConfluenceAnalysisIssue,
  type ConfluenceAnalysisEpicGroup,
} from '../services/aiPromptBuilder.js';
import { jiraToMarkdown } from '../utils/transforms.js';
import { pMap } from '../utils/pMap.js';
import { config } from '../config/env.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { ConfluenceAnalyzeSchema, ConfluenceExecuteSchema } from '../schemas/confluence.js';
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
  loadCommand,
  logError,
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

        // Epic mode (#556): fetch summary+description for the *union* of the
        // requested jiraIds (in epic mode these are the selected epic keys)
        // and every epic's closed child keys, so the prompt can reason over
        // what actually shipped, not just each epic's own summary. In
        // search mode (no `epics`), this union is exactly `jiraIds` — the
        // fetch loop below behaves identically to before #556.
        const keysToFetch = new Set<string>(jiraIds as string[]);
        for (const e of epics) {
          keysToFetch.add(e.key);
          for (const childKey of e.closedChildKeys ?? []) keysToFetch.add(childKey);
        }

        const issues: ConfluenceAnalysisIssue[] = [];
        const unreachable: Array<{ key: string; error: string }> = [];

        await pMap(
          [...keysToFetch],
          async (key) => {
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
          },
          { concurrency: config.JIRA_CONCURRENCY }
        );

        if (unreachable.length > 0) {
          return sendError(
            res,
            400,
            'JIRA_ISSUE_UNREACHABLE',
            `Could not fetch ${unreachable.length} of ${keysToFetch.size} JIRA issue(s)`,
            { unreachable }
          );
        }

        const issuesByKey = new Map(issues.map((i) => [i.key, i]));
        const epicGroups: ConfluenceAnalysisEpicGroup[] = epics.map((e) => ({
          epic: issuesByKey.get(e.key) ?? {
            key: e.key,
            summary: e.summary || '',
            description: '',
          },
          children: (e.closedChildKeys ?? [])
            .map((childKey) => issuesByKey.get(childKey))
            .filter((i): i is ConfluenceAnalysisIssue => i !== undefined),
        }));

        // #557: ground the analysis in the space's real page tree — guarded
        // so /analyze still runs JIRA-only, unchanged, when Confluence isn't
        // configured, and best-effort (a listing failure is logged and
        // swallowed rather than failing the whole analysis) since this is
        // grounding context, not a hard requirement of the endpoint.
        let existingPages: Array<{ title: string; hierarchyPath: string }> = [];
        if (!confluenceNotConfigured()) {
          try {
            existingPages = (await confluenceListPages()).map((p) => ({
              title: p.title,
              hierarchyPath: p.hierarchyPath,
            }));
          } catch (err) {
            const apiErr = parseApiError(err);
            logError('POST /api/confluence/analyze', 'Failed to list Confluence pages', {
              error: apiErr.message,
            });
          }
        }

        // #558: an editable "documentation-guidance" skill controls how deep or
        // shallow the proposed doc updates go (e.g. "skip purely internal
        // work", "prefer updating an existing page"). loadCommand (not
        // loadCommandRaw) strips the frontmatter and substitutes
        // {{PRODUCT_CONTEXT}} before we hand it to the prompt builder.
        // Undefined/empty is handled by buildConfluenceAnalysisPrompt itself
        // (renders no guidance section), so no repo file is required.
        const documentationGuidance = loadCommand('documentation-guidance') ?? undefined;

        const prompt =
          epicGroups.length > 0
            ? buildConfluenceAnalysisPrompt({
                epics: epicGroups,
                existingPages,
                documentationGuidance,
              })
            : buildConfluenceAnalysisPrompt({ issues, existingPages, documentationGuidance });
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
  // Each suggestion is applied independently — a failure on one (e.g. its
  // target page can't be found) is recorded as `success:false` and does NOT
  // abort the rest of the batch (acceptance criteria: partial success). Only
  // successfully-applied operations are recorded in the undo snapshot; a
  // failed/skipped suggestion never happened, so there's nothing to reverse.
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

        // Applied with bounded concurrency (capped at JIRA_CONCURRENCY, shared with
        // the JIRA push/pull routes' identical pattern) instead of one sequential
        // Confluence round-trip per suggestion; pMap preserves each suggestion's
        // original index so `results`/`operations` below stay in source order
        // regardless of completion order.
        const perSuggestion = await pMap(
          suggestions as ConfluenceSuggestion[],
          async (
            suggestion
          ): Promise<{
            result: ConfluenceExecuteResult;
            operation: SnapshotOperation | null;
          }> => {
            const { pageTitle, action, proposedContent } = suggestion;
            try {
              if (action === 'Create') {
                const page = await confluenceCreatePage(pageTitle, proposedContent);
                return {
                  result: { pageTitle, action, pageId: page.id, success: true },
                  operation: {
                    action: 'Create',
                    pageTitle,
                    pageId: page.id,
                    previousContent: null,
                    previousVersion: null,
                  },
                };
              } else if (action === 'Update') {
                const page = await confluenceGetPageByTitle(pageTitle);
                if (!page) {
                  return {
                    result: {
                      pageTitle,
                      action,
                      pageId: null,
                      success: false,
                      error: `Page not found: ${pageTitle}`,
                    },
                    operation: null,
                  };
                }
                const updated = await confluenceUpdatePage(
                  page.id,
                  page.version,
                  pageTitle,
                  proposedContent
                );
                return {
                  result: { pageTitle, action, pageId: updated.id, success: true },
                  operation: {
                    action: 'Update',
                    pageTitle,
                    pageId: page.id,
                    previousContent: page.body,
                    previousVersion: page.version,
                  },
                };
              } else {
                // action === 'Delete'
                const page = await confluenceGetPageByTitle(pageTitle);
                if (!page) {
                  return {
                    result: {
                      pageTitle,
                      action,
                      pageId: null,
                      success: false,
                      error: `Page not found: ${pageTitle}`,
                    },
                    operation: null,
                  };
                }
                await confluenceDeletePage(page.id);
                return {
                  result: { pageTitle, action, pageId: page.id, success: true },
                  operation: {
                    action: 'Delete',
                    pageTitle,
                    pageId: page.id,
                    previousContent: page.body,
                    previousVersion: page.version,
                  },
                };
              }
            } catch (err) {
              const apiErr = parseApiError(err);
              return {
                result: { pageTitle, action, pageId: null, success: false, error: apiErr.message },
                operation: null,
              };
            }
          },
          { concurrency: config.JIRA_CONCURRENCY }
        );

        const results: ConfluenceExecuteResult[] = perSuggestion.map((p) => p.result);
        const operations: SnapshotOperation[] = perSuggestion
          .map((p) => p.operation)
          .filter((op): op is SnapshotOperation => op !== null);

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
    }
  );

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

      // Applied with bounded concurrency (same JIRA_CONCURRENCY-capped pMap pattern
      // as /execute above) instead of one sequential Confluence round-trip per
      // reversal; pMap preserves each operation's index in `reversed` so `results`
      // below stays in reverse-of-execute order regardless of completion order.
      const undoResults: ConfluenceUndoResult[] = await pMap(
        reversed,
        async (op): Promise<ConfluenceUndoResult> => {
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
            return { pageTitle: op.pageTitle, action: op.action, success: true };
          } catch (err) {
            const apiErr = parseApiError(err);
            return {
              pageTitle: op.pageTitle,
              action: op.action,
              success: false,
              error: apiErr.message,
            };
          }
        },
        { concurrency: config.JIRA_CONCURRENCY }
      );
      results.push(...undoResults);

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
