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

export default function confluenceRoutes({
  jiraRequest,
  callClaude,
  logError,
  confluenceGetSpace,
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

  return router;
}
