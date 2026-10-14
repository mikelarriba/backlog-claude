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
  JiraUserSearchSchema,
} from '../schemas/jira.js';
import type { JiraRouteContext } from '../types.js';

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/i;

// Normalizes the ticket filter the user typed in the Comments view. A bare
// number (e.g. "9768") is resolved against the configured project
// (EAMDM-9768); a full key is uppercased and validated as-is. Returns '' when
// the input can't be turned into a valid key.
export function resolveIssueKey(raw: string | undefined, project: string): string {
  const v = String(raw || '')
    .trim()
    .toUpperCase();
  if (!v) return '';
  if (/^\d+$/.test(v)) return project ? `${project.toUpperCase()}-${v}` : '';
  return ISSUE_KEY_RE.test(v) ? v : '';
}

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
  jiraRequest,
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
    const issueKey = resolveIssueKey(parsed.data.issueKey, JIRA_PROJECT);
    // A ticket filter targets one issue directly, so the 2-month floor and the
    // per-comment date filtering are both bypassed — the user explicitly wants
    // that ticket's comments regardless of age.
    const from = issueKey ? undefined : resolveFrom(parsed.data.from);
    const to = issueKey ? undefined : parsed.data.to;
    const mentionedOnly = parsed.data.mentionedOnly === 'true';
    const notRepliedByMe = parsed.data.notRepliedByMe === 'true';

    try {
      // `from`/`to` are regex-validated to YYYY-MM-DD and issueKey is
      // normalized to a strict KEY-123 shape, so both are safe to interpolate
      // into JQL. Narrow the fetch by issue-level `updated` for the feed; the
      // per-comment date filtering happens in flattenAndFilterComments.
      const jql = issueKey
        ? `issuekey = "${issueKey}" ORDER BY updated DESC`
        : `project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} AND updated >= "${from}" ORDER BY updated DESC`;
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

  // ── GET /api/jira/users ────────────────────────────────────────────────────
  // Typeahead for the @-mention picker in the reply box. Proxies JIRA Server's
  // user search; the client inserts the chosen user as `[~name]` wiki markup,
  // which JIRA renders as a mention (and which the mention-detection regex in
  // flattenAndFilterComments already recognizes).
  router.get('/api/jira/users', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    const parsed = JiraUserSearchSchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Invalid query'
      );
    }

    try {
      const raw = (await jiraRequest(
        'GET',
        `/user/search?username=${encodeURIComponent(parsed.data.query)}&maxResults=10`
      )) as Array<{
        name?: string;
        displayName?: string;
        emailAddress?: string;
        avatarUrls?: Record<string, string>;
      }>;

      const users = (Array.isArray(raw) ? raw : [])
        .filter((u) => u.name)
        .map((u) => ({
          name: u.name as string,
          displayName: u.displayName || (u.name as string),
          email: u.emailAddress || '',
          avatarUrl: u.avatarUrls?.['24x24'] || u.avatarUrls?.['16x16'] || '',
        }));

      res.json({ users });
    } catch (err) {
      handleRouteError(res, err, { scope: 'GET /api/jira/users', logError });
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
