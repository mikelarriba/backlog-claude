// ── JIRA sync routes ──────────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  sendError,
  parseApiError,
  handleRouteError,
  assertDocType,
  assertFilename,
} from '../utils/routeHelpers.js';
import { pMap } from '../utils/pMap.js';
import {
  setFrontmatterField,
  extractFrontmatterField,
  jiraToMarkdown,
  stripFrontmatter,
} from '../utils/transforms.js';
import {
  appendDescriptionHistory,
  extractBodyText,
  buildPreviewItem,
} from '../services/jiraService.js';
import type { JiraPreviewIssue } from '../services/jiraService.js';
import { logAudit } from '../utils/auditLog.js';
import { JIRA_LABEL_TO_TEAM, ALL_TEAM_JIRA_LABELS } from '../config/metadata.js';
import { findExistingByJiraId } from '../utils/docHelpers.js';
import type { JiraRouteContext } from '../types.js';

export default function jiraSyncRoutes({
  TYPE_CONFIG,
  FIELD_EPIC_NAME,
  FIELD_EPIC_LINK,
  FIELD_STORY_POINTS,
  INBOX_DIR,
  JIRA_PROJECT,
  jiraRequest,
  jiraIssueToMarkdown,
  extractJiraSummary,
  findLocalFileByJiraId,
  broadcast,
  logInfo,
  logWarn,
  logError,
  docIndex,
}: JiraRouteContext) {
  const router = Router();

  // Bound helper — threads context dependencies into the shared utility.
  const _findExistingByJiraId = (jiraId: string) =>
    findExistingByJiraId(
      jiraId,
      (id) => docIndex.findByJiraId(id),
      findLocalFileByJiraId,
      logWarn,
      'jira/sync'
    );

  const previewCtx = {
    TYPE_CONFIG,
    FIELD_STORY_POINTS,
    docIndex,
    findExistingByJiraIdFn: _findExistingByJiraId,
    extractJiraSummaryFn: extractJiraSummary,
    logWarn,
  };

  // ── POST /api/jira/sync-status/:type/:filename ────────────────────────────
  router.post('/api/jira/sync-status/:type/:filename', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    try {
      const docType = assertDocType(req.params.type, TYPE_CONFIG);
      const cfg = TYPE_CONFIG[docType];
      const filename = assertFilename(req.params.filename);
      const filepath = path.join(cfg.dir(), filename);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      const content = await fs.promises.readFile(filepath, 'utf-8');
      const jiraId = extractFrontmatterField(content, 'JIRA_ID');
      if (!jiraId || jiraId === 'TBD')
        return sendError(res, 400, 'NO_JIRA_ID', 'Document has no JIRA_ID');

      type JiraSyncIssue = {
        fields?: Record<string, unknown> & {
          status?: { name?: string };
          labels?: string[];
          summary?: string;
          description?: string;
        };
      };
      const issue = (await jiraRequest(
        'GET',
        `/issue/${jiraId}?fields=status,labels,${FIELD_STORY_POINTS},summary,description`
      )) as JiraSyncIssue;
      const jiraStatus = issue.fields?.status?.name || null;
      const jiraSp = issue.fields?.[FIELD_STORY_POINTS] ?? null;
      const jiraSummary = String(issue.fields?.summary || '')
        .replace(/[\r\n]+/g, ' ')
        .trim();
      const jiraDesc = jiraToMarkdown(String(issue.fields?.description || '')).trim();

      const issueLabels = (issue.fields?.labels ?? []) as string[];
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
        appendDescriptionHistory(path.join(INBOX_DIR, filename), existingBodyText, jiraDesc);
        const match = updated.match(/^(---[\s\S]*?---\n+## [^\n]+\n)/);
        if (match) {
          const commentsMatch = updated.match(/\n## Comments\b[\s\S]*$/);
          const commentsSection = commentsMatch ? commentsMatch[0] : '';
          updated = match[1] + '\n' + jiraDesc + '\n' + commentsSection;
        }
      }

      await fs.promises.writeFile(filepath, updated);
      await docIndex.invalidate(docType, filename);
      broadcast({ type: 'title_updated', filename, docType });

      logAudit({
        op: 'jira-sync',
        docType,
        filename,
        fields: { jiraStatus, storyPoints: jiraSp },
        source: 'jira-sync',
      });
      logInfo(
        'POST /api/jira/sync-status',
        `Synced status for ${jiraId}: ${jiraStatus}, SP: ${jiraSp}`
      );
      res.json({ success: true, jiraStatus, storyPoints: jiraSp });
    } catch (err) {
      handleRouteError(res, err, { scope: 'POST /api/jira/sync-status', logError });
    }
  });

  // ── POST /api/jira/update-from-jira/:docType/:filename ────────────────────
  router.post('/api/jira/update-from-jira/:docType/:filename', async (req, res) => {
    try {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const docType = assertDocType(req.params.docType, TYPE_CONFIG);
      const filename = assertFilename(req.params.filename);
      const cfg = TYPE_CONFIG[docType];
      const filepath = path.join(cfg.dir(), filename);

      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      const existing = await fs.promises.readFile(filepath, 'utf-8');
      const existingBodyText = extractBodyText(existing);

      const jiraKey =
        (req.body?.jiraKey || '').trim().toUpperCase() ||
        extractFrontmatterField(existing, 'JIRA_ID');
      if (!jiraKey || jiraKey === 'TBD') {
        return sendError(
          res,
          400,
          'VALIDATION_ERROR',
          'No JIRA key provided and JIRA_ID in file is TBD'
        );
      }

      const issue = await jiraRequest(
        'GET',
        `/issue/${jiraKey}?fields=summary,issuetype,status,priority,description,fixVersions,labels,${FIELD_EPIC_NAME},${FIELD_STORY_POINTS}`
      );

      const { content: freshContent } = jiraIssueToMarkdown(issue);

      const newBodyText = extractBodyText(freshContent);
      if (newBodyText !== existingBodyText) {
        appendDescriptionHistory(path.join(INBOX_DIR, filename), existingBodyText, newBodyText);
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

      await fs.promises.writeFile(filepath, merged);
      await docIndex.invalidate(docType, filename);
      broadcast({ type: `${docType}_created`, filename, docType });

      logAudit({ op: 'jira-sync', docType, filename, fields: { jiraKey }, source: 'jira-sync' });
      logInfo('POST /api/jira/update-from-jira', `Updated ${filename} from JIRA ${jiraKey}`);
      res.json({ key: jiraKey, filename, docType });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/jira/update-from-jira',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/pull-preview ──────────────────────────────────────────────
  router.post('/api/jira/pull-preview', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const { jiraKey, includeChildren = false } = req.body;
      if (!jiraKey) return sendError(res, 400, 'VALIDATION_ERROR', 'jiraKey is required');

      const fields = `summary,issuetype,status,priority,description,fixVersions,issuelinks,subtasks,${FIELD_EPIC_NAME},${FIELD_EPIC_LINK},${FIELD_STORY_POINTS}`;
      const issue = (await jiraRequest(
        'GET',
        `/issue/${jiraKey}?fields=${fields}`
      )) as JiraPreviewIssue;
      const items = [];

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

        for (const link of issue.fields?.issuelinks || []) {
          const inw = link.inwardIssue;
          if (inw && !seen.has(inw.key)) {
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
          }
        }

        for (const child of childIssues) items.push(await buildPreviewItem(child, previewCtx));

        const parentEntry = docIndex.findByJiraId(jiraKey);
        if (parentEntry) {
          const localChildren = docIndex
            .getAll()
            .filter(
              (e) => e.parentFilename === parentEntry.filename && e.jiraId && e.jiraId !== 'TBD'
            );

          const jiraChildKeys = new Set(childIssues.map((c) => c.key));

          for (const local of localChildren) {
            if (jiraChildKeys.has(local.jiraId!) || seen.has(local.jiraId!)) continue;
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
          }
        }
      }

      res.json({ items });
    } catch (err) {
      handleRouteError(res, err, { scope: 'POST /api/jira/pull-preview', logError });
    }
  });

  // ── POST /api/jira/check-all ────────────────────────────────────────────────
  router.post('/api/jira/check-all', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const linkedDocs = [];
      for (const [docType, cfg] of Object.entries(TYPE_CONFIG)) {
        const dir = cfg.dir();
        if (!fs.existsSync(dir)) continue;
        for (const filename of (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.md'))) {
          try {
            const content = await fs.promises.readFile(path.join(dir, filename), 'utf-8');
            const jiraId = extractFrontmatterField(content, 'JIRA_ID');
            if (!jiraId || jiraId === 'TBD') continue;
            linkedDocs.push({ filename, docType, jiraId });
          } catch (err) {
            logWarn('jira/sync', `skipping unreadable file ${filename}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      if (linkedDocs.length === 0)
        return res.json({ changed: [], skipped: [], errors: [], total: 0 });

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
                  ...(summaryChanged
                    ? [{ field: 'title', from: localTitle, to: jiraSummary }]
                    : []),
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

      logInfo(
        'POST /api/jira/check-all',
        `Checked ${linkedDocs.length}: ${changed.length} changed, ${skipped.length} unchanged, ${errors.length} errors`
      );
      res.json({ changed, skipped, errors, total: linkedDocs.length });
    } catch (err) {
      handleRouteError(res, err, { scope: 'POST /api/jira/check-all', logError });
    }
  });

  return router;
}
