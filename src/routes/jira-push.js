// ── JIRA push routes ──────────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pMap } from '../utils/pMap.js';
import { sendError, parseApiError, assertDocType, assertFilename } from '../utils/routeHelpers.js';
import {
  setFrontmatterField, extractFrontmatterField, stripFrontmatter, markdownToJira,
} from '../utils/transforms.js';
import { parseStorySections, serializeStoryFile } from '../services/storyService.js';
import { LOCAL_TO_JIRA_TYPE } from '../services/jiraService.js';
import { logAudit } from '../utils/auditLog.js';
import { TEAM_TO_JIRA_LABEL, ALL_TEAM_JIRA_LABELS } from '../config/metadata.js';

/** @param {import('../types.js').JiraRouteContext} ctx */
export default function jiraPushRoutes({
  TYPE_CONFIG, FEATURES_DIR, EPICS_DIR, BUGS_DIR, JIRA_PROJECT, JIRA_LABEL, JIRA_BASE, JIRA_BOARD_ID,
  FIELD_EPIC_NAME, FIELD_EPIC_LINK, FIELD_STORY_POINTS,
  jiraRequest, jiraAgileRequest, jiraUploadAttachment, jiraIssueToMarkdown, extractJiraSummary,
  broadcast, logInfo, logWarn, logError, docIndex,
}) {
  const router = Router();

  // ── Sprint cache (for Agile API sprint lookup) ──────────────────────────────
  /** @type {{ map: Map<string, number>; fetchedAt: number } | null} */
  let _sprintCache = null;
  const SPRINT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /** @param {string} sprintName */
  async function getSprintId(sprintName) {
    if (!JIRA_BOARD_ID) return null;

    // Return from cache if fresh
    if (_sprintCache && (Date.now() - _sprintCache.fetchedAt) < SPRINT_CACHE_TTL) {
      return _sprintCache.map.get(sprintName) ?? null;
    }

    // Fetch all active + future sprints from the board (paginated)
    /** @type {Map<string, number>} */
    const map = new Map();
    let startAt = 0;
    const maxResults = 50;
    while (true) {
      const data = /** @type {Record<string, any>} */ (await jiraAgileRequest('GET', `/board/${JIRA_BOARD_ID}/sprint?state=active,future&maxResults=${maxResults}&startAt=${startAt}`));
      const sprints = data.values || [];
      for (const s of sprints) {
        if (s.name && s.id) map.set(s.name, s.id);
      }
      if (data.isLast !== false || sprints.length < maxResults) break;
      startAt += sprints.length;
    }

    _sprintCache = { map, fetchedAt: Date.now() };
    return map.get(sprintName) ?? null;
  }

  // ── "Contains" link type discovery (cached) ─────────────────────────────────
  /** @type {{ name: string; fetchedAt: number } | null} */
  let _containsLinkType = null;
  const LINK_TYPE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  async function getContainsLinkTypeName() {
    if (_containsLinkType && (Date.now() - _containsLinkType.fetchedAt) < LINK_TYPE_CACHE_TTL) {
      return _containsLinkType.name;
    }
    try {
      const data = /** @type {{ issueLinkTypes?: Array<{ name: string; inward: string; outward: string }> }} */ (
        await jiraRequest('GET', '/issueLinkType')
      );
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
  /**
   * @param {{ filename: string; filepath: string; sections: string[]; frontmatter: string; type: string }} opts
   */
  async function pushMultiStory({ filename, filepath, sections, frontmatter, type }) {
    const epicFilename = filename.replace('-stories.md', '.md');
    const epicPath     = path.join(EPICS_DIR, epicFilename);
    let epicJiraId     = null;
    if (fs.existsSync(epicPath)) {
      const id = extractFrontmatterField(fs.readFileSync(epicPath, 'utf-8'), 'JIRA_ID');
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
          /** @type {Record<string, unknown>} */
          const fields = {
            project: { key: JIRA_PROJECT }, summary: storyTitle,
            description: markdownToJira(section), issuetype: { name: 'Story' }, labels: multiLabels,
          };
          if (epicJiraId) fields[FIELD_EPIC_LINK] = epicJiraId;
          const created = /** @type {{ key: string }} */ (await jiraRequest('POST', '/issue', { fields }));
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

    fs.writeFileSync(filepath, serializeStoryFile(frontmatter, updatedSections));
    broadcast({ type: 'story_created', filename, docType: type });
    return { type: 'multi-story', results, errors };
  }

  // ── Single-issue push helper ──────────────────────────────────────────────
  /**
   * @param {{ filename: string; filepath: string; content: string; type: string }} opts
   */
  async function pushSingleIssue({ filename, filepath, content, type }) {
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
      /** @type {Record<string, unknown>} */
      const updateFields = { summary, description };
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
            const epicJiraId = extractFrontmatterField(fs.readFileSync(epicPath, 'utf-8'), 'JIRA_ID');
            if (epicJiraId && epicJiraId !== 'TBD') updateFields[FIELD_EPIC_LINK] = epicJiraId;
          }
        } else {
          // Epic_ID cleared — remove Epic Link in JIRA
          updateFields[FIELD_EPIC_LINK] = null;
        }
      }

      // Update team label: fetch current labels, strip old team labels, add new one
      try {
        const issue = /** @type {{ fields: { labels?: string[] } }} */ (await jiraRequest('GET', `/issue/${jiraId}?fields=labels`));
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
            const featureJiraId = extractFrontmatterField(fs.readFileSync(featurePath, 'utf-8'), 'JIRA_ID');
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
      /** @type {Record<string, unknown>} */
      const fields = {
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
            const epicJiraId = extractFrontmatterField(fs.readFileSync(epicPath, 'utf-8'), 'JIRA_ID');
            if (epicJiraId && epicJiraId !== 'TBD') fields[FIELD_EPIC_LINK] = epicJiraId;
          }
        }
      }

      const created = /** @type {{ key: string }} */ (await jiraRequest('POST', '/issue', { fields }));
      key = created.key; action = 'created';

      if (type === 'epic') {
        const featureFilename = extractFrontmatterField(content, 'Feature_ID');
        if (featureFilename && featureFilename !== 'TBD') {
          const featurePath = path.join(FEATURES_DIR, featureFilename);
          if (fs.existsSync(featurePath)) {
            const featureJiraId = extractFrontmatterField(fs.readFileSync(featurePath, 'utf-8'), 'JIRA_ID');
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
      fs.writeFileSync(filepath, updated);
      docIndex.invalidate(type, filename);
      broadcast({ type: 'status_updated', filename, docType: type, status: 'Created in JIRA' });
      logAudit({ op: 'jira-push', docType: type, filename, fields: { jiraId: key }, source: 'api' });
    }

    // Upload local attachments for bugs
    if (type === 'bug' && BUGS_DIR) {
      const slug = filename.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
      const attachDir = path.join(BUGS_DIR, 'attachments', slug);
      if (fs.existsSync(attachDir)) {
        for (const attFile of fs.readdirSync(attachDir)) {
          try {
            const buf = fs.readFileSync(path.join(attachDir, attFile));
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

      // Build local metadata for each item (synchronous, no I/O limit needed)
      const localItems = items.flatMap((/** @type {{ filename: string; docType: string }} */ { filename, docType }) => {
        const cfg = TYPE_CONFIG[docType];
        if (!cfg) return [];
        const filepath = path.join(cfg.dir(), filename);
        if (!fs.existsSync(filepath)) return [];
        const content    = fs.readFileSync(filepath, 'utf-8');
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
              const epicContent = fs.readFileSync(epicPath, 'utf-8');
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
              const featureContent = fs.readFileSync(featurePath, 'utf-8');
              const fid = extractFrontmatterField(featureContent, 'JIRA_ID');
              if (!fid || fid === 'TBD') {
                pendingFeatureTitle = extractJiraSummary(featureContent);
              }
            }
          }
        }
        const localSprint = extractFrontmatterField(content, 'Sprint');
        return [{ filename, docType, content, jiraId, localTitle, spValue, localEpicJiraId, pendingEpicTitle, epicFilenameRef, pendingFeatureTitle, localTeamLabel, localSprint }];
      });

      // Auto-include TBD epics referenced by stories but not already in the push scope
      const includedFilenames = new Set(localItems.map((/** @type {{ filename: string }} */ i) => i.filename));
      const extraEpics = [];
      for (const item of localItems) {
        if (item.pendingEpicTitle && item.epicFilenameRef && !includedFilenames.has(item.epicFilenameRef)) {
          const epicPath = path.join(EPICS_DIR, item.epicFilenameRef);
          if (fs.existsSync(epicPath)) {
            const epicContent = fs.readFileSync(epicPath, 'utf-8');
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
              localTeamLabel: epicTeamLabel, localSprint: epicSprint,
              autoIncluded: true,
            });
          }
        }
      }
      localItems.unshift(...extraEpics);

      // Fetch JIRA data for existing issues in parallel (capped at JIRA_CONCURRENCY)
      const previews = await pMap(localItems, async ({ filename, docType, jiraId, localTitle, spValue, localEpicJiraId, pendingEpicTitle, pendingFeatureTitle, localTeamLabel, localSprint, autoIncluded }) => {
        /** @type {Record<string, unknown>[]} */
        const changes = [];
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
            const issue = /** @type {Record<string, any>} */ (await jiraRequest('GET', `/issue/${jiraId}?fields=${fetchFields}`));
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
            const jiraLabels = (issue.fields?.labels ?? []);
            const currentTeamLabel = jiraLabels.find(l => ALL_TEAM_JIRA_LABELS.has(l)) ?? null;
            if (currentTeamLabel !== localTeamLabel) {
              changes.push({ field: 'teamLabel', from: currentTeamLabel, to: localTeamLabel });
            }
            // Detect Epic Link changes for stories/spikes/bugs
            if (docType === 'story' || docType === 'spike' || docType === 'bug') {
              const jiraEpicLink = issue.fields?.[FIELD_EPIC_LINK] || null;
              if ((localEpicJiraId || null) !== jiraEpicLink || pendingEpicTitle) {
                /** @type {Record<string, unknown>} */
                const change = { field: 'epicLink', from: jiraEpicLink, to: localEpicJiraId };
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
                const agileIssue = /** @type {Record<string, any>} */ (await jiraAgileRequest('GET', `/issue/${jiraId}?fields=sprint`));
                const jiraSprintName = agileIssue?.fields?.sprint?.name || null;
                if (localSprint !== jiraSprintName) {
                  changes.push({ field: 'sprint', from: jiraSprintName, to: localSprint });
                }
              } catch { /* sprint preview is best-effort */ }
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
      const content = fs.readFileSync(filepath, 'utf-8');
      const { frontmatter, sections } = parseStorySections(content);

      const isMultiStory = type === 'story'
        && sections.length > 0
        && /^## Story \d+/m.test(sections[0]);

      if (isMultiStory) {
        return res.json(await pushMultiStory({ filename, filepath, sections, frontmatter, type }));
      }

      res.json(await pushSingleIssue({ filename, filepath, content, type }));
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/push/:type/:filename', apiErr.message, apiErr.details || {});
      sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/push-sprints ── push only sprint assignments to JIRA ─────
  router.post('/api/jira/push-sprints', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    if (!JIRA_BOARD_ID) return sendError(res, 400, 'NO_BOARD', 'JIRA_BOARD_ID not configured');

    try {
      const { items = [] } = req.body;
      const results = await pMap(items, async ({ filename, sprint }) => {
        const entry = docIndex.get(filename);
        if (!entry || !entry.jiraId) return { filename, status: 'skipped', reason: 'no JIRA ID' };
        if (!sprint) return { filename, status: 'skipped', reason: 'no sprint' };
        try {
          const sprintId = await getSprintId(sprint);
          if (!sprintId) return { filename, status: 'skipped', reason: `sprint "${sprint}" not found on board` };
          await jiraAgileRequest('POST', `/sprint/${sprintId}/issue`, { issues: [entry.jiraId] });
          logInfo('jira/push-sprints', `Assigned ${entry.jiraId} to sprint "${sprint}"`);
          return { filename, status: 'ok', jiraId: entry.jiraId, sprint };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logWarn('jira/push-sprints', `Failed to assign sprint for ${entry.jiraId}: ${msg}`);
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
