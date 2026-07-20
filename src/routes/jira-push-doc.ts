// ── JIRA push-doc routes ──────────────────────────────────────────────────────
// Handles POST /api/jira/push-preview and POST /api/jira/push/:type/:filename
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pMap } from '../utils/pMap.js';
import {
  sendError,
  handleRouteError,
  assertDocType,
  assertFilename,
} from '../utils/routeHelpers.js';
import { extractFrontmatterField } from '../utils/transforms.js';
import { parseStorySections } from '../services/storyService.js';
import { resolveParentJiraId, resolveEpicLink } from '../services/jiraService.js';
import { createJiraPushService } from '../services/jiraPushService.js';
import { TEAM_TO_JIRA_LABEL, ALL_TEAM_JIRA_LABELS } from '../config/metadata.js';
import { config } from '../config/env.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { JiraPushPreviewSchema } from '../schemas/jira.js';
import type { JiraRouteContext } from '../types.js';

export default function jiraPushDocRoutes(ctx: JiraRouteContext) {
  const {
    TYPE_CONFIG,
    EPICS_DIR,
    FEATURES_DIR,
    FIELD_EPIC_LINK,
    FIELD_STORY_POINTS,
    JIRA_BOARD_ID,
    jiraRequest,
    jiraAgileRequest,
    extractJiraSummary,
    logInfo,
    logError,
    logWarn,
  } = ctx;
  const router = Router();
  const { pushMultiStory, pushSingleIssue } = createJiraPushService(ctx);

  // ── POST /api/jira/push-preview ─────────────────────────────────────────────
  // Returns a field-level diff for each item so the client can show a confirmation popup.
  // Items with an existing JIRA ID are fetched in parallel (max JIRA_CONCURRENCY at once).
  router.post('/api/jira/push-preview', validateBody(JiraPushPreviewSchema), async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const { items = [] } = req.body;

      type PreviewItem = {
        filename: string;
        docType: string;
        content: string;
        jiraId: string;
        localTitle: string;
        spValue: number | null;
        localEpicJiraId: string | null;
        pendingEpicTitle: string | null;
        epicFilenameRef: string | null;
        pendingFeatureTitle: string | null;
        localTeamLabel: string | null;
        localSprint: string | null;
        autoIncluded?: boolean;
      };
      // Build local metadata for each item
      const localItemsRaw: (PreviewItem | null)[] = await Promise.all(
        items.map(async ({ filename, docType }: { filename: string; docType: string }) => {
          const cfg = TYPE_CONFIG[docType];
          if (!cfg) return null;
          const filepath = path.join(cfg.dir(), filename);
          if (!fs.existsSync(filepath)) return null;
          const content = await fs.promises.readFile(filepath, 'utf-8');
          const jiraId = extractFrontmatterField(content, 'JIRA_ID') || 'TBD';
          const localTitle = extractJiraSummary(content);
          const localSP = extractFrontmatterField(content, 'Story_Points');
          const spValue = localSP && localSP !== 'TBD' ? Number(localSP) : null;
          const localTeamFm = extractFrontmatterField(content, 'Team');
          const localTeamLabel =
            localTeamFm && localTeamFm !== 'TBD' ? (TEAM_TO_JIRA_LABEL[localTeamFm] ?? null) : null;
          // Resolve local Epic Link for stories/spikes/bugs
          let localEpicJiraId = null;
          let pendingEpicTitle = null;
          let epicFilenameRef = null;
          if (docType === 'story' || docType === 'spike' || docType === 'bug') {
            const { epicFilename, epicJiraId } = await resolveEpicLink(content, EPICS_DIR);
            if (epicFilename) {
              epicFilenameRef = epicFilename;
              if (epicJiraId) {
                localEpicJiraId = epicJiraId;
              } else {
                // Epic exists locally but not yet in JIRA — capture its title for preview
                const epicPath = path.join(EPICS_DIR, epicFilename);
                if (fs.existsSync(epicPath)) {
                  pendingEpicTitle = extractJiraSummary(
                    await fs.promises.readFile(epicPath, 'utf-8')
                  );
                }
              }
            }
          }
          // Resolve local Feature link for epics
          let pendingFeatureTitle = null;
          if (docType === 'epic') {
            const featureFilename = extractFrontmatterField(content, 'Feature_ID');
            if (featureFilename && featureFilename !== 'TBD') {
              const fid = await resolveParentJiraId(FEATURES_DIR, featureFilename);
              if (!fid) {
                const featurePath = path.join(FEATURES_DIR, featureFilename);
                if (fs.existsSync(featurePath)) {
                  pendingFeatureTitle = extractJiraSummary(
                    await fs.promises.readFile(featurePath, 'utf-8')
                  );
                }
              }
            }
          }
          const localSprint = extractFrontmatterField(content, 'Sprint');
          return {
            filename,
            docType,
            content,
            jiraId,
            localTitle,
            spValue,
            localEpicJiraId,
            pendingEpicTitle,
            epicFilenameRef,
            pendingFeatureTitle,
            localTeamLabel,
            localSprint,
          } as PreviewItem;
        })
      );
      const localItems: PreviewItem[] = localItemsRaw.filter((x): x is PreviewItem => x !== null);

      // Auto-include TBD epics referenced by stories but not already in the push scope
      const includedFilenames = new Set(localItems.map((i) => i.filename));
      const extraEpics: PreviewItem[] = [];
      for (const item of localItems) {
        if (
          item.pendingEpicTitle &&
          item.epicFilenameRef &&
          !includedFilenames.has(item.epicFilenameRef)
        ) {
          const epicPath = path.join(EPICS_DIR, item.epicFilenameRef);
          if (fs.existsSync(epicPath)) {
            const epicContent = await fs.promises.readFile(epicPath, 'utf-8');
            const epicTitle = extractJiraSummary(epicContent);
            const epicSP = extractFrontmatterField(epicContent, 'Story_Points');
            const epicSpValue = epicSP && epicSP !== 'TBD' ? Number(epicSP) : null;
            const epicTeamFm = extractFrontmatterField(epicContent, 'Team');
            const epicTeamLabel =
              epicTeamFm && epicTeamFm !== 'TBD' ? (TEAM_TO_JIRA_LABEL[epicTeamFm] ?? null) : null;
            const epicSprint = extractFrontmatterField(epicContent, 'Sprint');
            includedFilenames.add(item.epicFilenameRef);
            extraEpics.push({
              filename: item.epicFilenameRef,
              docType: 'epic',
              content: epicContent,
              jiraId: 'TBD',
              localTitle: epicTitle,
              spValue: epicSpValue,
              localEpicJiraId: null,
              pendingEpicTitle: null,
              epicFilenameRef: null,
              pendingFeatureTitle: null,
              localTeamLabel: epicTeamLabel,
              localSprint: epicSprint,
              autoIncluded: true,
            });
          }
        }
      }
      localItems.unshift(...extraEpics);

      // Fetch JIRA data for existing issues in parallel (capped at JIRA_CONCURRENCY)
      const previews = await pMap(
        localItems,
        async ({
          filename,
          docType,
          jiraId,
          localTitle,
          spValue,
          localEpicJiraId,
          pendingEpicTitle,
          pendingFeatureTitle,
          localTeamLabel,
          localSprint,
          autoIncluded,
        }) => {
          const changes: Record<string, unknown>[] = [];
          const preview = {
            filename,
            docType,
            title: localTitle,
            jiraId: jiraId !== 'TBD' ? jiraId : null,
            action: jiraId !== 'TBD' ? 'update' : 'create',
            changes,
            ...(autoIncluded ? { autoIncluded: true } : {}),
          };

          if (jiraId !== 'TBD') {
            try {
              const fetchFields =
                `summary,labels,${FIELD_STORY_POINTS}` +
                (FIELD_EPIC_LINK ? `,${FIELD_EPIC_LINK}` : '');
              const issue = (await jiraRequest(
                'GET',
                `/issue/${jiraId}?fields=${fetchFields}`
              )) as { fields?: Record<string, unknown> };
              const jiraSummary = String(issue.fields?.summary || '').trim();
              const jiraSP = issue.fields?.[FIELD_STORY_POINTS] ?? null;

              if (localTitle !== jiraSummary) {
                changes.push({ field: 'title', from: jiraSummary, to: localTitle });
              }
              changes.push({ field: 'description', changed: true });
              if (
                spValue !== null &&
                spValue !== jiraSP &&
                docType !== 'feature' &&
                docType !== 'epic'
              ) {
                changes.push({ field: 'storyPoints', from: jiraSP, to: spValue });
              }
              // Detect team label changes
              const jiraLabels = (issue.fields?.labels ?? []) as string[];
              const currentTeamLabel =
                jiraLabels.find((l: string) => ALL_TEAM_JIRA_LABELS.has(l)) ?? null;
              if (currentTeamLabel !== localTeamLabel) {
                changes.push({ field: 'teamLabel', from: currentTeamLabel, to: localTeamLabel });
              }
              // Detect Epic Link changes for stories/spikes/bugs
              if (docType === 'story' || docType === 'spike' || docType === 'bug') {
                const jiraEpicLink = issue.fields?.[FIELD_EPIC_LINK] || null;
                if ((localEpicJiraId || null) !== jiraEpicLink || pendingEpicTitle) {
                  const change: Record<string, unknown> = {
                    field: 'epicLink',
                    from: jiraEpicLink,
                    to: localEpicJiraId,
                  };
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
                  const agileIssue = (await jiraAgileRequest(
                    'GET',
                    `/issue/${jiraId}?fields=sprint`
                  )) as { fields?: { sprint?: { name?: string } } };
                  const jiraSprintName = agileIssue?.fields?.sprint?.name || null;
                  if (localSprint !== jiraSprintName) {
                    changes.push({ field: 'sprint', from: jiraSprintName, to: localSprint });
                  }
                } catch (err) {
                  logWarn('jira/push', `sprint preview lookup failed for ${jiraId}`, {
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            } catch (e) {
              changes.push({ field: 'error', message: e instanceof Error ? e.message : String(e) });
            }
          } else {
            if (localTitle) changes.push({ field: 'title', to: localTitle });
            changes.push({ field: 'description', changed: true });
            if (spValue !== null && docType !== 'feature' && docType !== 'epic')
              changes.push({ field: 'storyPoints', to: spValue });
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
        },
        { concurrency: config.JIRA_CONCURRENCY }
      );

      res.json({ items: previews });
    } catch (err) {
      handleRouteError(res, err, { scope: 'POST /api/jira/push-preview', logError });
    }
  });

  // ── POST /api/jira/push/:type/:filename ────────────────────────────────────
  router.post('/api/jira/push/:type/:filename', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    const docType = assertDocType(req.params.type, TYPE_CONFIG);
    const cfg = TYPE_CONFIG[docType];
    const type = docType;
    const filename = assertFilename(req.params.filename);
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    try {
      const t = Date.now();
      const content = await fs.promises.readFile(filepath, 'utf-8');
      const { frontmatter, sections } = parseStorySections(content);

      const isMultiStory =
        type === 'story' && sections.length > 0 && /^## Story \d+/m.test(sections[0]);

      if (isMultiStory) {
        const result = await pushMultiStory({ filename, filepath, sections, frontmatter, type });
        logInfo(
          'jira/push',
          `Pushed multi-story ${filename}: ${result.results?.length ?? 0} stories in ${Date.now() - t}ms`
        );
        return res.json(result);
      }

      const result = await pushSingleIssue({ filename, filepath, content, type });
      logInfo(
        'jira/push',
        `${result.action === 'created' ? 'Created' : 'Updated'} ${result.key} (${type}/${filename}) in ${Date.now() - t}ms`
      );
      res.json(result);
    } catch (err) {
      handleRouteError(res, err, { scope: 'POST /api/jira/push/:type/:filename', logError });
    }
  });

  return router;
}
