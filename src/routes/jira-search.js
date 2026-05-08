// ── JIRA search & pull routes ─────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, ensureDir, parseApiError, assertFilename, normalizeType } from '../utils/routeHelpers.js';
import { isoDate, slugify, setFrontmatterField } from '../utils/transforms.js';
import { LOCAL_TO_JIRA_TYPE } from '../services/jiraService.js';

export default function jiraSearchRoutes({
  TYPE_CONFIG, JIRA_PROJECT, JIRA_LABEL, FIELD_EPIC_NAME, FIELD_EPIC_LINK, FIELD_STORY_POINTS,
  jiraRequest, findLocalFileByJiraId, jiraIssueToMarkdown,
  broadcast, logError, docIndex,
}) {
  const router = Router();

  // ── GET /api/jira/search ───────────────────────────────────────────────────
  router.get('/api/jira/search', async (req, res) => {
    try {
      if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const { type = 'all', text = '' } = req.query;
      if (type !== 'all' && !TYPE_CONFIG[normalizeType(type)]) {
        return sendError(res, 400, 'INVALID_TYPE', 'Invalid JIRA filter type', { allowed: ['all', ...Object.keys(TYPE_CONFIG)], received: type });
      }

      const typeClause = type === 'all'
        ? `issuetype in ("New Feature", Epic, Story, Improvement, Task, Bug)`
        : type === 'story'
          ? `issuetype in ("Story", "Improvement")`
          : `issuetype = "${LOCAL_TO_JIRA_TYPE[type] || 'Epic'}"`;

      const textClause = text.trim() ? ` AND text ~ "${text.trim().replace(/"/g, '')}"` : '';
      const jql = `project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} AND statusCategory != Done AND ${typeClause}${textClause} ORDER BY updated DESC`;
      const fields = `summary,issuetype,status,priority,fixVersions,${FIELD_EPIC_NAME},description`;
      const data = await jiraRequest('GET', `/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=${fields}`);

      const issues = (data.issues || []).map(issue => {
        const existing = docIndex.findByJiraId(issue.key) || findLocalFileByJiraId(issue.key);
        return {
          key:           issue.key,
          summary:       issue.fields.summary || '',
          epicName:      issue.fields[FIELD_EPIC_NAME] || '',
          issuetype:     issue.fields.issuetype?.name || '',
          status:        issue.fields.status?.name || '',
          priority:      issue.fields.priority?.name || '',
          localExists:   !!existing,
          localFilename: existing?.filename || null,
          localDocType:  existing?.docType  || null,
        };
      });

      res.json({ issues, total: data.total });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('GET /api/jira/search', apiErr.message, apiErr.details || {});
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

  // ── GET /api/jira/children/:key ─────────────────────────────────────────────
  router.get('/api/jira/children/:key', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const key = req.params.key;
      const issue = await jiraRequest('GET', `/issue/${key}?fields=issuetype,issuelinks,subtasks`);
      const issueType = issue.fields.issuetype?.name;
      const children = [];
      const seen = new Set();

      function addChild(child) {
        if (seen.has(child.key)) return;
        seen.add(child.key);
        const existing = docIndex.findByJiraId(child.key) || findLocalFileByJiraId(child.key);
        children.push({
          key:           child.key,
          summary:       child.fields?.summary || '',
          issuetype:     child.fields?.issuetype?.name || '',
          status:        child.fields?.status?.name || '',
          localExists:   !!existing,
          localFilename: existing?.filename || null,
          localDocType:  existing?.docType  || null,
        });
      }

      // Epics: find children via Epic Link custom field
      if (issueType === 'Epic') {
        const fieldId = FIELD_EPIC_LINK.replace('customfield_', '');
        const jql = `cf[${fieldId}] = ${key} AND project = ${JIRA_PROJECT} ORDER BY issuetype ASC`;
        const data = await jiraRequest('GET', `/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,issuetype,status,priority`);
        for (const child of (data.issues || [])) addChild(child);
      }

      // New Features / Epics: check issue links (inward = contained children)
      for (const link of (issue.fields.issuelinks || [])) {
        if (link.inwardIssue) addChild(link.inwardIssue);
      }

      // Subtasks
      for (const st of (issue.fields.subtasks || [])) addChild(st);

      res.json({ parentKey: key, parentType: issueType, children });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('GET /api/jira/children/:key', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/pull ────────────────────────────────────────────────────
  router.post('/api/jira/pull', async (req, res) => {
    try {
      const { keys = [], overwriteKeys = [], parentLink = null } = req.body;
      if (!Array.isArray(keys)) return sendError(res, 400, 'VALIDATION_ERROR', 'keys must be an array');
      if (!keys.length) return sendError(res, 400, 'VALIDATION_ERROR', 'No keys provided');

      if (parentLink !== null && parentLink !== undefined) {
        if (parentLink.docType !== 'epic' && parentLink.docType !== 'feature') {
          return sendError(res, 400, 'VALIDATION_ERROR', "parentLink.docType must be 'epic' or 'feature'");
        }
        assertFilename(parentLink.filename);
      }

      if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      // Determine which frontmatter field links a child to its parent
      const parentFieldName = parentLink?.docType === 'epic'    ? 'Epic_ID'
                            : parentLink?.docType === 'feature' ? 'Feature_ID'
                            : null;

      const pulled    = [];
      const conflicts = [];

      for (const key of keys) {
        const existing = docIndex.findByJiraId(key) || findLocalFileByJiraId(key);
        if (existing && !overwriteKeys.includes(key)) {
          conflicts.push({ key, existingFilename: existing.filename, existingDocType: existing.docType });
          continue;
        }

        const issue = await jiraRequest('GET', `/issue/${key}?fields=summary,issuetype,status,priority,description,fixVersions,${FIELD_EPIC_NAME},${FIELD_STORY_POINTS}`);
        let { docType, content } = jiraIssueToMarkdown(issue);

        let filename;
        if (existing && overwriteKeys.includes(key)) {
          filename = existing.filename;
        } else {
          const slug = slugify(issue.fields.summary || key);
          filename = `${isoDate()}-${slug}.md`;
        }

        // Link child to local parent file so the "└" hierarchy renders correctly
        if (parentFieldName && parentLink.filename) {
          content = setFrontmatterField(content, parentFieldName, parentLink.filename);
        }

        const destDir = TYPE_CONFIG[docType].dir();
        ensureDir(destDir);
        fs.writeFileSync(path.join(destDir, filename), content);
        docIndex.invalidate(docType, filename);

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

  return router;
}
