// ── JIRA search & pull routes ─────────────────────────────────────────────────
import { Router } from 'express';
import { sendError, parseApiError, assertFilename, normalizeType } from '../utils/routeHelpers.js';
import { LOCAL_TO_JIRA_TYPE, fetchBoardSprints } from '../services/jiraService.js';
import { closedEpicsForScope, childrenOf, pullIssues } from '../services/jiraSearchService.js';
import { findExistingByJiraId } from '../utils/docHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { JiraPullSchema } from '../schemas/jira.js';
import type { JiraRouteContext } from '../types.js';

// Shared JQL injection guard for any free-text value (sprint name, fix
// version name, …) interpolated directly into a JQL string below.
const JQL_INJECTION_RE = /\b(ORDER\s+BY|UNION|DROP|INSERT|UPDATE|DELETE|SELECT)\b/i;

export default function jiraSearchRoutes({
  TYPE_CONFIG,
  JIRA_PROJECT,
  JIRA_LABEL,
  JIRA_BOARD_ID,
  FIELD_EPIC_NAME,
  FIELD_EPIC_LINK,
  FIELD_STORY_POINTS,
  jiraRequest,
  jiraPagedRequest,
  jiraAgileRequest,
  findLocalFileByJiraId,
  jiraIssueToMarkdown,
  broadcast,
  logWarn,
  logError,
  docIndex,
}: JiraRouteContext) {
  const router = Router();

  // Bound helper — threads context dependencies into the shared utility.
  const _findExistingByJiraId = (jiraId: string) =>
    findExistingByJiraId(
      jiraId,
      (id) => docIndex.findByJiraId(id),
      findLocalFileByJiraId,
      logWarn,
      'jira/search'
    );

  // ── GET /api/jira/search ───────────────────────────────────────────────────
  router.get('/api/jira/search', async (req, res) => {
    try {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const { type = 'all', text = '', fixVersion = '', sprint = '' } = req.query;
      if (type !== 'all' && !TYPE_CONFIG[normalizeType(type)]) {
        return sendError(res, 400, 'INVALID_TYPE', 'Invalid JIRA filter type', {
          allowed: ['all', ...Object.keys(TYPE_CONFIG)],
          received: type,
        });
      }

      const sprintSanitised = String(sprint).trim().replace(/"/g, '');
      if (sprintSanitised && JQL_INJECTION_RE.test(sprintSanitised)) {
        return sendError(res, 400, 'INVALID_PARAM', 'Invalid sprint parameter');
      }

      const typeClause =
        type === 'all'
          ? `issuetype in ("New Feature", Epic, Story, Improvement, Task, Bug)`
          : type === 'story'
            ? `issuetype in ("Story", "Improvement")`
            : // @ts-expect-error — Express query type is string at runtime, TS sees union with ParsedQs
              `issuetype = "${LOCAL_TO_JIRA_TYPE[type] || 'Epic'}"`;

      // @ts-expect-error — Express query values are string | string[] | ParsedQs; text is always string here
      const textClause = text.trim() ? ` AND text ~ "${text.trim().replace(/"/g, '')}"` : '';
      // @ts-expect-error — Express query values are string | string[] | ParsedQs; fixVersion is always string here
      const fixVersionClause = fixVersion.trim()
        ? // @ts-expect-error — see above
          ` AND fixVersion = "${fixVersion.trim().replace(/"/g, '')}"`
        : '';
      const sprintClause = sprintSanitised ? ` AND sprint = "${sprintSanitised}"` : '';
      const jql = `project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} AND statusCategory != Done AND ${typeClause}${textClause}${fixVersionClause}${sprintClause} ORDER BY updated DESC`;
      const fields = `summary,issuetype,status,priority,fixVersions,${FIELD_EPIC_NAME},description`;
      type JiraSearchIssue = {
        key: string;
        fields: Record<string, unknown> & {
          summary?: string;
          issuetype?: { name?: string };
          status?: { name?: string };
          priority?: { name?: string };
          fixVersions?: Array<{ name?: string }>;
        };
      };
      const rawIssues = (await jiraPagedRequest(jql, fields, {
        maxResults: 100,
        maxTotal: 500,
      })) as JiraSearchIssue[];

      const issues = await Promise.all(
        rawIssues.map(async (issue) => {
          const iss = issue;
          const existing = await _findExistingByJiraId(iss.key);
          return {
            key: iss.key,
            summary: String(iss.fields.summary || ''),
            epicName: String(iss.fields[FIELD_EPIC_NAME] || ''),
            issuetype: iss.fields.issuetype?.name || '',
            status: iss.fields.status?.name || '',
            priority: iss.fields.priority?.name || '',
            fixVersions: (iss.fields.fixVersions || []).map((v) => v.name || '').filter(Boolean),
            localExists: !!existing,
            localFilename: existing?.filename || null,
            localDocType: existing?.docType || null,
          };
        })
      );

      res.json({ issues, total: rawIssues.length });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'GET /api/jira/search',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/jira/versions ─────────────────────────────────────────────────
  router.get('/api/jira/versions', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    try {
      type JiraVersion = { id: string; name: string; released?: boolean; archived?: boolean };
      const data = ((await jiraRequest('GET', `/project/${JIRA_PROJECT}/versions`)) ||
        []) as JiraVersion[];
      const versions = data.map((v) => ({
        id: v.id,
        name: v.name,
        released: !!v.released,
        archived: !!v.archived,
      }));
      versions.sort((a, b) => {
        if (a.released !== b.released) return a.released ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      res.json({ versions });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'GET /api/jira/versions',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/jira/by-fix-version/:version ───────────────────────────────────
  // Discovers JIRA issues for a fix version that may not exist locally yet —
  // distinct from the "Check JIRA" sync flow, which only refreshes issues that
  // already have a local file. Backend foundation for the future "Sync PI from
  // JIRA" button (#350); Done issues are intentionally included so the user can
  // decide whether to import them.
  router.get('/api/jira/by-fix-version/:version', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    const version = String(req.params.version || '').trim();
    if (!version) {
      return sendError(res, 400, 'INVALID_VERSION', 'Fix version must not be blank');
    }

    try {
      const jql = `fixVersion = "${version.replace(/"/g, '')}" AND project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} ORDER BY issuetype ASC`;
      const fields = `summary,issuetype,status,priority,fixVersions,${FIELD_EPIC_NAME},${FIELD_STORY_POINTS}`;
      type JiraByFixVersionIssue = {
        key: string;
        fields: Record<string, unknown> & {
          summary?: string;
          issuetype?: { name?: string };
          status?: { name?: string };
          priority?: { name?: string };
        };
      };
      const rawIssues = (await jiraPagedRequest(jql, fields, {
        maxResults: 100,
        maxTotal: 500,
      })) as JiraByFixVersionIssue[];

      const issues = rawIssues.map((issue) => {
        const existing = docIndex.findByJiraId(issue.key);
        return {
          key: issue.key,
          summary: String(issue.fields.summary || ''),
          issuetype: issue.fields.issuetype?.name || '',
          status: issue.fields.status?.name || '',
          priority: issue.fields.priority?.name || '',
          localExists: !!existing,
          localFilename: existing?.filename || null,
        };
      });

      res.json({ fixVersion: version, total: rawIssues.length, issues });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'GET /api/jira/by-fix-version/:version',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/jira/closed-epics ──────────────────────────────────────────────
  // Documentation view support (#554): given a sprint or fix version, resolve
  // its date window and surface the Epics that contain issues *closed* (Done +
  // resolved) during that window — the inverse of /search's "open work only"
  // JQL. Used by the "Ask AI" Confluence-update flow so a PO can see what
  // shipped in the sprint/PI, grouped under parent epics.
  router.get('/api/jira/closed-epics', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    const sprintRaw = String(req.query.sprint || '').trim();
    const fixVersionRaw = String(req.query.fixVersion || '').trim();

    if (!sprintRaw && !fixVersionRaw) {
      return sendError(
        res,
        400,
        'INVALID_PARAM',
        'One of sprint or fixVersion query parameters is required'
      );
    }
    if (sprintRaw && fixVersionRaw) {
      return sendError(res, 400, 'INVALID_PARAM', 'Provide only one of sprint or fixVersion');
    }

    const scopeType: 'sprint' | 'fixversion' = sprintRaw ? 'sprint' : 'fixversion';
    const scopeValue = (sprintRaw || fixVersionRaw).replace(/"/g, '');
    if (JQL_INJECTION_RE.test(scopeValue)) {
      return sendError(
        res,
        400,
        'INVALID_PARAM',
        `Invalid ${scopeType === 'sprint' ? 'sprint' : 'fixVersion'} parameter`
      );
    }

    try {
      const result = await closedEpicsForScope(scopeType, scopeValue, {
        jiraRequest,
        jiraPagedRequest,
        jiraAgileRequest,
        findExisting: _findExistingByJiraId,
        JIRA_PROJECT,
        JIRA_LABEL,
        JIRA_BOARD_ID,
        FIELD_EPIC_NAME,
        FIELD_EPIC_LINK,
      } as never);
      if (!result.ok) return sendError(res, result.status, result.code, result.message);
      res.json({ scope: result.scope, epics: result.epics, total: result.epics.length });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'GET /api/jira/closed-epics',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/jira/board-sprints ─────────────────────────────────────────────
  // Exposes the JIRA board's active/future sprints (full objects, not just the
  // name→id map ensureSprintCache keeps for jira-push-sprints) so the frontend
  // can auto-suggest sprint names when a PI has no sprints configured (#352).
  router.get('/api/jira/board-sprints', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    // Unlike the missing-token case, a missing board is an expected, normal
    // state the frontend should handle gracefully — so 200, not 503/400.
    if (!JIRA_BOARD_ID) {
      return res.json({ sprints: [], boardNotConfigured: true });
    }

    try {
      const rawSprints = await fetchBoardSprints(jiraAgileRequest, JIRA_BOARD_ID);
      const sprints = rawSprints.map((s) => ({
        id: s.id,
        name: s.name,
        state: s.state,
        startDate: s.startDate,
        endDate: s.endDate,
      }));
      res.json({ sprints });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'GET /api/jira/board-sprints',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/jira/children/:key ─────────────────────────────────────────────
  router.get('/api/jira/children/:key', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const { parentKey, parentType, children } = await childrenOf(req.params.key, {
        jiraRequest,
        jiraPagedRequest,
        findExisting: _findExistingByJiraId,
        JIRA_PROJECT,
        FIELD_EPIC_LINK,
      });
      res.json({ parentKey, parentType, children });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'GET /api/jira/children/:key',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/pull ────────────────────────────────────────────────────
  router.post('/api/jira/pull', validateBody(JiraPullSchema), async (req, res) => {
    try {
      const { keys, overwriteKeys = [], parentLink = null } = req.body;

      // Validate parentLink.filename format (allow-list pattern — prevents path traversal)
      if (parentLink?.filename) assertFilename(parentLink.filename);

      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const { pulled, conflicts } = await pullIssues(
        { keys, overwriteKeys, parentLink },
        {
          jiraRequest,
          findExisting: _findExistingByJiraId,
          jiraIssueToMarkdown,
          docIndex,
          TYPE_CONFIG,
          broadcast,
          FIELD_EPIC_NAME,
          FIELD_STORY_POINTS,
        }
      );

      res.json({ pulled, conflicts });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/jira/pull',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
