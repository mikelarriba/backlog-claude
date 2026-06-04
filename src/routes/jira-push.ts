// ── JIRA push routes ──────────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pMap } from '../utils/pMap.js';
import { sendError, parseApiError, assertDocType, assertFilename, setupSSE } from '../utils/routeHelpers.js';
import {
  setFrontmatterField, extractFrontmatterField, stripFrontmatter, markdownToJira,
} from '../utils/transforms.js';
import { parseStorySections, serializeStoryFile } from '../services/storyService.js';
import { LOCAL_TO_JIRA_TYPE } from '../services/jiraService.js';
import { logAudit } from '../utils/auditLog.js';
import { TEAM_TO_JIRA_LABEL, ALL_TEAM_JIRA_LABELS } from '../config/metadata.js';
import type { JiraRouteContext } from '../types.js';

export default function jiraPushRoutes({
  TYPE_CONFIG, FEATURES_DIR, EPICS_DIR, BUGS_DIR, JIRA_PROJECT, JIRA_LABEL, JIRA_BASE, JIRA_BOARD_ID,
  FIELD_EPIC_NAME, FIELD_EPIC_LINK, FIELD_STORY_POINTS,
  jiraRequest, jiraAgileRequest, jiraUploadAttachment, jiraIssueToMarkdown, extractJiraSummary,
  broadcast, logInfo, logWarn, logError, docIndex,
}: JiraRouteContext) {
  const router = Router();

  // ── Sprint cache (for Agile API sprint lookup) ──────────────────────────────
  let _sprintCache: { map: Map<string, number>; fetchedAt: number } | null = null;
  const SPRINT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async function ensureSprintCache(): Promise<Map<string, number>> {
    if (_sprintCache && (Date.now() - _sprintCache.fetchedAt) < SPRINT_CACHE_TTL) {
      return _sprintCache.map;
    }
    const map = new Map<string, number>();
    let startAt = 0;
    const maxResults = 50;
    while (true) {
      const data = (await jiraAgileRequest('GET', `/board/${JIRA_BOARD_ID}/sprint?state=active,future&maxResults=${maxResults}&startAt=${startAt}`)) as Record<string, any>;
      const sprints = data.values || [];
      for (const s of sprints) {
        if (s.name && s.id) map.set(s.name, s.id);
      }
      if (data.isLast !== false || sprints.length < maxResults) break;
      startAt += sprints.length;
    }
    _sprintCache = { map, fetchedAt: Date.now() };
    return map;
  }

  async function getSprintId(sprintName: string) {
    if (!JIRA_BOARD_ID) return null;
    const map = await ensureSprintCache();
    return map.get(sprintName) ?? null;
  }

  // ── "Contains" link type discovery (cached) ─────────────────────────────────
  let _containsLinkType: { name: string; fetchedAt: number } | null = null;
  const LINK_TYPE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  async function getContainsLinkTypeName() {
    if (_containsLinkType && (Date.now() - _containsLinkType.fetchedAt) < LINK_TYPE_CACHE_TTL) {
      return _containsLinkType.name;
    }
    try {
      const data = (await jiraRequest('GET', '/issueLinkType')) as { issueLinkTypes?: Array<{ name: string; inward: string; outward: string }> };
      const types = data.issueLinkTypes || [];
      const match = types.find(t =>
        /contain/i.test(t.name) || /contain/i.test(t.inward) || /contain/i.test(t.outward)
      );
      if (match) {
        _containsLinkType = { name: match.name, fetchedAt: Date.now() };
        return match.name;
      }
      logWarn('jira/push', `No "contains" link type found in JIRA. Available: ${types.map(t => t.name).join(', ')}`);
      return null;
    } catch (e) {
      logWarn('jira/push', `Could not fetch JIRA link types: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  // ── Multi-story push helper ─────────────────────────────────────────────────
  async function pushMultiStory({ filename, filepath, sections, frontmatter, type }: { filename: string; filepath: string; sections: string[]; frontmatter: string; type: string }) {
    const epicFilename = filename.replace('-stories.md', '.md');
    const epicPath     = path.join(EPICS_DIR, epicFilename);
    let epicJiraId     = null;
    if (fs.existsSync(epicPath)) {
      const id = extractFrontmatterField(await fs.promises.readFile(epicPath, 'utf-8'), 'JIRA_ID');
      if (id && id !== 'TBD') epicJiraId = id;
    }

    const results         = [];
    const errors          = [];
    const updatedSections = [];

    for (let section of sections) {
      const headerMatch = section.match(/^(## Story \d+:\s*.+?)(?:\s*<!--\s*JIRA:(\S+?)\s*-->)?\s*$/m);
      const existingKey = headerMatch?.[2] || null;
      const storyTitle  = headerMatch
        ? headerMatch[1].replace(/^## Story \d+:\s*/, '').trim()
        : extractJiraSummary(section);

      try {
        let key;
        if (existingKey) {
          await jiraRequest('PUT', `/issue/${existingKey}`, {
            fields: { description: markdownToJira(section) }
          });
          key = existingKey;
          results.push({ action: 'updated', key });
        } else {
          const fmTeam = extractFrontmatterField(frontmatter, 'Team');
          const fmTeamLabel = (fmTeam && fmTeam !== 'TBD') ? (TEAM_TO_JIRA_LABEL[fmTeam] ?? null) : null;
          const multiLabels = fmTeamLabel ? [JIRA_LABEL, fmTeamLabel] : [JIRA_LABEL];
          const fields: Record<string, unknown> = {
            project: { key: JIRA_PROJECT }, summary: storyTitle,
            description: markdownToJira(section), issuetype: { name: 'Story' }, labels: multiLabels,
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
  async function pushSingleIssue({ filename, filepath, content, type }: { filename: string; filepath: string; content: string; type: string }) {
    const jiraId      = extractFrontmatterField(content, 'JIRA_ID') || 'TBD';
    const summary     = extractJiraSummary(content);
    const _bodyOnly   = stripFrontmatter(content).replace(/^#{1,2}\s+.+\n?/, '').replace(/\n## Comments\b[\s\S]*$/, '').trim();
    const description = markdownToJira(_bodyOnly);
    const jiraType    = LOCAL_TO_JIRA_TYPE[type] || 'Story';
    const localFixVersion  = extractFrontmatterField(content, 'Fix_Version');
    const localStoryPoints = extractFrontmatterField(content, 'Story_Points');
    const spValue = localStoryPoints && localStoryPoints !== 'TBD' ? Number(localStoryPoints) : null;
    const localTeam = extractFrontmatterField(content, 'Team');
    const teamLabel = (localTeam && localTeam !== 'TBD') ? (TEAM_TO_JIRA_LABEL[localTeam] ?? null) : null;

    let key, action;

    if (jiraId !== 'TBD') {
      const updateFields: Record<string, unknown> = { summary, description };
      if (localFixVersion && localFixVersion !== 'TBD') {
        updateFields['fixVersions'] = [{ name: localFixVersion }];
      }
      // Only push story points for leaf types (not features/epics — those show the sum of children)
      if (spValue !== null && type !== 'feature' && type !== 'epic') updateFields[FIELD_STORY_POINTS] = spValue;

      // Sync Epic Link when a story/spike/bug has been moved to a different epic
      if (type === 'story' || type === 'spike' || type === 'bug') {
        const epicFilename = extractFrontmatterField(content, 'Epic_ID');
        if (epicFilename && epicFilename !== 'TBD') {
          const epicPath = path.join(EPICS_DIR, epicFilename);
          if (fs.existsSync(epicPath)) {
            const epicJiraId = extractFrontmatterField(await fs.promises.readFile(epicPath, 'utf-8'), 'JIRA_ID');
            if (epicJiraId && epicJiraId !== 'TBD') updateFields[FIELD_EPIC_LINK] = epicJiraId;
          }
        } else {
          // Epic_ID cleared — remove Epic Link in JIRA
          updateFields[FIELD_EPIC_LINK] = null;
        }
      }

      // Update team label: fetch current labels, strip old team labels, add new one
      try {
        const issue = (await jiraRequest('GET', `/issue/${jiraId}?fields=labels`)) as { fields: { labels?: string[] } };
        const existingLabels = issue.fields?.labels ?? [];
        const nonTeamLabels  = existingLabels.filter(l => !ALL_TEAM_JIRA_LABELS.has(l));
        const newLabels = teamLabel ? [...nonTeamLabels, teamLabel] : nonTeamLabels;
        if (JSON.stringify(existingLabels.sort()) !== JSON.stringify(newLabels.sort())) {
          updateFields['labels'] = newLabels;
        }
      } catch (e) {
        logWarn('jira/push', `Could not fetch labels for ${jiraId}: ${e instanceof Error ? e.message : String(e)}`);
      }

      await jiraRequest('PUT', `/issue/${jiraId}`, { fields: updateFields });
      key = jiraId; action = 'updated';

      // Sync "contains" link for epics (best-effort, idempotent — JIRA errors if link exists)
      if (type === 'epic') {
        const featureFilename = extractFrontmatterField(content, 'Feature_ID');
        if (featureFilename && featureFilename !== 'TBD') {
          const featurePath = path.join(FEATURES_DIR, featureFilename);
          if (fs.existsSync(featurePath)) {
            const featureJiraId = extractFrontmatterField(await fs.promises.readFile(featurePath, 'utf-8'), 'JIRA_ID');
            if (featureJiraId && featureJiraId !== 'TBD') {
              const linkTypeName = await getContainsLinkTypeName();
              if (linkTypeName) {
                await jiraRequest('POST', '/issueLink', {
                  type: { name: linkTypeName }, inwardIssue: { key }, outwardIssue: { key: featureJiraId },
                }).catch(e => logWarn('jira/push', `Could not create "${linkTypeName}" link: ${e instanceof Error ? e.message : String(e)}`));
              }
            }
          }
        }
      }
    } else {
      const baseLabels = type === 'bug' ? [JIRA_LABEL, 'MIDAS_SC3', 'MIDAS_Issues'] : [JIRA_LABEL];
      if (teamLabel) baseLabels.push(teamLabel);
      const fields: Record<string, unknown> = {
        project: { key: JIRA_PROJECT }, summary, description,
        issuetype: { name: jiraType }, labels: baseLabels,
      };
      if (localFixVersion && localFixVersion !== 'TBD') fields['fixVersions'] = [{ name: localFixVersion }];
      if (spValue !== null && type !== 'feature' && type !== 'epic') fields[FIELD_STORY_POINTS] = spValue;
      if (type === 'epic') fields[FIELD_EPIC_NAME] = summary.slice(0, 60);

      if (type === 'story' || type === 'spike' || type === 'bug') {
        const epicFilename = extractFrontmatterField(content, 'Epic_ID');
        if (epicFilename && epicFilename !== 'TBD') {
          const epicPath = path.join(EPICS_DIR, epicFilename);
          if (fs.existsSync(epicPath)) {
            const epicJiraId = extractFrontmatterField(await fs.promises.readFile(epicPath, 'utf-8'), 'JIRA_ID');
            if (epicJiraId && epicJiraId !== 'TBD') fields[FIELD_EPIC_LINK] = epicJiraId;
          }
        }
      }

      const created = (await jiraRequest('POST', '/issue', { fields })) as { key: string };
      key = created.key; action = 'created';

      if (type === 'epic') {
        const featureFilename = extractFrontmatterField(content, 'Feature_ID');
        if (featureFilename && featureFilename !== 'TBD') {
          const featurePath = path.join(FEATURES_DIR, featureFilename);
          if (fs.existsSync(featurePath)) {
            const featureJiraId = extractFrontmatterField(await fs.promises.readFile(featurePath, 'utf-8'), 'JIRA_ID');
            if (featureJiraId && featureJiraId !== 'TBD') {
              const linkTypeName = await getContainsLinkTypeName();
              if (linkTypeName) {
                await jiraRequest('POST', '/issueLink', {
                  type: { name: linkTypeName }, inwardIssue: { key }, outwardIssue: { key: featureJiraId },
                }).catch(e => logWarn('jira/push', `Could not create "${linkTypeName}" link: ${e instanceof Error ? e.message : String(e)}`));
              }
            }
          }
        }
      }

      let updated = setFrontmatterField(content, 'JIRA_ID',   key);
      updated     = setFrontmatterField(updated,  'JIRA_URL', `${JIRA_BASE}/browse/${key}`);
      updated     = setFrontmatterField(updated,  'Status',   'Created in JIRA');
      await fs.promises.writeFile(filepath, updated);
      await docIndex.invalidate(type, filename);
      broadcast({ type: 'status_updated', filename, docType: type, status: 'Created in JIRA' });
      logAudit({ op: 'jira-push', docType: type, filename, fields: { jiraId: key }, source: 'api' });
    }

    // Upload local attachments for bugs
    if (type === 'bug' && BUGS_DIR) {
      const slug = filename.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
      const attachDir = path.join(BUGS_DIR, 'attachments', slug);
      if (fs.existsSync(attachDir)) {
        for (const attFile of (await fs.promises.readdir(attachDir))) {
          try {
            const buf = await fs.promises.readFile(path.join(attachDir, attFile));
            await jiraUploadAttachment(key, attFile, buf);
            logInfo('jira/push', `Uploaded attachment ${attFile} to ${key}`);
          } catch (e) {
            logWarn('jira/push', `Failed to upload attachment ${attFile}: ${e instanceof Error ? e.message : String(e)}`);
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
        logWarn('jira/push', `Could not assign sprint for ${key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { action, key, filename, docType: type };
  }

  // ── POST /api/jira/push-preview ─────────────────────────────────────────────
  // Returns a field-level diff for each item so the client can show a confirmation popup.
  // Items with an existing JIRA ID are fetched in parallel (max JIRA_CONCURRENCY at once).
  const JIRA_CONCURRENCY = Number(process.env.JIRA_CONCURRENCY) || 5;

  router.post('/api/jira/push-preview', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const { items = [] } = req.body;

      type PreviewItem = {
        filename: string; docType: string; content: string; jiraId: string; localTitle: string;
        spValue: number | null; localEpicJiraId: string | null; pendingEpicTitle: string | null;
        epicFilenameRef: string | null; pendingFeatureTitle: string | null;
        localTeamLabel: string | null; localSprint: string | null; autoIncluded?: boolean;
      };
      // Build local metadata for each item
      const localItemsRaw: (PreviewItem | null)[] = await Promise.all(items.map(async ({ filename, docType }: { filename: string; docType: string }) => {
        const cfg = TYPE_CONFIG[docType];
        if (!cfg) return null;
        const filepath = path.join(cfg.dir(), filename);
        if (!fs.existsSync(filepath)) return null;
        const content    = await fs.promises.readFile(filepath, 'utf-8');
        const jiraId     = extractFrontmatterField(content, 'JIRA_ID') || 'TBD';
        const localTitle = extractJiraSummary(content);
        const localSP    = extractFrontmatterField(content, 'Story_Points');
        const spValue    = localSP && localSP !== 'TBD' ? Number(localSP) : null;
        const localTeamFm = extractFrontmatterField(content, 'Team');
        const localTeamLabel = (localTeamFm && localTeamFm !== 'TBD') ? (TEAM_TO_JIRA_LABEL[localTeamFm] ?? null) : null;
        // Resolve local Epic Link for stories/spikes/bugs
        let localEpicJiraId = null;
        let pendingEpicTitle = null;
        let epicFilenameRef = null;
        if (docType === 'story' || docType === 'spike' || docType === 'bug') {
          const epicFilename = extractFrontmatterField(content, 'Epic_ID');
          if (epicFilename && epicFilename !== 'TBD') {
            epicFilenameRef = epicFilename;
            const epicPath = path.join(EPICS_DIR, epicFilename);
            if (fs.existsSync(epicPath)) {
              const epicContent = await fs.promises.readFile(epicPath, 'utf-8');
              const eid = extractFrontmatterField(epicContent, 'JIRA_ID');
              if (eid && eid !== 'TBD') {
                localEpicJiraId = eid;
              } else {
                // Epic exists locally but not yet in JIRA — capture its title for preview
                pendingEpicTitle = extractJiraSummary(epicContent);
              }
            }
          }
        }
        // Resolve local Feature link for epics
        let pendingFeatureTitle = null;
        if (docType === 'epic') {
          const featureFilename = extractFrontmatterField(content, 'Feature_ID');
          if (featureFilename && featureFilename !== 'TBD') {
            const featurePath = path.join(FEATURES_DIR, featureFilename);
            if (fs.existsSync(featurePath)) {
              const featureContent = await fs.promises.readFile(featurePath, 'utf-8');
              const fid = extractFrontmatterField(featureContent, 'JIRA_ID');
              if (!fid || fid === 'TBD') {
                pendingFeatureTitle = extractJiraSummary(featureContent);
              }
            }
          }
        }
        const localSprint = extractFrontmatterField(content, 'Sprint');
        return { filename, docType, content, jiraId, localTitle, spValue, localEpicJiraId, pendingEpicTitle, epicFilenameRef, pendingFeatureTitle, localTeamLabel, localSprint } as PreviewItem;
      }));
      const localItems: PreviewItem[] = localItemsRaw.filter((x): x is PreviewItem => x !== null);

      // Auto-include TBD epics referenced by stories but not already in the push scope
      const includedFilenames = new Set(localItems.map(i => i.filename));
      const extraEpics: PreviewItem[] = [];
      for (const item of localItems) {
        if (item.pendingEpicTitle && item.epicFilenameRef && !includedFilenames.has(item.epicFilenameRef)) {
          const epicPath = path.join(EPICS_DIR, item.epicFilenameRef);
          if (fs.existsSync(epicPath)) {
            const epicContent = await fs.promises.readFile(epicPath, 'utf-8');
            const epicTitle = extractJiraSummary(epicContent);
            const epicSP = extractFrontmatterField(epicContent, 'Story_Points');
            const epicSpValue = epicSP && epicSP !== 'TBD' ? Number(epicSP) : null;
            const epicTeamFm = extractFrontmatterField(epicContent, 'Team');
            const epicTeamLabel = (epicTeamFm && epicTeamFm !== 'TBD') ? (TEAM_TO_JIRA_LABEL[epicTeamFm] ?? null) : null;
            const epicSprint = extractFrontmatterField(epicContent, 'Sprint');
            includedFilenames.add(item.epicFilenameRef);
            extraEpics.push({
              filename: item.epicFilenameRef, docType: 'epic', content: epicContent,
              jiraId: 'TBD', localTitle: epicTitle, spValue: epicSpValue,
              localEpicJiraId: null, pendingEpicTitle: null, epicFilenameRef: null,
              pendingFeatureTitle: null, localTeamLabel: epicTeamLabel, localSprint: epicSprint,
              autoIncluded: true,
            });
          }
        }
      }
      localItems.unshift(...extraEpics);

      // Fetch JIRA data for existing issues in parallel (capped at JIRA_CONCURRENCY)
      const previews = await pMap(localItems, async ({ filename, docType, jiraId, localTitle, spValue, localEpicJiraId, pendingEpicTitle, pendingFeatureTitle, localTeamLabel, localSprint, autoIncluded }) => {
        const changes: Record<string, unknown>[] = [];
        const preview = {
          filename, docType, title: localTitle,
          jiraId: jiraId !== 'TBD' ? jiraId : null,
          action: jiraId !== 'TBD' ? 'update' : 'create',
          changes,
          ...(autoIncluded ? { autoIncluded: true } : {}),
        };

        if (jiraId !== 'TBD') {
          try {
            const fetchFields = `summary,labels,${FIELD_STORY_POINTS}` + (FIELD_EPIC_LINK ? `,${FIELD_EPIC_LINK}` : '');
            const issue = (await jiraRequest('GET', `/issue/${jiraId}?fields=${fetchFields}`)) as Record<string, any>;
            const jiraSummary = (issue.fields?.summary || '').trim();
            const jiraSP      = issue.fields?.[FIELD_STORY_POINTS] ?? null;

            if (localTitle !== jiraSummary) {
              changes.push({ field: 'title', from: jiraSummary, to: localTitle });
            }
            changes.push({ field: 'description', changed: true });
            if (spValue !== null && spValue !== jiraSP && docType !== 'feature' && docType !== 'epic') {
              changes.push({ field: 'storyPoints', from: jiraSP, to: spValue });
            }
            // Detect team label changes
            const jiraLabels = (issue.fields?.labels ?? []) as string[];
            const currentTeamLabel = jiraLabels.find((l: string) => ALL_TEAM_JIRA_LABELS.has(l)) ?? null;
            if (currentTeamLabel !== localTeamLabel) {
              changes.push({ field: 'teamLabel', from: currentTeamLabel, to: localTeamLabel });
            }
            // Detect Epic Link changes for stories/spikes/bugs
            if (docType === 'story' || docType === 'spike' || docType === 'bug') {
              const jiraEpicLink = issue.fields?.[FIELD_EPIC_LINK] || null;
              if ((localEpicJiraId || null) !== jiraEpicLink || pendingEpicTitle) {
                const change: Record<string, unknown> = { field: 'epicLink', from: jiraEpicLink, to: localEpicJiraId };
                if (pendingEpicTitle) change.pendingEpicTitle = pendingEpicTitle;
                changes.push(change);
              }
            }
            // Detect "Is Contained" feature link for epics
            if (docType === 'epic' && pendingFeatureTitle) {
              changes.push({ field: 'containedIn', to: null, pendingFeatureTitle });
            }
            // Detect sprint changes via Agile API
            if (localSprint && localSprint !== 'TBD' && JIRA_BOARD_ID) {
              try {
                const agileIssue = (await jiraAgileRequest('GET', `/issue/${jiraId}?fields=sprint`)) as Record<string, any>;
                const jiraSprintName = agileIssue?.fields?.sprint?.name || null;
                if (localSprint !== jiraSprintName) {
                  changes.push({ field: 'sprint', from: jiraSprintName, to: localSprint });
                }
              } catch (err) { logWarn('jira/push', `sprint preview lookup failed for ${jiraId}`, { error: err instanceof Error ? err.message : String(err) }); }
            }
          } catch (e) {
            changes.push({ field: 'error', message: e instanceof Error ? e.message : String(e) });
          }
        } else {
          if (localTitle) changes.push({ field: 'title', to: localTitle });
          changes.push({ field: 'description', changed: true });
          if (spValue !== null && docType !== 'feature' && docType !== 'epic') changes.push({ field: 'storyPoints', to: spValue });
          if (localTeamLabel) changes.push({ field: 'teamLabel', to: localTeamLabel });
          if (pendingEpicTitle) {
            changes.push({ field: 'epicLink', to: null, pendingEpicTitle });
          }
          if (pendingFeatureTitle) {
            changes.push({ field: 'containedIn', to: null, pendingFeatureTitle });
          }
          if (localSprint && localSprint !== 'TBD' && JIRA_BOARD_ID) {
            changes.push({ field: 'sprint', to: localSprint });
          }
        }

        return preview;
      }, { concurrency: JIRA_CONCURRENCY });

      res.json({ items: previews });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/push-preview', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/push/:type/:filename ────────────────────────────────────
  router.post('/api/jira/push/:type/:filename', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    const docType  = assertDocType(req.params.type, TYPE_CONFIG);
    const cfg      = TYPE_CONFIG[docType];
    const type     = docType;
    const filename = assertFilename(req.params.filename);
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    try {
      const t = Date.now();
      const content = await fs.promises.readFile(filepath, 'utf-8');
      const { frontmatter, sections } = parseStorySections(content);

      const isMultiStory = type === 'story'
        && sections.length > 0
        && /^## Story \d+/m.test(sections[0]);

      if (isMultiStory) {
        const result = await pushMultiStory({ filename, filepath, sections, frontmatter, type });
        logInfo('jira/push', `Pushed multi-story ${filename}: ${result.results?.length ?? 0} stories in ${Date.now() - t}ms`);
        return res.json(result);
      }

      const result = await pushSingleIssue({ filename, filepath, content, type });
      logInfo('jira/push', `${result.action === 'created' ? 'Created' : 'Updated'} ${result.key} (${type}/${filename}) in ${Date.now() - t}ms`);
      res.json(result);
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/push/:type/:filename', apiErr.message, apiErr.details || {});
      sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── Sprint name resolver ────────────────────────────────────────────────────
  // Local sprint names (e.g. "Sprint 100") may differ from JIRA names
  // (e.g. "MIDAS Sprint 100"). Build a bidirectional mapping.
  function buildSprintNameMap(localNames: string[], jiraMap: Map<string, number>) {
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

  // ── POST /api/jira/push-sprints-preview ── compare local vs JIRA sprint state (SSE) ─
  router.post('/api/jira/push-sprints-preview', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    if (!JIRA_BOARD_ID) return sendError(res, 400, 'NO_BOARD', 'JIRA_BOARD_ID not configured');

    setupSSE(res);
    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      const { items = [], selectedSprints = [] } = req.body as {
        items: Array<{ filename: string; sprint: string | null; jiraId: string; title: string; docType: string }>;
        selectedSprints: string[];
      };

      send({ type: 'progress', message: 'Loading sprint data from JIRA board…' });
      const sprintMap = await ensureSprintCache();

      // Build name mapping between local sprint names and JIRA sprint names
      const { localToJira, jiraToLocal } = buildSprintNameMap(selectedSprints, sprintMap);

      // Resolve selected sprints to JIRA sprint names/IDs
      const activeSprintMap = new Map<string, number>(); // jiraName → id
      for (const localName of selectedSprints) {
        const jiraName = localToJira.get(localName);
        if (jiraName) {
          activeSprintMap.set(jiraName, sprintMap.get(jiraName)!);
        }
      }

      if (!activeSprintMap.size) {
        const jiraNames = [...sprintMap.keys()].slice(0, 5).join(', ');
        send({ type: 'error', message: `No matching JIRA sprints found. Local names: ${selectedSprints.join(', ')}. JIRA names on board: ${jiraNames}…` });
        res.end();
        return;
      }

      // Helper: resolve a local sprint name to its JIRA ID
      const resolveSprintId = (localName: string): number | null => {
        const jiraName = localToJira.get(localName);
        if (jiraName) return sprintMap.get(jiraName) ?? null;
        return sprintMap.get(localName) ?? null;
      };

      // Helper: check if two sprint names match (accounting for local/JIRA naming)
      const sprintNamesMatch = (localName: string, jiraName: string): boolean => {
        if (localName === jiraName) return true;
        return localToJira.get(localName) === jiraName;
      };

      // Filter items to those whose local sprint maps to a selected JIRA sprint (or have no sprint)
      const filteredItems = items.filter(i => {
        if (!i.sprint || i.sprint === 'TBD') return true;
        return localToJira.has(i.sprint);
      });

      const changes: Array<Record<string, unknown>> = [];
      const errors: Array<{ jiraId: string; error: string }> = [];
      let unchanged = 0;

      // ── Step 1: Scan selected sprints from the board (bulk fetch) ──────────
      const sprintEntries = [...activeSprintMap.entries()];
      const totalSteps = sprintEntries.length;
      send({ type: 'progress', message: `Scanning ${totalSteps} sprint(s) on JIRA board…`, phase: 1, total: totalSteps });

      // Map: jiraId → { sprintName (JIRA), sprintId, summary }
      const jiraSprintMap = new Map<string, { sprintName: string; sprintId: number; summary: string }>();

      for (let si = 0; si < sprintEntries.length; si++) {
        const [sprintName, sprintId] = sprintEntries[si];
        const localName = jiraToLocal.get(sprintName) || sprintName;
        send({ type: 'progress', message: `Scanning "${localName}" (${si + 1}/${totalSteps})…`, phase: 1, current: si + 1, total: totalSteps });
        try {
          let startAt = 0;
          while (true) {
            const data = (await jiraAgileRequest('GET',
              `/board/${JIRA_BOARD_ID}/sprint/${sprintId}/issue?fields=summary&maxResults=100&startAt=${startAt}`
            )) as Record<string, any>;
            const issues = data.issues || [];
            for (const iss of issues) {
              if (!jiraSprintMap.has(iss.key)) {
                jiraSprintMap.set(iss.key, { sprintName, sprintId, summary: iss.fields?.summary || '' });
              }
            }
            if (issues.length < 100) break;
            startAt += issues.length;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logWarn('jira/push', `board scan for "${sprintName}" failed`, { error: msg });
          send({ type: 'progress', message: `Warning: could not scan "${localName}" — ${msg}` });
        }
      }

      // ── Step 2: Compare local items against the JIRA sprint map ────────────
      send({ type: 'progress', message: `Comparing ${filteredItems.length} local items…`, phase: 2, current: totalSteps, total: totalSteps });

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
            const jiraLocalName = jiraSprintName ? (jiraToLocal.get(jiraSprintName) || jiraSprintName) : null;
            changes.push({
              filename, jiraId, title, docType,
              changeType: jiraSprintName ? 'change' : 'add',
              currentJiraSprint: jiraLocalName, currentJiraSprintId: jiraSprintId,
              targetSprint: localSprint, targetSprintId: targetId,
            });
          }
        } else {
          // Local has no sprint — if JIRA has one, offer to pull (sync JIRA → local)
          if (jiraSprintName) {
            const jiraLocalName = jiraToLocal.get(jiraSprintName) || jiraSprintName;
            changes.push({
              filename, jiraId, title, docType,
              changeType: 'pull',
              currentJiraSprint: jiraLocalName, currentJiraSprintId: jiraSprintId,
              targetSprint: jiraLocalName, targetSprintId: jiraSprintId,
            });
          } else {
            unchanged++;
          }
        }
      }

      // ── Step 3: Detect JIRA-only issues not in local set ───────────────────
      for (const [jiraId, entry] of jiraSprintMap) {
        if (localJiraIds.has(jiraId)) continue;
        const local = docIndex.findByJiraId(jiraId);
        if (!local) continue;
        const localEntry = docIndex.get(local.filename);
        if (!localEntry) continue;
        const localSprint = localEntry.sprint;
        if (localSprint && sprintNamesMatch(localSprint, entry.sprintName)) { unchanged++; continue; }
        if (localSprint && localSprint !== 'TBD') {
          const targetId = resolveSprintId(localSprint);
          changes.push({
            filename: local.filename, jiraId,
            title: entry.summary || local.filename,
            docType: local.docType,
            changeType: 'change',
            currentJiraSprint: jiraToLocal.get(entry.sprintName) || entry.sprintName,
            currentJiraSprintId: entry.sprintId,
            targetSprint: localSprint, targetSprintId: targetId,
          });
        } else {
          // In JIRA sprint but not locally — offer to pull
          const jiraLocalName = jiraToLocal.get(entry.sprintName) || entry.sprintName;
          changes.push({
            filename: local.filename, jiraId,
            title: entry.summary || local.filename,
            docType: local.docType,
            changeType: 'pull',
            currentJiraSprint: jiraLocalName, currentJiraSprintId: entry.sprintId,
            targetSprint: jiraLocalName, targetSprintId: entry.sprintId,
          });
        }
      }

      const stats = {
        total: changes.length,
        adds: changes.filter(c => c.changeType === 'add').length,
        changes: changes.filter(c => c.changeType === 'change').length,
        pulls: changes.filter(c => c.changeType === 'pull').length,
        unchanged,
        errors: errors.length,
      };

      logInfo('POST /api/jira/push-sprints-preview', `${stats.adds} add, ${stats.changes} change, ${stats.pulls} pull, ${unchanged} unchanged, ${errors.length} errors`);
      send({ type: 'result', changes, errors, stats });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/push-sprints-preview', apiErr.message, apiErr.details || {});
      send({ type: 'error', message: apiErr.message });
      res.end();
    }
  });

  // ── POST /api/jira/push-sprints ── push/pull sprint assignments ─────────────
  router.post('/api/jira/push-sprints', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    if (!JIRA_BOARD_ID) return sendError(res, 400, 'NO_BOARD', 'JIRA_BOARD_ID not configured');

    try {
      const { items = [] } = req.body;
      const sprintMap = await ensureSprintCache();

      // Resolve local sprint name to JIRA sprint ID (with fuzzy matching)
      const resolveId = (name: string): number | null => {
        const exact = sprintMap.get(name);
        if (exact != null) return exact;
        for (const [jiraName, id] of sprintMap) {
          if (jiraName.endsWith(name) || name.endsWith(jiraName)) return id;
        }
        return null;
      };

      const results = await pMap(items as Array<{
        filename: string; sprint: string | null; changeType: string;
        jiraId?: string; docType?: string;
      }>, async (item) => {
        const { filename, sprint, changeType } = item;
        const jiraId = item.jiraId || docIndex.get(filename)?.jiraId;
        if (!jiraId) return { filename, status: 'skipped', reason: 'no JIRA ID' };
        try {
          if (changeType === 'pull') {
            // Pull: update local doc's sprint field to match JIRA
            if (!sprint) return { filename, status: 'skipped', reason: 'no sprint to pull' };
            const docType = item.docType || docIndex.get(filename)?.docType;
            if (!docType) return { filename, status: 'skipped', reason: 'unknown doc type' };
            const cfg = TYPE_CONFIG[docType as keyof typeof TYPE_CONFIG];
            if (!cfg) return { filename, status: 'skipped', reason: `unknown type "${docType}"` };
            const filepath = path.join(cfg.dir(), filename);
            const content = await fs.promises.readFile(filepath, 'utf-8');
            const patched = setFrontmatterField(content, 'Sprint', sprint);
            await fs.promises.writeFile(filepath, patched);
            await docIndex.invalidateAll();
            broadcast({ type: 'batch_sprint_updated' });
            logInfo('jira/push-sprints', `Pulled sprint "${sprint}" from JIRA for ${jiraId} → ${filename}`);
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
          if (!sprintId) return { filename, status: 'skipped', reason: `sprint "${sprint}" not found on board` };
          await jiraAgileRequest('POST', `/sprint/${sprintId}/issue`, { issues: [jiraId] });
          logInfo('jira/push-sprints', `Assigned ${jiraId} to sprint "${sprint}"`);
          return { filename, status: 'ok', jiraId, sprint };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logWarn('jira/push-sprints', `Failed sprint op for ${jiraId}: ${msg}`);
          return { filename, status: 'error', error: msg };
        }
      }, { concurrency: JIRA_CONCURRENCY });

      res.json({ results });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/push-sprints', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/push-rank ── sync local rank order to JIRA backlog ────────
  router.post('/api/jira/push-rank', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    try {
      const { key, beforeKey, afterKey } = req.body;
      if (!key) return sendError(res, 400, 'VALIDATION_ERROR', 'key is required');
      if (!beforeKey && !afterKey) return sendError(res, 400, 'VALIDATION_ERROR', 'beforeKey or afterKey is required');

      const body = beforeKey ? { rankBeforeIssue: beforeKey } : { rankAfterIssue: afterKey };
      await jiraRequest('PUT', `/issue/${key}/rank`, body);

      logInfo('POST /api/jira/push-rank', `Ranked ${key} ${beforeKey ? 'before' : 'after'} ${beforeKey || afterKey}`);
      res.json({ success: true, key, beforeKey: beforeKey || null, afterKey: afterKey || null });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/push-rank', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
