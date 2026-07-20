// ── JIRA push service: non-HTTP logic for pushing local docs to JIRA ─────────
// Extracted from routes/jira-push-doc.ts (#341) so the route file is limited to
// request parsing + response shaping. Cache/lookup helpers already live in
// services/jiraService.ts (#339) and are reused here, not reimplemented.
import fs from 'fs';
import path from 'path';
import {
  setFrontmatterField,
  extractFrontmatterField,
  stripFrontmatter,
  markdownToJira,
} from '../utils/transforms.js';
import { serializeStoryFile } from './storyService.js';
import {
  LOCAL_TO_JIRA_TYPE,
  ensureSprintCache,
  resolveEpicLink,
  syncContainsLink,
  resolveParentJiraId,
} from './jiraService.js';
import { logAudit } from '../utils/auditLog.js';
import { TEAM_TO_JIRA_LABEL, ALL_TEAM_JIRA_LABELS } from '../config/metadata.js';
import type { JiraRouteContext } from '../types.js';

export interface PushMultiStoryArgs {
  filename: string;
  filepath: string;
  sections: string[];
  frontmatter: string;
  type: string;
}

export interface PushSingleIssueArgs {
  filename: string;
  filepath: string;
  content: string;
  type: string;
}

export interface JiraPushService {
  pushMultiStory: (args: PushMultiStoryArgs) => Promise<{
    type: string;
    results: Array<{ action: string; key: string }>;
    errors: Array<{ story: string; error: string }>;
  }>;
  pushSingleIssue: (
    args: PushSingleIssueArgs
  ) => Promise<{ action: string; key: string; filename: string; docType: string }>;
}

export function createJiraPushService({
  EPICS_DIR,
  FEATURES_DIR,
  BUGS_DIR,
  JIRA_PROJECT,
  JIRA_LABEL,
  JIRA_BASE,
  JIRA_BOARD_ID,
  FIELD_EPIC_NAME,
  FIELD_EPIC_LINK,
  FIELD_STORY_POINTS,
  jiraRequest,
  jiraAgileRequest,
  jiraUploadAttachment,
  extractJiraSummary,
  broadcast,
  logInfo,
  logWarn,
  docIndex,
}: JiraRouteContext): JiraPushService {
  async function getSprintId(sprintName: string) {
    if (!JIRA_BOARD_ID) return null;
    const map = await ensureSprintCache(jiraAgileRequest, JIRA_BOARD_ID);
    return map.get(sprintName) ?? null;
  }

  // ── Multi-story push helper ─────────────────────────────────────────────────
  async function pushMultiStory({
    filename,
    filepath,
    sections,
    frontmatter,
    type,
  }: PushMultiStoryArgs) {
    const epicFilename = filename.replace('-stories.md', '.md');
    const epicJiraId = await resolveParentJiraId(EPICS_DIR, epicFilename);

    const results: Array<{ action: string; key: string }> = [];
    const errors: Array<{ story: string; error: string }> = [];
    const updatedSections: string[] = [];

    for (let section of sections) {
      const headerMatch = section.match(
        /^(## Story \d+:\s*.+?)(?:\s*<!--\s*JIRA:(\S+?)\s*-->)?\s*$/m
      );
      const existingKey = headerMatch?.[2] || null;
      const storyTitle = headerMatch
        ? headerMatch[1].replace(/^## Story \d+:\s*/, '').trim()
        : extractJiraSummary(section);

      try {
        let key;
        if (existingKey) {
          await jiraRequest('PUT', `/issue/${existingKey}`, {
            fields: { description: markdownToJira(section) },
          });
          key = existingKey;
          results.push({ action: 'updated', key });
        } else {
          const fmTeam = extractFrontmatterField(frontmatter, 'Team');
          const fmTeamLabel =
            fmTeam && fmTeam !== 'TBD' ? (TEAM_TO_JIRA_LABEL[fmTeam] ?? null) : null;
          const multiLabels = fmTeamLabel ? [JIRA_LABEL, fmTeamLabel] : [JIRA_LABEL];
          const fields: Record<string, unknown> = {
            project: { key: JIRA_PROJECT },
            summary: storyTitle,
            description: markdownToJira(section),
            issuetype: { name: 'Story' },
            labels: multiLabels,
          };
          if (epicJiraId) fields[FIELD_EPIC_LINK] = epicJiraId;
          const created = (await jiraRequest('POST', '/issue', { fields })) as { key: string };
          key = created.key;
          results.push({ action: 'created', key });
          section = section.replace(/^(## Story \d+:\s*.+?)(\s*)$/m, `$1 <!-- JIRA:${key} -->`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ story: storyTitle, error: msg });
        logWarn('jira/pushMultiStory', `Failed to push story "${storyTitle}": ${msg}`);
      }
      updatedSections.push(section);
    }

    await fs.promises.writeFile(filepath, serializeStoryFile(frontmatter, updatedSections));
    broadcast({ type: 'story_created', filename, docType: type });
    return { type: 'multi-story', results, errors };
  }

  // ── Single-issue push helper ──────────────────────────────────────────────
  async function pushSingleIssue({ filename, filepath, content, type }: PushSingleIssueArgs) {
    const jiraId = extractFrontmatterField(content, 'JIRA_ID') || 'TBD';
    const summary = extractJiraSummary(content);
    const _bodyOnly = stripFrontmatter(content)
      .replace(/^#{1,2}\s+.+\n?/, '') // strip doc title (first h1/h2)
      .replace(/^#{2,3}\s+Description\s*$/m, '') // strip redundant "Description" heading
      .replace(/\n#{2,3}\s+Attachments\b[\s\S]*$/, '') // strip Attachments section (files are uploaded separately)
      .replace(/\n## Comments\b[\s\S]*$/, '') // strip Comments section
      .trim();
    const description = markdownToJira(_bodyOnly);
    const jiraType = LOCAL_TO_JIRA_TYPE[type] || 'Story';
    const localFixVersion = extractFrontmatterField(content, 'Fix_Version');
    const localStoryPoints = extractFrontmatterField(content, 'Story_Points');
    const spValue =
      localStoryPoints && localStoryPoints !== 'TBD' ? Number(localStoryPoints) : null;
    const localTeam = extractFrontmatterField(content, 'Team');
    const teamLabel =
      localTeam && localTeam !== 'TBD' ? (TEAM_TO_JIRA_LABEL[localTeam] ?? null) : null;

    let key, action;

    if (jiraId !== 'TBD') {
      const updateFields: Record<string, unknown> = { summary, description };
      if (localFixVersion && localFixVersion !== 'TBD') {
        updateFields['fixVersions'] = [{ name: localFixVersion }];
      }
      // Only push story points for leaf types (not features/epics — those show the sum of children)
      if (spValue !== null && type !== 'feature' && type !== 'epic')
        updateFields[FIELD_STORY_POINTS] = spValue;

      // Sync Epic Link when a story/spike/bug has been moved to a different epic
      if (type === 'story' || type === 'spike' || type === 'bug') {
        const { epicFilename, epicJiraId } = await resolveEpicLink(content, EPICS_DIR);
        if (epicFilename) {
          if (epicJiraId) updateFields[FIELD_EPIC_LINK] = epicJiraId;
        } else {
          // Epic_ID cleared — remove Epic Link in JIRA
          updateFields[FIELD_EPIC_LINK] = null;
        }
      }

      // Update team label: fetch current labels, strip old team labels, add new one
      try {
        const issue = (await jiraRequest('GET', `/issue/${jiraId}?fields=labels`)) as {
          fields: { labels?: string[] };
        };
        const existingLabels = issue.fields?.labels ?? [];
        const nonTeamLabels = existingLabels.filter((l) => !ALL_TEAM_JIRA_LABELS.has(l));
        const newLabels = teamLabel ? [...nonTeamLabels, teamLabel] : nonTeamLabels;
        if (JSON.stringify(existingLabels.sort()) !== JSON.stringify(newLabels.sort())) {
          updateFields['labels'] = newLabels;
        }
      } catch (e) {
        logWarn(
          'jira/push',
          `Could not fetch labels for ${jiraId}: ${e instanceof Error ? e.message : String(e)}`
        );
      }

      await jiraRequest('PUT', `/issue/${jiraId}`, { fields: updateFields });
      key = jiraId;
      action = 'updated';

      // Sync "contains" link for epics (best-effort, idempotent — JIRA errors if link exists)
      await syncContainsLink(content, type, key, FEATURES_DIR, jiraRequest, logWarn);
    } else {
      const baseLabels = type === 'bug' ? [JIRA_LABEL, 'MIDAS_SC3', 'MIDAS_Issues'] : [JIRA_LABEL];
      if (teamLabel) baseLabels.push(teamLabel);
      const fields: Record<string, unknown> = {
        project: { key: JIRA_PROJECT },
        summary,
        description,
        issuetype: { name: jiraType },
        labels: baseLabels,
      };
      if (localFixVersion && localFixVersion !== 'TBD')
        fields['fixVersions'] = [{ name: localFixVersion }];
      if (spValue !== null && type !== 'feature' && type !== 'epic')
        fields[FIELD_STORY_POINTS] = spValue;
      if (type === 'epic') fields[FIELD_EPIC_NAME] = summary.slice(0, 60);

      if (type === 'story' || type === 'spike' || type === 'bug') {
        const { epicJiraId } = await resolveEpicLink(content, EPICS_DIR);
        if (epicJiraId) fields[FIELD_EPIC_LINK] = epicJiraId;
      }

      const created = (await jiraRequest('POST', '/issue', { fields })) as { key: string };
      key = created.key;
      action = 'created';

      await syncContainsLink(content, type, key, FEATURES_DIR, jiraRequest, logWarn);

      let updated = setFrontmatterField(content, 'JIRA_ID', key);
      updated = setFrontmatterField(updated, 'JIRA_URL', `${JIRA_BASE}/browse/${key}`);
      updated = setFrontmatterField(updated, 'Status', 'Created in JIRA');
      await fs.promises.writeFile(filepath, updated);
      await docIndex.invalidate(type, filename);
      broadcast({ type: 'status_updated', filename, docType: type, status: 'Created in JIRA' });
      logAudit({
        op: 'jira-push',
        docType: type,
        filename,
        fields: { jiraId: key },
        source: 'api',
      });
    }

    // Upload local attachments for bugs
    if (type === 'bug' && BUGS_DIR) {
      const slug = filename.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
      const attachDir = path.join(BUGS_DIR, 'attachments', slug);
      if (fs.existsSync(attachDir)) {
        for (const attFile of await fs.promises.readdir(attachDir)) {
          try {
            const buf = await fs.promises.readFile(path.join(attachDir, attFile));
            await jiraUploadAttachment(key, attFile, buf);
            logInfo('jira/push', `Uploaded attachment ${attFile} to ${key}`);
          } catch (e) {
            logWarn(
              'jira/push',
              `Failed to upload attachment ${attFile}: ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }
      }
    }

    // Assign sprint via Agile API (best-effort)
    const localSprint = extractFrontmatterField(content, 'Sprint');
    if (localSprint && localSprint !== 'TBD' && JIRA_BOARD_ID) {
      try {
        const sprintId = await getSprintId(localSprint);
        if (sprintId) {
          await jiraAgileRequest('POST', `/sprint/${sprintId}/issue`, { issues: [key] });
        } else {
          logWarn('jira/push', `Sprint "${localSprint}" not found on board ${JIRA_BOARD_ID}`);
        }
      } catch (e) {
        logWarn(
          'jira/push',
          `Could not assign sprint for ${key}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    return { action, key, filename, docType: type };
  }

  return { pushMultiStory, pushSingleIssue };
}
