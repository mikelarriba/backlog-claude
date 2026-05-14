// ── JIRA sync routes ──────────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, parseApiError, assertDocType, assertFilename } from '../utils/routeHelpers.js';
import { setFrontmatterField, extractFrontmatterField, stripFrontmatter, jiraToMarkdown } from '../utils/transforms.js';

export default function jiraSyncRoutes({
  TYPE_CONFIG, FIELD_EPIC_NAME, FIELD_STORY_POINTS, INBOX_DIR,
  jiraRequest, jiraIssueToMarkdown,
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

  // ── POST /api/jira/check-all ─────────────────────────────────────────────
  // Compares every locally-stored JIRA-linked doc against live JIRA data and
  // returns the subset where summary, status, story-points, or description differ.
  router.post('/api/jira/check-all', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    try {
      // Scan filesystem directly so recently-written files are always included.
      const linked = _scanLinkedDocs();
      const fields = `summary,issuetype,status,description,${FIELD_STORY_POINTS}`;

      const changed  = [];
      const skipped  = [];
      const errors   = [];

      await Promise.allSettled(linked.map(async (entry) => {
        try {
          const issue = await jiraRequest('GET', `/issue/${entry.jiraId}?fields=${fields}`);
          const item  = _buildPreviewItem(entry, issue);
          if (item.hasChanges) changed.push(item);
          else skipped.push(entry.jiraId);
        } catch (e) {
          errors.push({ jiraId: entry.jiraId, filename: entry.filename, error: e.message });
        }
      }));

      logInfo('POST /api/jira/check-all', `Checked ${linked.length} items: ${changed.length} changed, ${skipped.length} unchanged, ${errors.length} errors`);
      res.json({ changed, skipped, errors, total: linked.length });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/jira/check-all', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  function _scanLinkedDocs() {
    const results = [];
    for (const [docType, cfg] of Object.entries(TYPE_CONFIG)) {
      const dir = cfg.dir();
      if (!fs.existsSync(dir)) continue;
      for (const filename of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        try {
          const content = fs.readFileSync(path.join(dir, filename), 'utf-8');
          const jiraId  = extractFrontmatterField(content, 'JIRA_ID');
          if (!jiraId || jiraId === 'TBD') continue;
          const title  = (content.match(/^## (.+)$/m) || [])[1] || filename;
          const status = (content.match(/^Status:\s*(.+)$/m) || [])[1]?.trim() || null;
          const spRaw  = extractFrontmatterField(content, 'Story_Points');
          results.push({
            filename, docType, jiraId, title,
            status,
            storyPoints: spRaw && spRaw !== 'TBD' ? Number(spRaw) || null : null,
          });
        } catch { /* skip unreadable files */ }
      }
    }
    return results;
  }

  function _buildPreviewItem(entry, issue) {
    const jiraSummary = (issue.fields?.summary || '').replace(/[\r\n]+/g, ' ').trim();
    const jiraStatus  = issue.fields?.status?.name || null;
    const jiraSp      = issue.fields?.[FIELD_STORY_POINTS] ?? null;
    const jiraDesc    = jiraToMarkdown(issue.fields?.description || '').trim();

    const localSummary = entry.title || '';
    const localStatus  = entry.status || null;
    const localSp      = entry.storyPoints ?? null;

    // Read local description body for comparison
    let localDesc = '';
    try {
      const cfg  = TYPE_CONFIG[entry.docType];
      const raw  = fs.readFileSync(path.join(cfg.dir(), entry.filename), 'utf-8');
      localDesc  = _extractBodyText(raw);
    } catch { /* file unreadable — treat as empty */ }

    const summaryChanged = jiraSummary && jiraSummary !== localSummary;
    const statusChanged  = jiraStatus  && jiraStatus  !== localStatus;
    const spChanged      = jiraSp !== null && jiraSp !== localSp;
    const descChanged    = jiraDesc !== localDesc;

    return {
      jiraId:   entry.jiraId,
      filename: entry.filename,
      docType:  entry.docType,
      title:    localSummary,
      hasChanges: summaryChanged || statusChanged || spChanged || descChanged,
      changes: {
        summary:     summaryChanged ? { local: localSummary, jira: jiraSummary } : null,
        status:      statusChanged  ? { local: localStatus,  jira: jiraStatus  } : null,
        storyPoints: spChanged      ? { local: localSp,      jira: jiraSp      } : null,
        description: descChanged    ? { changed: true }                           : null,
      },
    };
  }

  return router;
}
