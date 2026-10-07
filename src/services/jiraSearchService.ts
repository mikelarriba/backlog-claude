// ── JIRA search service ───────────────────────────────────────────────────────
// Business logic for GET /api/jira/closed-epics (#554), extracted from the route
// so it can be unit-tested without Express (#697).
import { fetchBoardSprints } from './jiraService.js';

type Request = (method: string, path: string, body?: unknown) => Promise<unknown>;
type PagedRequest = (
  jql: string,
  fields: string,
  opts: { maxResults: number; maxTotal: number }
) => Promise<unknown[]>;

export interface ClosedEpicsDeps {
  jiraRequest: Request;
  jiraPagedRequest: PagedRequest;
  jiraAgileRequest: Parameters<typeof fetchBoardSprints>[0];
  findExisting: (
    jiraId: string
  ) => Promise<{ filename?: string; docType?: string } | null | undefined>;
  JIRA_PROJECT: string;
  JIRA_LABEL: string;
  JIRA_BOARD_ID: string | number | undefined | null;
  FIELD_EPIC_NAME: string;
  FIELD_EPIC_LINK: string;
}

export type ClosedEpicsResult =
  | {
      ok: true;
      scope: { type: 'sprint' | 'fixversion'; value: string; windowResolved: boolean };
      epics: unknown[];
    }
  | { ok: false; status: number; code: string; message: string };

interface JiraClosedIssue {
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    issuetype?: { name?: string };
    status?: { name?: string };
  };
}

interface EpicGroup {
  key: string;
  summary: string;
  epicName: string;
  status: string;
  epicClosedInScope: boolean;
  isSynthetic: boolean;
  closedChildren: Array<{ key: string; summary: string; issuetype: string; status: string }>;
}

const NO_EPIC_KEY = '(no epic)';

/** Resolve the [start, end] date window for a sprint or fix version. */
async function resolveWindow(
  scopeType: 'sprint' | 'fixversion',
  scopeValue: string,
  d: ClosedEpicsDeps
): Promise<
  { start: string | null; end: string | null } | Extract<ClosedEpicsResult, { ok: false }>
> {
  if (scopeType === 'sprint') {
    if (!d.JIRA_BOARD_ID) {
      return {
        ok: false,
        status: 400,
        code: 'BOARD_NOT_CONFIGURED',
        message: 'JIRA_BOARD_ID not configured',
      };
    }
    const sprints = await fetchBoardSprints(d.jiraAgileRequest, d.JIRA_BOARD_ID as never);
    const match = sprints.find((s) => s.name === scopeValue);
    if (!match) {
      return {
        ok: false,
        status: 404,
        code: 'SPRINT_NOT_FOUND',
        message: `Sprint "${scopeValue}" not found`,
      };
    }
    return { start: match.startDate || null, end: match.endDate || null };
  }
  type JiraVersion = { name: string; startDate?: string; releaseDate?: string };
  const versions = ((await d.jiraRequest('GET', `/project/${d.JIRA_PROJECT}/versions`)) ||
    []) as JiraVersion[];
  const match = versions.find((v) => v.name === scopeValue);
  if (!match) {
    return {
      ok: false,
      status: 404,
      code: 'VERSION_NOT_FOUND',
      message: `Fix version "${scopeValue}" not found`,
    };
  }
  return { start: match.startDate || null, end: match.releaseDate || null };
}

/** Group closed issues under their parent epics (pure). */
export function groupClosedIssues(
  issues: JiraClosedIssue[],
  fieldEpicName: string,
  fieldEpicLink: string
): Map<string, EpicGroup> {
  const epicMap = new Map<string, EpicGroup>();
  for (const issue of issues) {
    const issuetypeName = issue.fields.issuetype?.name || '';
    if (issuetypeName === 'Epic') {
      const entry = epicMap.get(issue.key) || {
        key: issue.key,
        summary: '',
        epicName: '',
        status: '',
        epicClosedInScope: false,
        isSynthetic: false,
        closedChildren: [],
      };
      entry.summary = String(issue.fields.summary || '');
      entry.epicName = String(issue.fields[fieldEpicName] || '');
      entry.status = issue.fields.status?.name || '';
      entry.epicClosedInScope = true;
      epicMap.set(issue.key, entry);
    } else {
      const epicKey = String(issue.fields[fieldEpicLink] || '').trim() || NO_EPIC_KEY;
      const entry = epicMap.get(epicKey) || {
        key: epicKey,
        summary: '',
        epicName: '',
        status: '',
        epicClosedInScope: false,
        isSynthetic: epicKey === NO_EPIC_KEY,
        closedChildren: [],
      };
      entry.closedChildren.push({
        key: issue.key,
        summary: String(issue.fields.summary || ''),
        issuetype: issuetypeName,
        status: issue.fields.status?.name || '',
      });
      epicMap.set(epicKey, entry);
    }
  }
  return epicMap;
}

/** Epics that contain issues closed during the sprint / fix-version window. */
export async function closedEpicsForScope(
  scopeType: 'sprint' | 'fixversion',
  scopeValue: string,
  d: ClosedEpicsDeps
): Promise<ClosedEpicsResult> {
  const win = await resolveWindow(scopeType, scopeValue, d);
  if ('ok' in win) return win;
  const { start, end } = win;
  const windowResolved = !!(start && end);

  const resolvedClause = windowResolved
    ? ` AND resolved >= "${String(start).slice(0, 10)}" AND resolved <= "${String(end).slice(0, 10)}"`
    : '';
  const jql = `project = ${d.JIRA_PROJECT} AND labels = ${d.JIRA_LABEL} AND statusCategory = Done${resolvedClause} ORDER BY updated DESC`;
  const fields = `summary,issuetype,status,${d.FIELD_EPIC_LINK},${d.FIELD_EPIC_NAME},resolutiondate`;
  const rawIssues = (await d.jiraPagedRequest(jql, fields, {
    maxResults: 100,
    maxTotal: 500,
  })) as JiraClosedIssue[];

  const epicMap = groupClosedIssues(rawIssues, d.FIELD_EPIC_NAME, d.FIELD_EPIC_LINK);

  // Batch-fetch summaries for epics that were not themselves closed in scope.
  const keysToFetch = [...epicMap.values()]
    .filter((e) => !e.epicClosedInScope && !e.isSynthetic)
    .map((e) => e.key);
  if (keysToFetch.length) {
    const epicIssues = (await d.jiraPagedRequest(
      `key in (${keysToFetch.join(',')})`,
      `summary,status,${d.FIELD_EPIC_NAME}`,
      { maxResults: 100, maxTotal: 500 }
    )) as JiraClosedIssue[];
    for (const epicIssue of epicIssues) {
      const entry = epicMap.get(epicIssue.key);
      if (!entry) continue;
      entry.summary = String(epicIssue.fields.summary || '');
      entry.epicName = String(epicIssue.fields[d.FIELD_EPIC_NAME] || '');
      entry.status = epicIssue.fields.status?.name || '';
    }
  }

  // Attach "✓ Local" badges.
  const epics = await Promise.all(
    [...epicMap.values()].map(async (e) => {
      const existing = e.isSynthetic ? null : await d.findExisting(e.key);
      const closedChildren = await Promise.all(
        e.closedChildren.map(async (c) => {
          const childExisting = await d.findExisting(c.key);
          return {
            ...c,
            localExists: !!childExisting,
            localFilename: childExisting?.filename || null,
            localDocType: childExisting?.docType || null,
          };
        })
      );
      return {
        key: e.key,
        summary: e.summary,
        epicName: e.epicName,
        status: e.status,
        epicClosedInScope: e.epicClosedInScope,
        isSynthetic: e.isSynthetic,
        localExists: !!existing,
        localFilename: existing?.filename || null,
        localDocType: existing?.docType || null,
        closedChildren,
      };
    })
  );

  return { ok: true, scope: { type: scopeType, value: scopeValue, windowResolved }, epics };
}
