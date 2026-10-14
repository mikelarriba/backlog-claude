// ── JIRA sprint service: sprint name-mapping + board/sprint scan helpers ──────
// Extracted from routes/jira-push-sprints.ts (#341) so the route file is
// limited to request/SSE plumbing. The per-sprint scan helpers here are used
// with pMap (concurrency-limited) instead of the old sequential `for` loops.

import fs from 'fs';
import path from 'path';
import { pMap } from '../utils/pMap.js';
import { setFrontmatterField } from '../utils/transforms.js';
import { ensureSprintCache } from './jiraService.js';
import type { JiraRouteContext } from '../types.js';
import { writeFileAtomic } from '../utils/fileWrite.js';

type JiraAgileRequest = (method: string, urlPath: string, body?: unknown) => Promise<unknown>;

// ── Sprint name resolver ────────────────────────────────────────────────────
// Local sprint names (e.g. "Sprint 100") may differ from JIRA names
// (e.g. "MIDAS Sprint 100"). Build a bidirectional mapping.
export function buildSprintNameMap(
  localNames: string[],
  jiraMap: Map<string, number>
): { localToJira: Map<string, string>; jiraToLocal: Map<string, string> } {
  const localToJira = new Map<string, string>(); // "Sprint 100" → "MIDAS Sprint 100"
  const jiraToLocal = new Map<string, string>(); // "MIDAS Sprint 100" → "Sprint 100"

  for (const local of localNames) {
    // Exact match
    if (jiraMap.has(local)) {
      localToJira.set(local, local);
      jiraToLocal.set(local, local);
      continue;
    }
    // Suffix match: JIRA name ends with local name (e.g. "MIDAS Sprint 100" ends with "Sprint 100")
    for (const jiraName of jiraMap.keys()) {
      if (jiraToLocal.has(jiraName)) continue; // already mapped
      if (jiraName.endsWith(local) || local.endsWith(jiraName)) {
        localToJira.set(local, jiraName);
        jiraToLocal.set(jiraName, local);
        break;
      }
    }
  }
  return { localToJira, jiraToLocal };
}

// ── Board scan: all issues currently in a given sprint (paginated) ───────────
export async function fetchSprintIssuesOnBoard(
  jiraAgileRequest: JiraAgileRequest,
  boardId: string,
  sprintId: number
): Promise<Array<{ key: string; summary: string }>> {
  const results: Array<{ key: string; summary: string }> = [];
  let startAt = 0;
  while (true) {
    const data = (await jiraAgileRequest(
      'GET',
      `/board/${boardId}/sprint/${sprintId}/issue?fields=summary&maxResults=100&startAt=${startAt}`
    )) as Record<string, unknown>;
    const issues = (data.issues as Array<{ key: string; fields?: { summary?: string } }>) || [];
    for (const iss of issues) results.push({ key: iss.key, summary: iss.fields?.summary || '' });
    if (issues.length < 100) break;
    startAt += issues.length;
  }
  return results;
}

// ── Sprint scan: issues in a sprint that don't yet exist as local docs ───────
export interface PulledSprintIssue {
  key: string;
  summary: string;
  issuetype: string;
  priority: string;
  status: string;
  storyPoints: unknown;
  sprintName: string;
}

// ── Preview diff: compare local sprint assignments against a scanned board ───
// Pure comparison logic used by POST /api/jira/push-sprints-preview after the
// board scan (fetchSprintIssuesOnBoard) has populated `jiraSprintMap`.
export interface SprintPreviewItem {
  filename: string;
  sprint: string | null;
  jiraId: string;
  title: string;
  docType: string;
}

export interface SprintPreviewResult {
  changes: Array<Record<string, unknown>>;
  errors: Array<{ jiraId: string; error: string }>;
  stats: {
    total: number;
    adds: number;
    changes: number;
    pulls: number;
    unchanged: number;
    errors: number;
  };
}

export function buildSprintPushPreview({
  filteredItems,
  jiraSprintMap,
  sprintMap,
  localToJira,
  jiraToLocal,
  findByJiraId,
  getLocalEntry,
}: {
  filteredItems: SprintPreviewItem[];
  jiraSprintMap: Map<string, { sprintName: string; sprintId: number; summary: string }>;
  sprintMap: Map<string, number>;
  localToJira: Map<string, string>;
  jiraToLocal: Map<string, string>;
  findByJiraId: (jiraId: string) => { docType: string; filename: string } | null;
  getLocalEntry: (filename: string) => { sprint: string | null } | null;
}): SprintPreviewResult {
  // Resolve a local sprint name to its JIRA ID
  const resolveSprintId = (localName: string): number | null => {
    const jiraName = localToJira.get(localName);
    if (jiraName) return sprintMap.get(jiraName) ?? null;
    return sprintMap.get(localName) ?? null;
  };

  // Check if two sprint names match (accounting for local/JIRA naming)
  const sprintNamesMatch = (localName: string, jiraName: string): boolean => {
    if (localName === jiraName) return true;
    return localToJira.get(localName) === jiraName;
  };

  const changes: Array<Record<string, unknown>> = [];
  const errors: Array<{ jiraId: string; error: string }> = [];
  let unchanged = 0;

  // ── Compare local items against the JIRA sprint map ────────────────────────
  const localJiraIds = new Set<string>();
  for (const item of filteredItems) {
    const { filename, sprint: localSprint, jiraId, title, docType } = item;
    if (!jiraId) continue;
    localJiraIds.add(jiraId);

    const jiraEntry = jiraSprintMap.get(jiraId);
    const jiraSprintName = jiraEntry?.sprintName || null;
    const jiraSprintId = jiraEntry?.sprintId || null;

    if (localSprint && localSprint !== 'TBD') {
      const targetId = resolveSprintId(localSprint);
      if (!targetId) {
        errors.push({ jiraId, error: `sprint "${localSprint}" not found on board` });
      } else if (jiraSprintName && sprintNamesMatch(localSprint, jiraSprintName)) {
        unchanged++;
      } else {
        const jiraLocalName = jiraSprintName
          ? jiraToLocal.get(jiraSprintName) || jiraSprintName
          : null;
        changes.push({
          filename,
          jiraId,
          title,
          docType,
          changeType: jiraSprintName ? 'change' : 'add',
          currentJiraSprint: jiraLocalName,
          currentJiraSprintId: jiraSprintId,
          targetSprint: localSprint,
          targetSprintId: targetId,
        });
      }
    } else {
      // Local has no sprint — if JIRA has one, offer to pull (sync JIRA → local)
      if (jiraSprintName) {
        const jiraLocalName = jiraToLocal.get(jiraSprintName) || jiraSprintName;
        changes.push({
          filename,
          jiraId,
          title,
          docType,
          changeType: 'pull',
          currentJiraSprint: jiraLocalName,
          currentJiraSprintId: jiraSprintId,
          targetSprint: jiraLocalName,
          targetSprintId: jiraSprintId,
        });
      } else {
        unchanged++;
      }
    }
  }

  // ── Detect JIRA-only issues not in local set ────────────────────────────────
  for (const [jiraId, entry] of jiraSprintMap) {
    if (localJiraIds.has(jiraId)) continue;
    const local = findByJiraId(jiraId);
    if (!local) continue;
    const localEntry = getLocalEntry(local.filename);
    if (!localEntry) continue;
    const localSprint = localEntry.sprint;
    if (localSprint && sprintNamesMatch(localSprint, entry.sprintName)) {
      unchanged++;
      continue;
    }
    if (localSprint && localSprint !== 'TBD') {
      const targetId = resolveSprintId(localSprint);
      changes.push({
        filename: local.filename,
        jiraId,
        title: entry.summary || local.filename,
        docType: local.docType,
        changeType: 'change',
        currentJiraSprint: jiraToLocal.get(entry.sprintName) || entry.sprintName,
        currentJiraSprintId: entry.sprintId,
        targetSprint: localSprint,
        targetSprintId: targetId,
      });
    } else {
      // In JIRA sprint but not locally — offer to pull
      const jiraLocalName = jiraToLocal.get(entry.sprintName) || entry.sprintName;
      changes.push({
        filename: local.filename,
        jiraId,
        title: entry.summary || local.filename,
        docType: local.docType,
        changeType: 'pull',
        currentJiraSprint: jiraLocalName,
        currentJiraSprintId: entry.sprintId,
        targetSprint: jiraLocalName,
        targetSprintId: entry.sprintId,
      });
    }
  }

  const stats = {
    total: changes.length,
    adds: changes.filter((c) => c.changeType === 'add').length,
    changes: changes.filter((c) => c.changeType === 'change').length,
    pulls: changes.filter((c) => c.changeType === 'pull').length,
    unchanged,
    errors: errors.length,
  };

  return { changes, errors, stats };
}

export async function fetchUnimportedSprintIssues(
  jiraAgileRequest: JiraAgileRequest,
  sprintId: number,
  jiraSprintName: string,
  fieldStoryPoints: string | undefined,
  findByJiraId: (jiraId: string) => unknown
): Promise<PulledSprintIssue[]> {
  type JiraIssueItem = {
    key: string;
    fields: Record<string, unknown> & {
      summary?: string;
      issuetype?: { name?: string };
      priority?: { name?: string };
      status?: { name?: string };
    };
  };

  const results: PulledSprintIssue[] = [];
  let startAt = 0;
  const maxResults = 50;
  while (true) {
    const data = (await jiraAgileRequest(
      'GET',
      `/sprint/${sprintId}/issue?maxResults=${maxResults}&startAt=${startAt}&fields=summary,issuetype,priority,status,${fieldStoryPoints || 'customfield_10002'}`
    )) as Record<string, unknown>;
    const issues = (data.issues as JiraIssueItem[]) || [];
    if (!issues.length) break;

    for (const issue of issues) {
      if (findByJiraId(issue.key)) continue;
      results.push({
        key: issue.key,
        summary: issue.fields.summary || '',
        issuetype: issue.fields.issuetype?.name || 'Story',
        priority: issue.fields.priority?.name || 'Medium',
        status: issue.fields.status?.name || '',
        storyPoints: issue.fields[fieldStoryPoints || 'customfield_10002'] || null,
        sprintName: jiraSprintName,
      });
    }

    if (startAt + issues.length >= ((data.total as number) || 0)) break;
    startAt += issues.length;
  }
  return results;
}

// ── push-sprints: apply push / remove / pull sprint assignments ──────────────
export interface PushSprintItem {
  filename: string;
  sprint: string | null;
  changeType: string;
  jiraId?: string;
  docType?: string;
}

export type PushSprintDeps = Pick<
  JiraRouteContext,
  'docIndex' | 'broadcast' | 'logInfo' | 'logWarn'
> & {
  boardId: string | number;
  concurrency: number;
  typeConfig: JiraRouteContext['TYPE_CONFIG'];
  jiraAgileRequest: JiraAgileRequest;
};

export async function pushSprintAssignments(
  items: PushSprintItem[],
  deps: PushSprintDeps
): Promise<Array<Record<string, unknown>>> {
  const { boardId, concurrency, typeConfig, jiraAgileRequest, docIndex, broadcast } = deps;
  const { logInfo, logWarn } = deps;
  const sprintMap = await ensureSprintCache(
    jiraAgileRequest as Parameters<typeof ensureSprintCache>[0],
    boardId as Parameters<typeof ensureSprintCache>[1]
  );

  // Resolve local sprint name to JIRA sprint ID (with fuzzy matching)
  const resolveId = (name: string): number | null => {
    const exact = sprintMap.get(name);
    if (exact != null) return exact;
    for (const [jiraName, id] of sprintMap) {
      if (jiraName.endsWith(name) || name.endsWith(jiraName)) return id;
    }
    return null;
  };

  const touchedFilenames: string[] = [];
  const results = await pMap(
    items,
    async (item): Promise<Record<string, unknown>> => {
      const { filename, sprint, changeType } = item;
      const jiraId = item.jiraId || docIndex.get(filename)?.jiraId;
      if (!jiraId) return { filename, status: 'skipped', reason: 'no JIRA ID' };
      try {
        if (changeType === 'pull') {
          // Pull: update local doc's sprint field to match JIRA
          if (!sprint) return { filename, status: 'skipped', reason: 'no sprint to pull' };
          const docType = item.docType || docIndex.get(filename)?.docType;
          if (!docType) return { filename, status: 'skipped', reason: 'unknown doc type' };
          const cfg = typeConfig[docType as keyof typeof typeConfig];
          if (!cfg) return { filename, status: 'skipped', reason: `unknown type "${docType}"` };
          const filepath = path.join(cfg.dir(), filename);
          const content = await fs.promises.readFile(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Sprint', sprint);
          await writeFileAtomic(filepath, patched);
          touchedFilenames.push(filename);
          broadcast({ type: 'batch_sprint_updated' });
          logInfo(
            'jira/push-sprints',
            `Pulled sprint "${sprint}" from JIRA for ${jiraId} → ${filename}`
          );
          return { filename, status: 'ok', jiraId, sprint };
        }
        if (changeType === 'remove') {
          await jiraAgileRequest('POST', `/backlog/issue`, { issues: [jiraId] });
          logInfo('jira/push-sprints', `Moved ${jiraId} to backlog (removed from sprint)`);
          return { filename, status: 'ok', jiraId, sprint: '(backlog)' };
        }
        // Push: add/change — assign to JIRA sprint
        if (!sprint) return { filename, status: 'skipped', reason: 'no sprint' };
        const sprintId = resolveId(sprint);
        if (!sprintId)
          return { filename, status: 'skipped', reason: `sprint "${sprint}" not found on board` };
        await jiraAgileRequest('POST', `/sprint/${sprintId}/issue`, { issues: [jiraId] });
        logInfo('jira/push-sprints', `Assigned ${jiraId} to sprint "${sprint}"`);
        return { filename, status: 'ok', jiraId, sprint };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logWarn('jira/push-sprints', `Failed sprint op for ${jiraId}: ${msg}`);
        return { filename, status: 'error', error: msg };
      }
    },
    { concurrency }
  );

  if (touchedFilenames.length) await docIndex.invalidateMany(touchedFilenames);
  return results;
}
