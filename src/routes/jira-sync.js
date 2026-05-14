// ── JIRA sync routes ──────────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, parseApiError, assertDocType, assertFilename } from '../utils/routeHelpers.js';
import { setFrontmatterField, extractFrontmatterField, stripFrontmatter, jiraToMarkdown } from '../utils/transforms.js';
import { JIRA_TO_LOCAL_TYPE } from '../services/jiraService.js';

export default function jiraSyncRoutes({
  TYPE_CONFIG, FIELD_EPIC_NAME, FIELD_EPIC_LINK, FIELD_STORY_POINTS, INBOX_DIR,
  JIRA_PROJECT,
  jiraRequest, jiraIssueToMarkdown, extractJiraSummary, findLocalFileByJiraId,
  broadcast, logInfo, logError, docIndex,
}) {
  const router = Router();

  function _appendDescriptionHistory(inboxPath, oldBody, newBody) {
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const note = `\n\n---\n\n## JIRA Description Update — ${ts}\n\n**Previous description:**\n${oldBody || '_empty_'}\n\n**New description from JIRA:**\n${newBody || '_empty_'}\n`;
    if (fs.existsSync(inboxPath)) {
      fs.appendFileSync(inboxPath, note);
    } else {
      fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
      fs.writeFileSync(inboxPath, note.trimStart());
    }
  }

  function _extractBodyText(content) {
    const body = stripFrontmatter(content);
    return body.replace(/^## .+\n?/m, '').trim();
  }

  // ── POST /api/jira/sync-status/:type/:filename ────────────────────────────
  router.post('/api/jira/sync-status/:type/:filename', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    try {
      const docType  = assertDocType(req.params.type, TYPE_CONFIG);
      const cfg      = TYPE_CONFIG[docType];
      const filename = assertFilename(req.params.filename);
      const filepath = path.join(cfg.dir(), filename);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      const content = fs.readFileSync(filepath, 'utf-8');
      const jiraId  = extractFrontmatterField(content, 'JIRA_ID');
      if (!jiraId || jiraId === 'TBD') return sendError(res, 400, 'NO_JIRA_ID', 'Document has no JIRA_ID');

      const issue      = await jiraRequest('GET', `/issue/${jiraId}?fields=status,${FIELD_STORY_POINTS},summary,description`);
      const jiraStatus = issue.fields?.status?.name || null;
      const jiraSp     = issue.fields?.[FIELD_STORY_POINTS] ?? null;
      const jiraSummary = (issue.fields?.summary || '').replace(/[\r\n]+/g, ' ').trim();
      const jiraDesc    = jiraToMarkdown(issue.fields?.description || '').trim();

      let updated = content;
      if (jiraStatus) updated = setFrontmatterField(updated, 'JIRA_Status', jiraStatus);
      if (jiraSp !== null) updated = setFrontmatterField(updated, 'Story_Points', String(jiraSp));

      // Update title heading if JIRA summary changed
      if (jiraSummary) {
        const existingTitle = (stripFrontmatter(content).match(/^## (.+)$/m) || [])[1] || '';
        if (jiraSummary !== existingTitle) {
          updated = updated.replace(/^## .+$/m, `## ${jiraSummary}`);
        }
      }

      // Detect description change and update body + write history
      const existingBodyText = _extractBodyText(content);
      if (jiraDesc && jiraDesc !== existingBodyText) {
        _appendDescriptionHistory(path.join(INBOX_DIR, filename), existingBodyText, jiraDesc);
        // Reconstruct everything up through the heading, then replace the body
        const match = updated.match(/^(---[\s\S]*?---\n+## [^\n]+\n)/);
        if (match) updated = match[1] + '\n' + jiraDesc + '\n';
      }

      fs.writeFileSync(filepath, updated);
      docIndex.invalidate(docType, filename);
      broadcast({ type: 'title_updated', filename, docType });

      logInfo('POST /api/jira/sync-status', `Synced status for ${jiraId}: ${jiraStatus}, SP: ${jiraSp}`);
      res.json({ success: true, jiraStatus, storyPoints: jiraSp });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/sync-status', apiErr.message, apiErr.details || {});
      sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME', 'NO_JIRA_ID'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/update-from-jira/:docType/:filename ────────────────────
  // Updates an existing local file with fresh data from JIRA.
  // Keeps Sprint, Squad, PI, Feature_ID, Epic_ID — overwrites JIRA-sourced fields.
  router.post('/api/jira/update-from-jira/:docType/:filename', async (req, res) => {
    try {
      if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const docType  = assertDocType(req.params.docType, TYPE_CONFIG);
      const filename = assertFilename(req.params.filename);
      const cfg      = TYPE_CONFIG[docType];
      const filepath = path.join(cfg.dir(), filename);

      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      const existing = fs.readFileSync(filepath, 'utf-8');
      const existingBodyText = _extractBodyText(existing);

      let jiraKey = (req.body?.jiraKey || '').trim().toUpperCase() || extractFrontmatterField(existing, 'JIRA_ID');
      if (!jiraKey || jiraKey === 'TBD') {
        return sendError(res, 400, 'VALIDATION_ERROR', 'No JIRA key provided and JIRA_ID in file is TBD');
      }

      // Fetch from JIRA
      const issue = await jiraRequest(
        'GET',
        `/issue/${jiraKey}?fields=summary,issuetype,status,priority,description,fixVersions,${FIELD_EPIC_NAME},${FIELD_STORY_POINTS}`
      );

      // Build fresh content from JIRA data
      const { content: freshContent } = jiraIssueToMarkdown(issue);

      // Detect description change before overwriting and write history
      const newBodyText = _extractBodyText(freshContent);
      if (newBodyText !== existingBodyText) {
        _appendDescriptionHistory(path.join(INBOX_DIR, filename), existingBodyText, newBodyText);
      }

      // Preserve local-only frontmatter fields
      const LOCAL_FIELDS = ['Sprint', 'Squad', 'PI', 'Feature_ID', 'Epic_ID', 'Created'];
      let merged = freshContent;
      for (const field of LOCAL_FIELDS) {
        const localVal = extractFrontmatterField(existing, field);
        if (localVal) merged = setFrontmatterField(merged, field, localVal);
      }

      fs.writeFileSync(filepath, merged);
      docIndex.invalidate(docType, filename);
      broadcast({ type: `${docType}_created`, filename, docType });

      logInfo(`Updated ${filename} from JIRA ${jiraKey}`);
      res.json({ key: jiraKey, filename, docType });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/update-from-jira', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── Shared helper: build preview item from a JIRA issue ──────
  function _buildPreviewItem(iss) {
    const existing = docIndex.findByJiraId(iss.key) || findLocalFileByJiraId(iss.key);
    const jiraTitle = (iss.fields?.summary || '').trim();
    const jiraSP    = iss.fields?.[FIELD_STORY_POINTS] ?? null;
    const jiraTypeName = iss.fields?.issuetype?.name || '';
    const localType = JIRA_TO_LOCAL_TYPE[jiraTypeName] || 'story';

    const item = {
      jiraKey: iss.key, jiraTitle, jiraType: jiraTypeName,
      localFilename: existing?.filename || null,
      localDocType:  existing?.docType  || localType,
      action: existing ? 'update' : 'create',
      changes: [],
    };

    if (existing) {
      try {
        const localContent = fs.readFileSync(path.join(TYPE_CONFIG[existing.docType].dir(), existing.filename), 'utf-8');
        const localTitle   = extractJiraSummary(localContent);
        const localSPRaw   = extractFrontmatterField(localContent, 'Story_Points');
        const localSP      = localSPRaw && localSPRaw !== 'TBD' ? Number(localSPRaw) : null;
        const localBody    = _extractBodyText(localContent);
        const jiraDesc     = jiraToMarkdown(iss.fields?.description || '').trim();

        if (jiraTitle !== localTitle)  item.changes.push({ field: 'title', from: localTitle, to: jiraTitle });
        if (jiraDesc  !== localBody)   item.changes.push({ field: 'description', changed: true });
        if (jiraSP    !== localSP)     item.changes.push({ field: 'storyPoints', from: localSP, to: jiraSP });
      } catch {
        item.changes.push({ field: 'description', changed: true });
      }
    } else {
      if (jiraTitle) item.changes.push({ field: 'title', to: jiraTitle });
      item.changes.push({ field: 'description', changed: true });
      if (jiraSP !== null) item.changes.push({ field: 'storyPoints', to: jiraSP });
    }
    return item;
  }

  // ── POST /api/jira/pull-preview ──────────────────────────────────────────────
  // Returns a field-level diff for the issue (and optionally its children) so the
  // client can show a confirmation popup before executing the actual pull/update.
  router.post('/api/jira/pull-preview', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const { jiraKey, includeChildren = false } = req.body;
      if (!jiraKey) return sendError(res, 400, 'VALIDATION_ERROR', 'jiraKey is required');

      const fields = `summary,issuetype,status,priority,description,fixVersions,issuelinks,subtasks,${FIELD_EPIC_NAME},${FIELD_EPIC_LINK},${FIELD_STORY_POINTS}`;
      const issue = await jiraRequest('GET', `/issue/${jiraKey}?fields=${fields}`);
      const items = [];

      items.push(_buildPreviewItem(issue));

      // ── Children ──────────────────────────────────────────────
      if (includeChildren) {
        const issueType = issue.fields?.issuetype?.name;
        const childIssues = [];
        const seen = new Set([jiraKey]);

        // Epics: children via Epic Link custom field
        if (issueType === 'Epic' && FIELD_EPIC_LINK) {
          const fieldId = FIELD_EPIC_LINK.replace('customfield_', '');
          const jql = `cf[${fieldId}] = ${jiraKey} AND project = ${JIRA_PROJECT} ORDER BY issuetype ASC`;
          const data = await jiraRequest('GET', `/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=${fields}`);
          for (const c of (data.issues || [])) { if (!seen.has(c.key)) { seen.add(c.key); childIssues.push(c); } }
        }

        // Issue links (inward = contained children)
        for (const link of (issue.fields?.issuelinks || [])) {
          const inw = link.inwardIssue;
          if (inw && !seen.has(inw.key)) {
            seen.add(inw.key);
            try {
              const full = await jiraRequest('GET', `/issue/${inw.key}?fields=${fields}`);
              childIssues.push(full);
            } catch { /* skip unreachable children */ }
          }
        }

        for (const child of childIssues) items.push(_buildPreviewItem(child));
      }

      res.json({ items });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/pull-preview', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/check-all ────────────────────────────────────────────────
  // Fetches JIRA state for all locally-linked issues and returns field-level diffs.
  router.post('/api/jira/check-all', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const allDocs = docIndex.getAll().filter(d => d.jiraId);
      if (allDocs.length === 0) return res.json({ items: [] });

      const fields = `summary,issuetype,status,description,${FIELD_STORY_POINTS}`;
      const items = [];

      for (const doc of allDocs) {
        try {
          const issue = await jiraRequest('GET', `/issue/${doc.jiraId}?fields=${fields}`);
          const preview = _buildPreviewItem(issue);
          // Include local filename/docType for the client to execute updates
          preview.filename = doc.filename;
          preview.docType  = doc.docType;
          // Only include items with actual changes
          if (preview.changes.length > 0) items.push(preview);
        } catch (e) {
          items.push({
            jiraKey: doc.jiraId, jiraTitle: doc.title,
            filename: doc.filename, docType: doc.docType,
            localDocType: doc.docType, action: 'update',
            changes: [{ field: 'error', message: e.message }],
          });
        }
      }

      logInfo('POST /api/jira/check-all', `Checked ${allDocs.length} issues, ${items.length} with changes`);
      res.json({ items, totalChecked: allDocs.length });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/check-all', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
