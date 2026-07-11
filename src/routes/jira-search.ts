// ── JIRA search & pull routes ─────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  sendError,
  ensureDir,
  parseApiError,
  assertFilename,
  normalizeType,
} from '../utils/routeHelpers.js';
import { isoDate, slugify, setFrontmatterField } from '../utils/transforms.js';
import { LOCAL_TO_JIRA_TYPE, fetchBoardSprints } from '../services/jiraService.js';
import { JIRA_LABEL_TO_TEAM, ALL_TEAM_JIRA_LABELS } from '../config/metadata.js';
import type { JiraRouteContext } from '../types.js';

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

  // docIndex.findByJiraId is the primary, O(1) lookup — it's built at startup and
  // kept in sync via docIndex.invalidate on every write, so it should never miss
  // an entry that findLocalFileByJiraId's O(n) disk scan would find. Fall back to
  // the scan only as a last-resort safety net, and log loudly when it fires so a
  // docIndex staleness bug doesn't go unnoticed.
  async function findExistingByJiraId(jiraId: string) {
    const existing = docIndex.findByJiraId(jiraId);
    if (existing) return existing;
    const fallback = await findLocalFileByJiraId(jiraId);
    if (fallback) {
      logWarn(
        'jira/search',
        `docIndex missed ${jiraId} that a full disk scan found — check docIndex sync`
      );
    }
    return fallback;
  }

  // ── GET /api/jira/search ───────────────────────────────────────────────────
  router.get('/api/jira/search', async (req, res) => {
    try {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const { type = 'all', text = '', fixVersion = '' } = req.query;
      if (type !== 'all' && !TYPE_CONFIG[normalizeType(type)]) {
        return sendError(res, 400, 'INVALID_TYPE', 'Invalid JIRA filter type', {
          allowed: ['all', ...Object.keys(TYPE_CONFIG)],
          received: type,
        });
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
      const jql = `project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} AND statusCategory != Done AND ${typeClause}${textClause}${fixVersionClause} ORDER BY updated DESC`;
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
          const existing = await findExistingByJiraId(iss.key);
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
      const key = req.params.key;
      type JiraChildIssue = {
        key: string;
        fields?: { summary?: string; issuetype?: { name?: string }; status?: { name?: string } };
      };
      type JiraParentIssue = {
        fields?: {
          issuetype?: { name?: string };
          issuelinks?: Array<{ inwardIssue?: JiraChildIssue }>;
          subtasks?: JiraChildIssue[];
        };
      };
      const issue = (await jiraRequest(
        'GET',
        `/issue/${key}?fields=issuetype,issuelinks,subtasks`
      )) as JiraParentIssue;
      const issueType = issue.fields?.issuetype?.name;
      const children: Array<Record<string, unknown>> = [];
      const seen = new Set();

      async function addChild(child: JiraChildIssue) {
        if (seen.has(child.key)) return;
        seen.add(child.key);
        const existing = await findExistingByJiraId(child.key);
        children.push({
          key: child.key,
          summary: child.fields?.summary || '',
          issuetype: child.fields?.issuetype?.name || '',
          status: child.fields?.status?.name || '',
          localExists: !!existing,
          localFilename: existing?.filename || null,
          localDocType: existing?.docType || null,
        });
      }

      // Epics: find children via Epic Link custom field — paginate to handle large epics
      if (issueType === 'Epic') {
        const fieldId = FIELD_EPIC_LINK.replace('customfield_', '');
        const jql = `cf[${fieldId}] = ${key} AND project = ${JIRA_PROJECT} AND statusCategory != Done ORDER BY issuetype ASC`;
        const childIssues = await jiraPagedRequest(jql, 'summary,issuetype,status,priority', {
          maxResults: 100,
          maxTotal: 500,
        });
        for (const child of childIssues) await addChild(child as JiraChildIssue);
      }

      // New Features / Epics: check issue links (inward = contained children)
      for (const link of issue.fields?.issuelinks || []) {
        if (link.inwardIssue) await addChild(link.inwardIssue);
      }

      // Subtasks
      for (const st of issue.fields?.subtasks || []) await addChild(st);

      res.json({ parentKey: key, parentType: issueType, children });
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
  router.post('/api/jira/pull', async (req, res) => {
    try {
      const { keys = [], overwriteKeys = [], parentLink = null } = req.body;
      if (!Array.isArray(keys))
        return sendError(res, 400, 'VALIDATION_ERROR', 'keys must be an array');
      if (!keys.length) return sendError(res, 400, 'VALIDATION_ERROR', 'No keys provided');

      if (parentLink !== null && parentLink !== undefined) {
        if (parentLink.docType !== 'epic' && parentLink.docType !== 'feature') {
          return sendError(
            res,
            400,
            'VALIDATION_ERROR',
            "parentLink.docType must be 'epic' or 'feature'"
          );
        }
        assertFilename(parentLink.filename);
      }

      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      // Determine which frontmatter field links a child to its parent
      const parentFieldName =
        parentLink?.docType === 'epic'
          ? 'Epic_ID'
          : parentLink?.docType === 'feature'
            ? 'Feature_ID'
            : null;

      const pulled = [];
      const conflicts = [];

      for (const key of keys) {
        const existing = await findExistingByJiraId(key);
        if (existing && !overwriteKeys.includes(key)) {
          conflicts.push({
            key,
            existingFilename: existing.filename,
            existingDocType: existing.docType,
          });
          continue;
        }

        const issue = (await jiraRequest(
          'GET',
          `/issue/${key}?fields=summary,issuetype,status,priority,description,fixVersions,labels,${FIELD_EPIC_NAME},${FIELD_STORY_POINTS}`
        )) as { fields?: Record<string, unknown> };
        const { docType, content: initialContent } = jiraIssueToMarkdown(issue);
        let content = initialContent;

        // Resolve team from JIRA labels
        const issueLabels = (issue.fields?.labels ?? []) as string[];
        const teamLabel = issueLabels.find((l: string) => ALL_TEAM_JIRA_LABELS.has(l));
        if (
          teamLabel &&
          issueLabels.filter((l: string) => ALL_TEAM_JIRA_LABELS.has(l)).length > 1
        ) {
          console.warn(`[jira/pull] ${key} has multiple team labels — using first: ${teamLabel}`);
        }
        const localTeam = teamLabel ? JIRA_LABEL_TO_TEAM[teamLabel] : 'TBD';
        content = setFrontmatterField(content, 'Team', localTeam);

        let filename;
        if (existing && overwriteKeys.includes(key)) {
          filename = existing.filename;
        } else {
          const slug = slugify(String(issue.fields?.summary || key));
          filename = `${isoDate()}-${slug}.md`;
        }

        // Link child to local parent file so the "└" hierarchy renders correctly
        if (parentFieldName && parentLink.filename) {
          content = setFrontmatterField(content, parentFieldName, parentLink.filename);
          // Inherit fixVersion and sprint from the parent so children appear in
          // the same swimlane section (Current PI, Next PI, or Backlog).
          const parentDoc = docIndex.get(parentLink.filename);
          content = setFrontmatterField(content, 'Fix_Version', parentDoc?.fixVersion || 'TBD');
          content = setFrontmatterField(content, 'Sprint', parentDoc?.sprint || 'TBD');
        } else {
          // Fresh import (search or exact key) — always land in Backlog.
          content = setFrontmatterField(content, 'Fix_Version', 'TBD');
          content = setFrontmatterField(content, 'Sprint', 'TBD');
        }

        const destDir = TYPE_CONFIG[docType].dir();
        ensureDir(destDir);
        await fs.promises.writeFile(path.join(destDir, filename), content);
        await docIndex.invalidate(docType, filename);

        pulled.push({ key, filename, docType });
        broadcast({ type: `${docType}_created`, filename, docType });
      }

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
