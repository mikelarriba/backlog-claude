// ── JIRA sync service: non-HTTP logic for reconciling local docs with JIRA ───
// Extracted from routes/jira-sync.ts (#456) so the route file is limited to
// request parsing + response shaping, mirroring jiraPushService.ts /
// jiraSprintService.ts. History-append and label→team lookups reuse the same
// helpers/constants the route previously called inline.
import fs from 'fs';
import path from 'path';
import { pMap } from '../utils/pMap.js';
import {
  setFrontmatterField,
  extractFrontmatterField,
  jiraToMarkdown,
  stripFrontmatter,
} from '../utils/transforms.js';
import { appendDescriptionHistory, extractBodyText, buildPreviewItem } from './jiraService.js';
import type { JiraPreviewIssue } from './jiraService.js';
import { findExistingByJiraId } from '../utils/docHelpers.js';
import { JIRA_LABEL_TO_TEAM, ALL_TEAM_JIRA_LABELS } from '../config/metadata.js';
import type { JiraRouteContext } from '../types.js';

export interface SyncStatusFromIssueArgs {
  content: string;
  filename: string;
  issue: unknown;
}

export interface SyncStatusFromIssueResult {
  updated: string;
  jiraStatus: string | null;
  jiraSp: unknown;
}

export interface MergeFromJiraIssueArgs {
  existing: string;
  filename: string;
  issue: unknown;
}

export interface MergeFromJiraIssueResult {
  merged: string;
}

export interface CheckAllDoc {
  filename: string;
  docType: string;
  jiraId: string;
}

export interface CheckAllResult {
  changed: unknown[];
  skipped: string[];
  errors: unknown[];
}

export interface JiraSyncService {
  checkAll: (docs: CheckAllDoc[]) => Promise<CheckAllResult>;
  syncStatusFromIssue: (args: SyncStatusFromIssueArgs) => Promise<SyncStatusFromIssueResult>;
  mergeFromJiraIssue: (args: MergeFromJiraIssueArgs) => Promise<MergeFromJiraIssueResult>;
  buildPullPreview: (args: {
    jiraKey: string;
    includeChildren?: boolean;
  }) => Promise<Record<string, unknown>[]>;
}

export function createJiraSyncService({
  INBOX_DIR,
  FIELD_STORY_POINTS,
  FIELD_EPIC_NAME,
  FIELD_EPIC_LINK,
  JIRA_PROJECT,
  TYPE_CONFIG,
  jiraRequest,
  jiraIssueToMarkdown,
  extractJiraSummary,
  findLocalFileByJiraId,
  docIndex,
  logWarn,
}: Pick<
  JiraRouteContext,
  | 'INBOX_DIR'
  | 'FIELD_STORY_POINTS'
  | 'FIELD_EPIC_NAME'
  | 'FIELD_EPIC_LINK'
  | 'JIRA_PROJECT'
  | 'TYPE_CONFIG'
  | 'jiraRequest'
  | 'jiraIssueToMarkdown'
  | 'extractJiraSummary'
  | 'findLocalFileByJiraId'
  | 'docIndex'
  | 'logWarn'
>): JiraSyncService {
  const previewCtx = {
    TYPE_CONFIG,
    FIELD_STORY_POINTS,
    docIndex,
    findExistingByJiraIdFn: (jiraId: string) =>
      findExistingByJiraId(
        jiraId,
        (id) => docIndex.findByJiraId(id),
        findLocalFileByJiraId,
        logWarn,
        'jira/sync'
      ),
    extractJiraSummaryFn: extractJiraSummary,
    logWarn,
  };

  // ── sync-status: overlay JIRA's status/story-points/team/summary/description
  // onto the existing local file, appending description-change history. ──────
  async function syncStatusFromIssue({
    content,
    filename,
    issue,
  }: SyncStatusFromIssueArgs): Promise<SyncStatusFromIssueResult> {
    type JiraSyncIssue = {
      fields?: Record<string, unknown> & {
        status?: { name?: string };
        labels?: string[];
        summary?: string;
        description?: string;
      };
    };
    const typedIssue = issue as JiraSyncIssue;

    const jiraStatus = typedIssue.fields?.status?.name || null;
    const jiraSp = typedIssue.fields?.[FIELD_STORY_POINTS] ?? null;
    const jiraSummary = String(typedIssue.fields?.summary || '')
      .replace(/[\r\n]+/g, ' ')
      .trim();
    const jiraDesc = jiraToMarkdown(String(typedIssue.fields?.description || '')).trim();

    const issueLabels = (typedIssue.fields?.labels ?? []) as string[];
    const teamLabel = issueLabels.find((l: string) => ALL_TEAM_JIRA_LABELS.has(l));
    const jiraTeam = teamLabel ? JIRA_LABEL_TO_TEAM[teamLabel] : null;

    let updated = content;
    if (jiraStatus) updated = setFrontmatterField(updated, 'JIRA_Status', jiraStatus);
    if (jiraSp !== null) updated = setFrontmatterField(updated, 'Story_Points', String(jiraSp));
    if (jiraTeam !== null) {
      const localTeam = extractFrontmatterField(content, 'Team') || 'TBD';
      if (jiraTeam !== localTeam) updated = setFrontmatterField(updated, 'Team', jiraTeam);
    }

    if (jiraSummary) {
      const existingTitle = (stripFrontmatter(content).match(/^## (.+)$/m) || [])[1] || '';
      if (jiraSummary !== existingTitle) {
        updated = updated.replace(/^## .+$/m, `## ${jiraSummary}`);
      }
    }

    const existingBodyText = extractBodyText(content);
    if (jiraDesc && jiraDesc !== existingBodyText) {
      await appendDescriptionHistory(path.join(INBOX_DIR, filename), existingBodyText, jiraDesc);
      const match = updated.match(/^(---[\s\S]*?---\n+## [^\n]+\n)/);
      if (match) {
        const commentsMatch = updated.match(/\n## Comments\b[\s\S]*$/);
        const commentsSection = commentsMatch ? commentsMatch[0] : '';
        updated = match[1] + '\n' + jiraDesc + '\n' + commentsSection;
      }
    }

    return { updated, jiraStatus, jiraSp };
  }

  // ── update-from-jira: rebuild the file from JIRA's current state, re-layering
  // local-only fields (Sprint/Squad/PI/etc.) and the Comments section back on
  // top so a full refresh doesn't lose data JIRA doesn't know about. ─────────
  async function mergeFromJiraIssue({
    existing,
    filename,
    issue,
  }: MergeFromJiraIssueArgs): Promise<MergeFromJiraIssueResult> {
    const existingBodyText = extractBodyText(existing);
    const { content: freshContent } = jiraIssueToMarkdown(issue);

    const newBodyText = extractBodyText(freshContent);
    if (newBodyText !== existingBodyText) {
      await appendDescriptionHistory(path.join(INBOX_DIR, filename), existingBodyText, newBodyText);
    }

    // Rank is a local-only ordering field JIRA knows nothing about; without it
    // here, pulling an update on an existing issue would drop its Rank and the
    // doc would sink to the bottom of the backlog on every sync. Keep it so an
    // updated issue stays exactly where the user placed it.
    const LOCAL_FIELDS = [
      'Sprint',
      'Squad',
      'PI',
      'Feature_ID',
      'Epic_ID',
      'Created',
      'Team',
      'Rank',
    ];
    let merged = freshContent;
    for (const field of LOCAL_FIELDS) {
      const localVal = extractFrontmatterField(existing, field);
      if (localVal) merged = setFrontmatterField(merged, field, localVal);
    }
    const existingComments = existing.match(/\n## Comments\b[\s\S]*$/);
    if (existingComments) merged = merged.trimEnd() + existingComments[0];

    const issLabels =
      ((issue as { fields?: Record<string, unknown> }).fields?.labels as string[] | undefined) ??
      [];
    const issTeamLbl = issLabels.find((l: string) => ALL_TEAM_JIRA_LABELS.has(l));
    if (issTeamLbl) {
      const jiraTeam = JIRA_LABEL_TO_TEAM[issTeamLbl];
      const localTeam = extractFrontmatterField(existing, 'Team') || 'TBD';
      if (jiraTeam !== localTeam) merged = setFrontmatterField(merged, 'Team', jiraTeam);
    }

    return { merged };
  }

  // ── check-all: compare every JIRA-linked local doc against its JIRA issue and
  // report which differ (summary / story points / description). ─────────────
  async function checkAll(linkedDocs: CheckAllDoc[]): Promise<CheckAllResult> {
    const fields = `summary,issuetype,status,description,${FIELD_STORY_POINTS}`;
    const changed: unknown[] = [];
    const skipped: string[] = [];
    const errors: unknown[] = [];

    await pMap(
      linkedDocs,
      async (doc) => {
        try {
          type JiraCheckIssue = {
            fields?: Record<string, unknown> & { summary?: string; description?: string };
          };
          const issue = (await jiraRequest(
            'GET',
            `/issue/${doc.jiraId}?fields=${fields}`
          )) as JiraCheckIssue;
          const jiraSummary = String(issue.fields?.summary || '')
            .replace(/[\r\n]+/g, ' ')
            .trim();
          const jiraSp = issue.fields?.[FIELD_STORY_POINTS] ?? null;
          const jiraDesc = jiraToMarkdown(String(issue.fields?.description || '')).trim();

          let localTitle = '';
          let localDesc = '';
          let localSp = null;
          try {
            const raw = await fs.promises.readFile(
              path.join(TYPE_CONFIG[doc.docType].dir(), doc.filename),
              'utf-8'
            );
            const headingMatch = raw.match(/^## (.+)$/m);
            localTitle = (headingMatch ? headingMatch[1].trim() : '') || localTitle;
            localDesc = extractBodyText(raw);
            const spRaw = extractFrontmatterField(raw, 'Story_Points');
            localSp = spRaw && spRaw !== 'TBD' ? Number(spRaw) : null;
          } catch (err) {
            logWarn('jira/sync', `unreadable file for ${doc.filename}, using index values`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }

          const summaryChanged = jiraSummary && jiraSummary !== localTitle;
          const spChanged = jiraSp !== null && jiraSp !== localSp;
          const descChanged = jiraDesc !== localDesc;

          if (summaryChanged || spChanged || descChanged) {
            changed.push({
              jiraId: doc.jiraId,
              jiraKey: doc.jiraId,
              jiraTitle: jiraSummary,
              filename: doc.filename,
              docType: doc.docType,
              localDocType: doc.docType,
              title: localTitle,
              action: 'update',
              changes: {
                summary: summaryChanged ? { local: localTitle, jira: jiraSummary } : null,
                storyPoints: spChanged ? { local: localSp, jira: jiraSp } : null,
                description: descChanged ? { changed: true } : null,
              },
              changesArray: [
                ...(summaryChanged ? [{ field: 'title', from: localTitle, to: jiraSummary }] : []),
                ...(descChanged ? [{ field: 'description', changed: true }] : []),
                ...(spChanged ? [{ field: 'storyPoints', from: localSp, to: jiraSp }] : []),
              ],
            });
          } else {
            skipped.push(doc.jiraId);
          }
        } catch (e) {
          errors.push({
            jiraId: doc.jiraId,
            filename: doc.filename,
            docType: doc.docType,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
      { concurrency: 5 }
    );
    return { changed, skipped, errors };
  }

  // ── pull-preview: build the list of create/update/delete previews for a JIRA
  // issue and (optionally) its children. Moved from routes/jira-sync.ts (#697).
  async function buildPullPreview({
    jiraKey,
    includeChildren = false,
  }: {
    jiraKey: string;
    includeChildren?: boolean;
  }): Promise<Record<string, unknown>[]> {
    const fields = `summary,issuetype,status,priority,description,fixVersions,issuelinks,subtasks,${FIELD_EPIC_NAME},${FIELD_EPIC_LINK},${FIELD_STORY_POINTS}`;
    const issue = (await jiraRequest(
      'GET',
      `/issue/${jiraKey}?fields=${fields}`
    )) as JiraPreviewIssue;
    const items: Record<string, unknown>[] = [];

    items.push(await buildPreviewItem(issue, previewCtx));

    if (includeChildren) {
      const issueType = issue.fields?.issuetype?.name;
      const childIssues: JiraPreviewIssue[] = [];
      const seen = new Set([jiraKey]);

      if (issueType === 'Epic' && FIELD_EPIC_LINK) {
        const fieldId = FIELD_EPIC_LINK.replace('customfield_', '');
        const jql = `cf[${fieldId}] = ${jiraKey} AND project = ${JIRA_PROJECT} AND statusCategory != Done ORDER BY issuetype ASC`;
        const data = (await jiraRequest(
          'GET',
          `/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=${fields}`
        )) as { issues?: JiraPreviewIssue[] };
        for (const c of data.issues || []) {
          if (!seen.has(c.key)) {
            seen.add(c.key);
            childIssues.push(c);
          }
        }
      }

      await pMap(
        issue.fields?.issuelinks || [],
        async (link) => {
          const inw = link.inwardIssue;
          if (!inw || seen.has(inw.key)) return;
          seen.add(inw.key);
          try {
            const full = (await jiraRequest(
              'GET',
              `/issue/${inw.key}?fields=${fields}`
            )) as JiraPreviewIssue;
            childIssues.push(full);
          } catch (err) {
            logWarn('jira/sync', `could not fetch child issue ${inw.key}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
        { concurrency: 5 }
      );

      for (const child of childIssues) items.push(await buildPreviewItem(child, previewCtx));

      const parentEntry = docIndex.findByJiraId(jiraKey);
      if (parentEntry) {
        const localChildren = docIndex
          .getAll()
          .filter(
            (e) => e.parentFilename === parentEntry.filename && e.jiraId && e.jiraId !== 'TBD'
          );

        const jiraChildKeys = new Set(childIssues.map((c) => c.key));

        await pMap(
          localChildren,
          async (local) => {
            if (jiraChildKeys.has(local.jiraId!) || seen.has(local.jiraId!)) return;
            try {
              type JiraRemoteIssue = {
                fields?: {
                  status?: { name?: string; statusCategory?: { key?: string } };
                  summary?: string;
                  issuetype?: { name?: string };
                };
              };
              const remoteIssue = (await jiraRequest(
                'GET',
                `/issue/${local.jiraId}?fields=status,summary,issuetype`
              )) as JiraRemoteIssue;
              const statusCat = remoteIssue.fields?.status?.statusCategory?.key;
              if (statusCat === 'done') {
                items.push({
                  jiraKey: local.jiraId,
                  jiraTitle: remoteIssue.fields?.summary || local.title,
                  jiraType: remoteIssue.fields?.issuetype?.name || '',
                  localFilename: local.filename,
                  localDocType: local.docType,
                  action: 'delete',
                  reason: `Closed in JIRA (${remoteIssue.fields?.status?.name || 'Done'})`,
                  changes: [
                    {
                      field: 'status',
                      from: local.status || 'Draft',
                      to: remoteIssue.fields?.status?.name || 'Done',
                    },
                  ],
                });
              }
            } catch (err) {
              logWarn('jira/sync', `could not fetch ${local.jiraId} from JIRA; offering deletion`, {
                error: err instanceof Error ? err.message : String(err),
              });
              items.push({
                jiraKey: local.jiraId,
                jiraTitle: local.title || local.filename,
                jiraType: '',
                localFilename: local.filename,
                localDocType: local.docType,
                action: 'delete',
                reason: 'Not found in JIRA',
                changes: [{ field: 'status', to: 'Not found in JIRA' }],
              });
            }
          },
          { concurrency: 5 }
        );
      }
    }
    return items;
  }

  return { syncStatusFromIssue, mergeFromJiraIssue, checkAll, buildPullPreview };
}
