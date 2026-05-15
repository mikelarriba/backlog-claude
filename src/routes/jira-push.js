// ── JIRA push routes ──────────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, parseApiError, assertDocType, assertFilename } from '../utils/routeHelpers.js';
import {
  setFrontmatterField, extractFrontmatterField, stripFrontmatter, markdownToJira,
} from '../utils/transforms.js';
import { parseStorySections, serializeStoryFile } from '../services/storyService.js';
import { LOCAL_TO_JIRA_TYPE } from '../services/jiraService.js';

export default function jiraPushRoutes({
  TYPE_CONFIG, FEATURES_DIR, EPICS_DIR, BUGS_DIR, JIRA_PROJECT, JIRA_LABEL, JIRA_BASE,
  FIELD_EPIC_NAME, FIELD_EPIC_LINK, FIELD_STORY_POINTS,
  jiraRequest, jiraUploadAttachment, jiraIssueToMarkdown, extractJiraSummary,
  broadcast, logInfo, logWarn, logError, docIndex,
}) {
  const router = Router();

  // ── Multi-story push helper ─────────────────────────────────────────────────
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
          const fields = {
            project: { key: JIRA_PROJECT }, summary: storyTitle,
            description: markdownToJira(section), issuetype: { name: 'Story' }, labels: [JIRA_LABEL],
          };
          if (epicJiraId) fields[FIELD_EPIC_LINK] = epicJiraId;
          const created = await jiraRequest('POST', '/issue', { fields });
          key = created.key;
          results.push({ action: 'created', key });
          section = section.replace(/^(## Story \d+:\s*.+?)(\s*)$/m, `$1 <!-- JIRA:${key} -->`);
        }
      } catch (e) {
        errors.push({ story: storyTitle, error: e.message });
        logWarn('jira/pushMultiStory', `Failed to push story "${storyTitle}": ${e.message}`);
      }
      updatedSections.push(section);
    }

    fs.writeFileSync(filepath, serializeStoryFile(frontmatter, updatedSections));
    broadcast({ type: 'story_created', filename, docType: type });
    return { type: 'multi-story', results, errors };
  }

  // ── Single-issue push helper ──────────────────────────────────────────────
  async function pushSingleIssue({ filename, filepath, content, type }) {
    const jiraId      = extractFrontmatterField(content, 'JIRA_ID') || 'TBD';
    const summary     = extractJiraSummary(content);
    const _bodyOnly   = stripFrontmatter(content).replace(/^#{1,2}\s+.+\n?/, '').trim();
    const description = markdownToJira(_bodyOnly);
    const jiraType    = LOCAL_TO_JIRA_TYPE[type] || 'Story';
    const localFixVersion  = extractFrontmatterField(content, 'Fix_Version');
    const localStoryPoints = extractFrontmatterField(content, 'Story_Points');
    const spValue = localStoryPoints && localStoryPoints !== 'TBD' ? Number(localStoryPoints) : null;

    let key, action;

    if (jiraId !== 'TBD') {
      const updateFields = { summary, description };
      if (localFixVersion && localFixVersion !== 'TBD') {
        updateFields.fixVersions = [{ name: localFixVersion }];
      }
      if (spValue !== null) updateFields[FIELD_STORY_POINTS] = spValue;
      await jiraRequest('PUT', `/issue/${jiraId}`, { fields: updateFields });
      key = jiraId; action = 'updated';
    } else {
      const fields = {
        project: { key: JIRA_PROJECT }, summary, description,
        issuetype: { name: jiraType }, labels: type === 'bug' ? [JIRA_LABEL, 'MIDAS_SC3', 'MIDAS_Issues'] : [JIRA_LABEL],
      };
      if (localFixVersion && localFixVersion !== 'TBD') fields.fixVersions = [{ name: localFixVersion }];
      if (spValue !== null) fields[FIELD_STORY_POINTS] = spValue;
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

      const created = await jiraRequest('POST', '/issue', { fields });
      key = created.key; action = 'created';

      if (type === 'epic') {
        const featureFilename = extractFrontmatterField(content, 'Feature_ID');
        if (featureFilename && featureFilename !== 'TBD') {
          const featurePath = path.join(FEATURES_DIR, featureFilename);
          if (fs.existsSync(featurePath)) {
            const featureJiraId = extractFrontmatterField(fs.readFileSync(featurePath, 'utf-8'), 'JIRA_ID');
            if (featureJiraId && featureJiraId !== 'TBD') {
              await jiraRequest('POST', '/issueLink', {
                type: { name: 'Is Contained' }, inwardIssue: { key }, outwardIssue: { key: featureJiraId },
              }).catch(e => logWarn('jira/push', `Could not create "Is Contained" link: ${e.message}`));
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
            logWarn('jira/push', `Failed to upload attachment ${attFile}: ${e.message}`);
          }
        }
      }
    }

    return { action, key, filename, docType: type };
  }

  // ── POST /api/jira/push-preview ─────────────────────────────────────────────
  // Returns a field-level diff for each item so the client can show a confirmation popup.
  router.post('/api/jira/push-preview', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const { items = [] } = req.body;
      const previews = [];

      for (const { filename, docType } of items) {
        const cfg = TYPE_CONFIG[docType];
        if (!cfg) continue;
        const filepath = path.join(cfg.dir(), filename);
        if (!fs.existsSync(filepath)) continue;

        const content   = fs.readFileSync(filepath, 'utf-8');
        const jiraId    = extractFrontmatterField(content, 'JIRA_ID') || 'TBD';
        const localTitle = extractJiraSummary(content);
        const localSP   = extractFrontmatterField(content, 'Story_Points');
        const spValue   = localSP && localSP !== 'TBD' ? Number(localSP) : null;

        const preview = {
          filename, docType, title: localTitle,
          jiraId: jiraId !== 'TBD' ? jiraId : null,
          action: jiraId !== 'TBD' ? 'update' : 'create',
          changes: [],
        };

        if (jiraId !== 'TBD') {
          try {
            const issue = await jiraRequest('GET', `/issue/${jiraId}?fields=summary,${FIELD_STORY_POINTS}`);
            const jiraSummary = (issue.fields?.summary || '').trim();
            const jiraSP      = issue.fields?.[FIELD_STORY_POINTS] ?? null;

            if (localTitle !== jiraSummary) {
              preview.changes.push({ field: 'title', from: jiraSummary, to: localTitle });
            }
            preview.changes.push({ field: 'description', changed: true });
            if (spValue !== null && spValue !== jiraSP) {
              preview.changes.push({ field: 'storyPoints', from: jiraSP, to: spValue });
            }
          } catch (e) {
            preview.changes.push({ field: 'error', message: e.message });
          }
        } else {
          if (localTitle) preview.changes.push({ field: 'title', to: localTitle });
          preview.changes.push({ field: 'description', changed: true });
          if (spValue !== null) preview.changes.push({ field: 'storyPoints', to: spValue });
        }

        previews.push(preview);
      }

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
