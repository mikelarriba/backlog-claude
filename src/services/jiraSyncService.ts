// ── JIRA sync service: non-HTTP logic for reconciling local docs with JIRA ───
// Extracted from routes/jira-sync.ts (#456) so the route file is limited to
// request parsing + response shaping, mirroring jiraPushService.ts /
// jiraSprintService.ts. History-append and label→team lookups reuse the same
// helpers/constants the route previously called inline.
import path from 'path';
import {
  setFrontmatterField,
  extractFrontmatterField,
  jiraToMarkdown,
  stripFrontmatter,
} from '../utils/transforms.js';
import { appendDescriptionHistory, extractBodyText } from './jiraService.js';
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

export interface JiraSyncService {
  syncStatusFromIssue: (args: SyncStatusFromIssueArgs) => Promise<SyncStatusFromIssueResult>;
  mergeFromJiraIssue: (args: MergeFromJiraIssueArgs) => Promise<MergeFromJiraIssueResult>;
}

export function createJiraSyncService({
  INBOX_DIR,
  FIELD_STORY_POINTS,
  jiraIssueToMarkdown,
}: Pick<
  JiraRouteContext,
  'INBOX_DIR' | 'FIELD_STORY_POINTS' | 'jiraIssueToMarkdown'
>): JiraSyncService {
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

    const LOCAL_FIELDS = ['Sprint', 'Squad', 'PI', 'Feature_ID', 'Epic_ID', 'Created', 'Team'];
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

  return { syncStatusFromIssue, mergeFromJiraIssue };
}
