// ── JIRA comments inbox routes ────────────────────────────────────────────────
// Surfaces recent JIRA comments across the MIDAS project (date + mention
// filtered), and lets the user reply with an optional AI polish step before
// posting back to JIRA. JIRA has no global comment feed, so we run one paged JQL
// search that expands the `comment` field inline and flatten client-side —
// avoiding an API call per issue.
import { Router } from 'express';
import { sendError, handleRouteError } from '../utils/routeHelpers.js';
import { jiraToMarkdown } from '../utils/transforms.js';
import { buildImproveCommentPrompt } from '../services/aiPromptBuilder.js';
import { flattenAndFilterComments, type RawCommentIssue } from '../services/jiraCommentService.js';
import { validateBody } from '../utils/validateMiddleware.js';
import {
  JiraCommentsQuerySchema,
  JiraPostCommentSchema,
  JiraImproveCommentSchema,
} from '../schemas/jira.js';
import type { JiraRouteContext } from '../types.js';

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/i;

// The feed never looks back more than 2 months, whatever the client asks for.
function twoMonthsAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return d.toISOString().slice(0, 10);
}

// Resolve the effective lower bound: default to the 2-month floor when the
// client sends no `from` (no date preset active), and clamp any provided `from`
// so it can never reach further back than the floor. Date strings are YYYY-MM-DD,
// so lexical comparison is correct.
function resolveFrom(requested?: string): string {
  const floor = twoMonthsAgo();
  if (!requested) return floor;
  return requested < floor ? floor : requested;
}

export default function jiraCommentsRoutes({
  JIRA_PROJECT,
  JIRA_LABEL,
  JIRA_BASE,
  jiraPagedRequest,
  getMyself,
  addComment,
  callClaude,
  logInfo,
  logError,
}: JiraRouteContext) {
  const router = Router();

  // ── GET /api/jira/comments ─────────────────────────────────────────────────
  router.get('/api/jira/comments', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    const parsed = JiraCommentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Invalid query'
      );
    }
    const from = resolveFrom(parsed.data.from);
    const to = parsed.data.to;
    const mentionedOnly = parsed.data.mentionedOnly === 'true';
    const notRepliedByMe = parsed.data.notRepliedByMe === 'true';

    try {
      // `from`/`to` are regex-validated to YYYY-MM-DD, so they're safe to
      // interpolate into JQL. Narrow the fetch by issue-level `updated`; the
      // per-comment date filtering happens in flattenAndFilterComments.
      const jql = `project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} AND updated >= "${from}" ORDER BY updated DESC`;
      const rawIssues = (await jiraPagedRequest(jql, 'summary,comment', {
        maxResults: 100,
        maxTotal: 500,
      })) as RawCommentIssue[];

      let myName = '';
      try {
        myName = (await getMyself()).name;
      } catch (err) {
        // Non-fatal: without identity we simply can't flag/filter mentions.
        logError('GET /api/jira/comments', 'could not resolve current user for mention detection', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const comments = flattenAndFilterComments(rawIssues, {
        from,
        to,
        mentionedOnly,
        notRepliedByMe,
        myName,
        transformBody: (raw) => jiraToMarkdown(raw),
      });

      res.json({ comments, jiraBase: JIRA_BASE, myName, total: comments.length });
    } catch (err) {
      handleRouteError(res, err, { scope: 'GET /api/jira/comments', logError });
    }
  });

  // ── POST /api/jira/comments/improve ────────────────────────────────────────
  // Registered before the :issueKey route so "improve" is never mistaken for a
  // key. Also guarded by the ISSUE_KEY_RE check in the :issueKey handler.
  router.post(
    '/api/jira/comments/improve',
    validateBody(JiraImproveCommentSchema),
    async (req, res) => {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const { text } = req.body as { text: string };
      try {
        const improved = await callClaude(buildImproveCommentPrompt(text));
        res.json({ improved: improved.trim() });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'AI call failed';
        sendError(res, 502, 'AI_ERROR', message);
      }
    }
  );

  // ── POST /api/jira/comments/:issueKey ──────────────────────────────────────
  router.post(
    '/api/jira/comments/:issueKey',
    validateBody(JiraPostCommentSchema),
    async (req, res) => {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const issueKey = String(req.params.issueKey || '').toUpperCase();
      if (!ISSUE_KEY_RE.test(issueKey)) {
        return sendError(res, 400, 'INVALID_KEY', 'Invalid JIRA issue key');
      }
      const { text } = req.body as { text: string };

      try {
        const created = (await addComment(issueKey, text)) as {
          id?: string;
          author?: { name?: string; displayName?: string };
          created?: string;
        };
        logInfo('POST /api/jira/comments', `Posted comment to ${issueKey}`);
        res.json({
          success: true,
          issueKey,
          comment: {
            id: created?.id || '',
            author: created?.author?.displayName || created?.author?.name || '',
            created: created?.created || '',
          },
        });
      } catch (err) {
        handleRouteError(res, err, { scope: 'POST /api/jira/comments/:issueKey', logError });
      }
    }
  );

  return router;
}
