// ── JIRA search & pull routes ─────────────────────────────────────────────────
import { Router } from 'express';
import type { Request, Response } from 'express';
import { sendError, parseApiError, assertFilename, normalizeType } from '../utils/routeHelpers.js';
import { LOCAL_TO_JIRA_TYPE, fetchBoardSprints } from '../services/jiraService.js';
import {
  closedEpicsForScope,
  childrenOf,
  pullIssues,
  searchOpenIssues,
  issuesByFixVersion,
  listProjectVersions,
} from '../services/jiraSearchService.js';
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

  // Shared handler wrapper: JIRA token guard + uniform 500 error mapping.
  // `requireToken: false` is for handlers that validate their body first.
  const jiraHandler =
    (
      label: string,
      fn: (req: Request, res: Response) => Promise<unknown>,
      { requireToken = true }: { requireToken?: boolean } = {}
    ) =>
    async (req: Request, res: Response) => {
      if (requireToken && !process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
      try {
        await fn(req, res);
      } catch (err) {
        const apiErr = parseApiError(err);
        logError(label, apiErr.message, apiErr.details as Record<string, unknown> | undefined);
        sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
      }
    };

  // ── GET /api/jira/search ───────────────────────────────────────────────────
  router.get(
    '/api/jira/search',
    jiraHandler(
      'GET /api/jira/search',
      async (req, res) => {
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

        const result = await searchOpenIssues(
          {
            type: String(type),
            text: String(text),
            fixVersion: String(fixVersion),
            sprint: sprintSanitised,
          },
          {
            jiraPagedRequest,
            findExisting: _findExistingByJiraId,
            JIRA_PROJECT,
            JIRA_LABEL,
            FIELD_EPIC_NAME,
            localTypeToJira: LOCAL_TO_JIRA_TYPE as Record<string, string>,
          }
        );

        res.json(result);
      },
      { requireToken: false }
    )
  );

  // ── GET /api/jira/versions ─────────────────────────────────────────────────
  router.get(
    '/api/jira/versions',
    jiraHandler('GET /api/jira/versions', async (req, res) => {
      const versions = await listProjectVersions(jiraRequest, JIRA_PROJECT);
      res.json({ versions });
    })
  );

  // ── GET /api/jira/by-fix-version/:version ───────────────────────────────────
  // Discovers JIRA issues for a fix version that may not exist locally yet —
  // distinct from the "Check JIRA" sync flow, which only refreshes issues that
  // already have a local file. Backend foundation for the future "Sync PI from
  // JIRA" button (#350); Done issues are intentionally included so the user can
  // decide whether to import them.
  router.get(
    '/api/jira/by-fix-version/:version',
    jiraHandler('GET /api/jira/by-fix-version/:version', async (req, res) => {
      const version = String(req.params.version || '').trim();
      if (!version) {
        return sendError(res, 400, 'INVALID_VERSION', 'Fix version must not be blank');
      }

      const result = await issuesByFixVersion(version, {
        jiraPagedRequest,
        JIRA_PROJECT,
        JIRA_LABEL,
        FIELD_EPIC_NAME,
        FIELD_STORY_POINTS,
        findLocal: (id) => docIndex.findByJiraId(id),
      });
      res.json(result);
    })
  );

  // ── GET /api/jira/closed-epics ──────────────────────────────────────────────
  // Documentation view support (#554): given a sprint or fix version, resolve
  // its date window and surface the Epics that contain issues *closed* (Done +
  // resolved) during that window — the inverse of /search's "open work only"
  // JQL. Used by the "Ask AI" Confluence-update flow so a PO can see what
  // shipped in the sprint/PI, grouped under parent epics.
  router.get(
    '/api/jira/closed-epics',
    jiraHandler('GET /api/jira/closed-epics', async (req, res) => {
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
    })
  );

  // ── GET /api/jira/board-sprints ─────────────────────────────────────────────
  // Exposes the JIRA board's active/future sprints (full objects, not just the
  // name→id map ensureSprintCache keeps for jira-push-sprints) so the frontend
  // can auto-suggest sprint names when a PI has no sprints configured (#352).
  router.get(
    '/api/jira/board-sprints',
    jiraHandler('GET /api/jira/board-sprints', async (req, res) => {
      // Unlike the missing-token case, a missing board is an expected, normal
      // state the frontend should handle gracefully — so 200, not 503/400.
      if (!JIRA_BOARD_ID) {
        return res.json({ sprints: [], boardNotConfigured: true });
      }

      // Include closed sprints too (#): the Documentation "By Sprint" tab
      // documents what shipped, so a PO needs to pick already-completed
      // sprints, not just active/future ones. ensureSprintCache still uses the
      // active,future default for its push-time name→id lookup.
      const rawSprints = await fetchBoardSprints(
        jiraAgileRequest,
        JIRA_BOARD_ID,
        'active,future,closed'
      );
      const sprints = rawSprints.map((s) => ({
        id: s.id,
        name: s.name,
        state: s.state,
        startDate: s.startDate,
        endDate: s.endDate,
      }));
      res.json({ sprints });
    })
  );

  // ── GET /api/jira/children/:key ─────────────────────────────────────────────
  router.get(
    '/api/jira/children/:key',
    jiraHandler('GET /api/jira/children/:key', async (req, res) => {
      const { parentKey, parentType, children } = await childrenOf(String(req.params.key), {
        jiraRequest,
        jiraPagedRequest,
        findExisting: _findExistingByJiraId,
        JIRA_PROJECT,
        FIELD_EPIC_LINK,
      });
      res.json({ parentKey, parentType, children });
    })
  );

  // ── POST /api/jira/pull ────────────────────────────────────────────────────
  router.post(
    '/api/jira/pull',
    validateBody(JiraPullSchema),
    jiraHandler(
      'POST /api/jira/pull',
      async (req, res) => {
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
      },
      { requireToken: false }
    )
  );

  return router;
}
