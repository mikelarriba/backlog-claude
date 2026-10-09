// ── JIRA search service ───────────────────────────────────────────────────────
// Business logic for GET /api/jira/closed-epics (#554), extracted from the route
// so it can be unit-tested without Express (#697).
import fs from 'fs';
import path from 'path';
import { fetchBoardSprints } from './jiraService.js';
import { ensureDir } from '../utils/routeHelpers.js';
import { isoDate, slugify, setFrontmatterField } from '../utils/transforms.js';
import { JIRA_LABEL_TO_TEAM, ALL_TEAM_JIRA_LABELS } from '../config/metadata.js';
import { pMap } from '../utils/pMap.js';
import { config } from '../config/env.js';
import type { BroadcastFn, DocIndexInstance, TypeConfig } from '../types.js';

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

// ── Children of a JIRA issue (#697) ───────────────────────────────────────────
export interface ChildrenDeps {
  jiraRequest: Request;
  jiraPagedRequest: PagedRequest;
  findExisting: ClosedEpicsDeps['findExisting'];
  JIRA_PROJECT: string;
  FIELD_EPIC_LINK: string;
}

interface JiraChildIssue {
  key: string;
  fields?: { summary?: string; issuetype?: { name?: string }; status?: { name?: string } };
}
interface JiraParentIssue {
  fields?: {
    issuetype?: { name?: string };
    issuelinks?: Array<{ inwardIssue?: JiraChildIssue }>;
    subtasks?: JiraChildIssue[];
  };
}

export async function childrenOf(
  key: string,
  deps: ChildrenDeps
): Promise<{ parentKey: string; parentType?: string; children: Array<Record<string, unknown>> }> {
  const { jiraRequest, jiraPagedRequest, findExisting, JIRA_PROJECT, FIELD_EPIC_LINK } = deps;
  const issue = (await jiraRequest(
    'GET',
    `/issue/${key}?fields=issuetype,issuelinks,subtasks`
  )) as JiraParentIssue;
  const parentType = issue.fields?.issuetype?.name;
  const children: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  async function addChild(child: JiraChildIssue) {
    if (seen.has(child.key)) return;
    seen.add(child.key);
    const existing = await findExisting(child.key);
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
  if (parentType === 'Epic') {
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

  return { parentKey: key, parentType, children };
}

// ── Pull issues from JIRA into local docs (#697) ──────────────────────────────
export interface PullDeps {
  jiraRequest: Request;
  findExisting: (
    jiraId: string
  ) => Promise<{ filename: string; docType: string } | null | undefined>;
  jiraIssueToMarkdown: (issue: unknown) => { docType: string; content: string };
  docIndex: DocIndexInstance;
  TYPE_CONFIG: TypeConfig;
  broadcast: BroadcastFn;
  FIELD_EPIC_NAME: string;
  FIELD_STORY_POINTS: string;
}

export interface PullInput {
  keys: string[];
  overwriteKeys?: string[];
  parentLink?: { filename?: string; docType?: string } | null;
}

export async function pullIssues(
  input: PullInput,
  deps: PullDeps
): Promise<{
  pulled: { key: string; filename: string; docType: string }[];
  conflicts: { key: string; existingFilename: string; existingDocType: string }[];
}> {
  const { keys, overwriteKeys = [], parentLink = null } = input;
  const {
    jiraRequest,
    findExisting,
    jiraIssueToMarkdown,
    docIndex,
    TYPE_CONFIG,
    broadcast,
    FIELD_EPIC_NAME,
    FIELD_STORY_POINTS,
  } = deps;

  // Determine which frontmatter field links a child to its parent
  const parentFieldName =
    parentLink?.docType === 'epic'
      ? 'Epic_ID'
      : parentLink?.docType === 'feature'
        ? 'Feature_ID'
        : null;

  const parentFilename = parentLink?.filename;
  const pulled: { key: string; filename: string; docType: string }[] = [];
  const conflicts: { key: string; existingFilename: string; existingDocType: string }[] = [];

  // Pass 1: resolve conflicts and fetch each key from JIRA with bounded
  // concurrency (capped at JIRA_CONCURRENCY, same pMap pattern used by the
  // JIRA push routes and /api/confluence/execute) instead of one sequential
  // JIRA round-trip per key. A conflicting key is flagged here without ever
  // hitting the network. pMap preserves each key's original index so pass 2
  // below can stay in source order regardless of fetch completion order.
  type FetchResult =
    | { key: string; conflict: { existingFilename: string; existingDocType: string } }
    | {
        key: string;
        conflict: null;
        existing: Awaited<ReturnType<typeof findExisting>>;
        docType: string;
        content: string;
        filename: string;
      };

  const fetched: FetchResult[] = await pMap(
    keys as string[],
    async (key): Promise<FetchResult> => {
      const existing = await findExisting(key);
      if (existing && !overwriteKeys.includes(key)) {
        return {
          key,
          conflict: { existingFilename: existing.filename, existingDocType: existing.docType },
        };
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
      if (teamLabel && issueLabels.filter((l: string) => ALL_TEAM_JIRA_LABELS.has(l)).length > 1) {
        console.warn(`[jira/pull] ${key} has multiple team labels — using first: ${teamLabel}`);
      }
      const localTeam = teamLabel ? JIRA_LABEL_TO_TEAM[teamLabel] : 'TBD';
      content = setFrontmatterField(content, 'Team', localTeam);

      // Link child to local parent file so the "└" hierarchy renders correctly
      if (parentFieldName && parentFilename) {
        content = setFrontmatterField(content, parentFieldName, parentFilename);
        // Inherit fixVersion and sprint from the parent so children appear in
        // the same swimlane section (Current PI, Next PI, or Backlog).
        const parentDoc = docIndex.get(parentFilename);
        content = setFrontmatterField(content, 'Fix_Version', parentDoc?.fixVersion || 'TBD');
        content = setFrontmatterField(content, 'Sprint', parentDoc?.sprint || 'TBD');
      } else {
        // Fresh import (search or exact key) — always land in Backlog.
        content = setFrontmatterField(content, 'Fix_Version', 'TBD');
        content = setFrontmatterField(content, 'Sprint', 'TBD');
      }

      const filename =
        existing && overwriteKeys.includes(key)
          ? existing.filename
          : `${isoDate()}-${slugify(String(issue.fields?.summary || key))}.md`;

      return { key, conflict: null, existing, docType, content, filename };
    },
    { concurrency: config.JIRA_CONCURRENCY }
  );

  // Pass 2: sequential filesystem writes, rank assignment, and docIndex
  // invalidation. This must stay sequential/ordered — rank assignment for a
  // new import reads docIndex.getAll()'s current max rank and would race if
  // parallelized alongside other writes of the same docType.
  for (const item of fetched) {
    if (item.conflict) {
      conflicts.push({ key: item.key, ...item.conflict });
      continue;
    }

    const { key, existing, docType, filename } = item;
    let content = item.content;

    // Rank: JIRA carries no Rank, so the fresh markdown has none. Overwriting
    // an existing local doc must keep its current Rank (so a re-import doesn't
    // move it); a brand-new import lands at the bottom of the backlog by taking
    // max(Rank) + 1 across existing docs of the same type. Without this a new
    // import is unranked and — since most peers are ranked — floats to an
    // arbitrary spot rather than the bottom.
    const existingRank =
      existing && overwriteKeys.includes(key)
        ? (docIndex.get(existing.filename)?.rank ?? null)
        : null;
    if (existing && overwriteKeys.includes(key)) {
      if (existingRank != null)
        content = setFrontmatterField(content, 'Rank', String(existingRank));
    } else {
      const maxRank = docIndex
        .getAll()
        .filter((d) => d.docType === docType && d.rank != null)
        .reduce((max, d) => Math.max(max, d.rank as number), 0);
      content = setFrontmatterField(content, 'Rank', String(maxRank + 1));
    }

    const destDir = TYPE_CONFIG[docType].dir();
    ensureDir(destDir);
    await fs.promises.writeFile(path.join(destDir, filename), content);
    await docIndex.invalidate(docType, filename);

    pulled.push({ key, filename, docType });
    broadcast({ type: `${docType}_created`, filename, docType });
  }

  return { pulled, conflicts };
}
