// ── JIRA integration routes ──────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, ensureDir, parseApiError, assertDocType, assertFilename, normalizeType } from '../utils/routeHelpers.js';
import {
  isoDate, slugify, extractWorkflowStatus,
  setFrontmatterField, extractFrontmatterField, stripFrontmatter, markdownToJira,
} from '../utils/transforms.js';
import { parseStorySections, serializeStoryFile } from '../services/storyService.js';
import { LOCAL_TO_JIRA_TYPE } from '../services/jiraService.js';

export default function jiraRoutes({
  TYPE_CONFIG, FEATURES_DIR, EPICS_DIR, STORIES_DIR, JIRA_PROJECT, JIRA_LABEL,
  FIELD_EPIC_NAME, FIELD_EPIC_LINK,
  jiraRequest, findLocalFileByJiraId, jiraIssueToMarkdown, extractJiraSummary,
  broadcast, logInfo, logWarn, logError,
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
    const updatedSections = [];

    for (let section of sections) {
      const headerMatch = section.match(/^(## Story \d+:\s*.+?)(?:\s*<!--\s*JIRA:(\S+?)\s*-->)?\s*$/m);
      const existingKey = headerMatch?.[2] || null;
      const storyTitle  = headerMatch
        ? headerMatch[1].replace(/^## Story \d+:\s*/, '').trim()
        : extractJiraSummary(section);

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
      updatedSections.push(section);
    }

    fs.writeFileSync(filepath, serializeStoryFile(frontmatter, updatedSections));
    broadcast({ type: 'story_created', filename, docType: type });
    return { type: 'multi-story', results };
  }

  // ── Single-issue push helper ──────────────────────────────────────────────
  async function pushSingleIssue({ filename, filepath, content, type }) {
    const jiraId      = extractFrontmatterField(content, 'JIRA_ID') || 'TBD';
    const summary     = extractJiraSummary(content);
    const description = markdownToJira(stripFrontmatter(content));
    const jiraType    = LOCAL_TO_JIRA_TYPE[type] || 'Story';
    const localFixVersion = extractFrontmatterField(content, 'Fix_Version');

    let key, action;

    if (jiraId !== 'TBD') {
      const updateFields = { description };
      if (localFixVersion && localFixVersion !== 'TBD') {
        updateFields.fixVersions = [{ name: localFixVersion }];
      }
      await jiraRequest('PUT', `/issue/${jiraId}`, { fields: updateFields });
      key = jiraId; action = 'updated';
    } else {
      const fields = {
        project: { key: JIRA_PROJECT }, summary, description,
        issuetype: { name: jiraType }, labels: [JIRA_LABEL],
      };
      if (localFixVersion && localFixVersion !== 'TBD') fields.fixVersions = [{ name: localFixVersion }];
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

      let updated = setFrontmatterField(content, 'JIRA_ID', key);
      updated     = setFrontmatterField(updated,  'Status',  'Created in JIRA');
      fs.writeFileSync(filepath, updated);
      broadcast({ type: 'status_updated', filename, docType: type, status: 'Created in JIRA' });
    }

    return { action, key, filename, docType: type };
  }

  // ── POST /api/jira/push/:type/:filename ────────────────────────────────────
  router.post('/api/jira/push/:type/:filename', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    const docType = assertDocType(req.params.type, TYPE_CONFIG);
    const cfg = TYPE_CONFIG[docType];
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

  // ── GET /api/jira/search ───────────────────────────────────────────────────
  router.get('/api/jira/search', async (req, res) => {
    try {
      if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const { type = 'all', text = '' } = req.query;
      if (type !== 'all' && !TYPE_CONFIG[normalizeType(type)]) {
        return sendError(res, 400, 'INVALID_TYPE', 'Invalid JIRA filter type', { allowed: ['all', ...Object.keys(TYPE_CONFIG)], received: type });
      }

      const typeClause = type === 'all'
        ? `issuetype in ("New Feature", Epic, Story, Task)`
        : `issuetype = "${LOCAL_TO_JIRA_TYPE[type] || 'Epic'}"`;

      const textClause = text.trim() ? ` AND text ~ "${text.trim().replace(/"/g, '')}"` : '';
      const jql = `project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} AND ${typeClause}${textClause} ORDER BY updated DESC`;
      const fields = `summary,issuetype,status,priority,fixVersions,${FIELD_EPIC_NAME},description`;
      const data = await jiraRequest('GET', `/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=${fields}`);

      const issues = (data.issues || []).map(issue => {
        const existing = findLocalFileByJiraId(issue.key);
        return {
          key:         issue.key,
          summary:     issue.fields.summary || '',
          epicName:    issue.fields[FIELD_EPIC_NAME] || '',
          issuetype:   issue.fields.issuetype?.name || '',
          status:      issue.fields.status?.name || '',
          priority:    issue.fields.priority?.name || '',
          localExists: !!existing,
          localFilename: existing?.filename || null,
          localDocType:  existing?.docType || null,
        };
      });

      res.json({ issues, total: data.total });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('GET /api/jira/search', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/pull ────────────────────────────────────────────────────
  router.post('/api/jira/pull', async (req, res) => {
    try {
      const { keys = [], overwriteKeys = [] } = req.body;
      if (!Array.isArray(keys)) return sendError(res, 400, 'VALIDATION_ERROR', 'keys must be an array');
      if (!keys.length) return sendError(res, 400, 'VALIDATION_ERROR', 'No keys provided');

      if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const pulled    = [];
      const conflicts = [];

      for (const key of keys) {
        const existing = findLocalFileByJiraId(key);
        if (existing && !overwriteKeys.includes(key)) {
          conflicts.push({ key, existingFilename: existing.filename, existingDocType: existing.docType });
          continue;
        }

        const issue = await jiraRequest('GET', `/issue/${key}?fields=summary,issuetype,status,priority,description,fixVersions,${FIELD_EPIC_NAME}`);
        const { docType, content } = jiraIssueToMarkdown(issue);

        let filename;
        if (existing && overwriteKeys.includes(key)) {
          filename = existing.filename;
        } else {
          const slug = slugify(issue.fields.summary || key);
          filename = `${isoDate()}-${slug}.md`;
        }

        const destDir = TYPE_CONFIG[docType].dir();
        ensureDir(destDir);
        fs.writeFileSync(path.join(destDir, filename), content);

        pulled.push({ key, filename, docType });
        broadcast({ type: `${docType}_created`, filename, docType });
      }

      res.json({ pulled, conflicts });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/pull', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/jira/versions ─────────────────────────────────────────────────
  router.get('/api/jira/versions', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    try {
      const data = await jiraRequest('GET', `/project/${JIRA_PROJECT}/versions`);
      const versions = (data || []).map(v => ({
        id:       v.id,
        name:     v.name,
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
      logError('GET /api/jira/versions', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
