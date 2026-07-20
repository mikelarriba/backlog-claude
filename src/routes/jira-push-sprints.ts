// ── JIRA push-sprints routes ──────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pMap } from '../utils/pMap.js';
import { sendError, parseApiError, setupSSE, ensureDir } from '../utils/routeHelpers.js';
import { setFrontmatterField, isoDate, slugify } from '../utils/transforms.js';
import { ensureSprintCache } from '../services/jiraService.js';
import {
  buildSprintNameMap,
  buildSprintPushPreview,
  fetchSprintIssuesOnBoard,
  fetchUnimportedSprintIssues,
} from '../services/jiraSprintService.js';
import { JIRA_LABEL_TO_TEAM } from '../config/metadata.js';
import { config } from '../config/env.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { JiraPushSprintsPreviewSchema, JiraPushSprintsSchema } from '../schemas/jira.js';
import type { JiraRouteContext } from '../types.js';

export default function jiraPushSprintsRoutes({
  TYPE_CONFIG,
  JIRA_BOARD_ID,
  FIELD_STORY_POINTS,
  jiraRequest,
  jiraAgileRequest,
  jiraIssueToMarkdown,
  broadcast,
  logInfo,
  logWarn,
  logError,
  docIndex,
}: JiraRouteContext) {
  const router = Router();

  // ── POST /api/jira/push-sprints-preview ── compare local vs JIRA sprint state (SSE) ─
  router.post(
    '/api/jira/push-sprints-preview',
    validateBody(JiraPushSprintsPreviewSchema),
    async (req, res) => {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
      if (!JIRA_BOARD_ID) return sendError(res, 400, 'NO_BOARD', 'JIRA_BOARD_ID not configured');

      setupSSE(res);
      const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

      try {
        const { items = [], selectedSprints = [] } = req.body as {
          items: Array<{
            filename: string;
            sprint: string | null;
            jiraId: string;
            title: string;
            docType: string;
          }>;
          selectedSprints: string[];
        };

        send({ type: 'progress', message: 'Loading sprint data from JIRA board…' });
        const sprintMap = await ensureSprintCache(jiraAgileRequest, JIRA_BOARD_ID);

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
          send({
            type: 'error',
            message: `No matching JIRA sprints found. Local names: ${selectedSprints.join(', ')}. JIRA names on board: ${jiraNames}…`,
          });
          res.end();
          return;
        }

        // Filter items to those whose local sprint maps to a selected JIRA sprint (or have no sprint)
        const filteredItems = items.filter((i) => {
          if (!i.sprint || i.sprint === 'TBD') return true;
          return localToJira.has(i.sprint);
        });

        // ── Step 1: Scan selected sprints from the board (parallel, capped at JIRA_CONCURRENCY) ──
        const sprintEntries = [...activeSprintMap.entries()];
        const totalSteps = sprintEntries.length;
        send({
          type: 'progress',
          message: `Scanning ${totalSteps} sprint(s) on JIRA board…`,
          phase: 1,
          total: totalSteps,
        });

        const boardScanResults = await pMap(
          sprintEntries,
          async ([sprintName, sprintId], idx) => {
            const localName = jiraToLocal.get(sprintName) || sprintName;
            send({
              type: 'progress',
              message: `Scanning "${localName}" (${idx + 1}/${totalSteps})…`,
              phase: 1,
              current: idx + 1,
              total: totalSteps,
            });
            try {
              const issues = await fetchSprintIssuesOnBoard(
                jiraAgileRequest,
                JIRA_BOARD_ID,
                sprintId
              );
              return { sprintName, sprintId, issues };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logWarn('jira/push', `board scan for "${sprintName}" failed`, { error: msg });
              send({
                type: 'progress',
                message: `Warning: could not scan "${localName}" — ${msg}`,
              });
              return {
                sprintName,
                sprintId,
                issues: [] as Array<{ key: string; summary: string }>,
              };
            }
          },
          { concurrency: config.JIRA_CONCURRENCY }
        );

        // Map: jiraId → { sprintName (JIRA), sprintId, summary }
        // Merged sequentially (in original sprint order) so the "first sprint wins"
        // tie-break for a duplicate issue key matches the old sequential behavior.
        const jiraSprintMap = new Map<
          string,
          { sprintName: string; sprintId: number; summary: string }
        >();
        for (const { sprintName, sprintId, issues } of boardScanResults) {
          for (const iss of issues) {
            if (!jiraSprintMap.has(iss.key)) {
              jiraSprintMap.set(iss.key, { sprintName, sprintId, summary: iss.summary });
            }
          }
        }

        // ── Step 2 & 3: Compare local items vs. the JIRA sprint map, and detect
        // JIRA-only issues not in the local set (pure diff logic — see service). ──
        send({
          type: 'progress',
          message: `Comparing ${filteredItems.length} local items…`,
          phase: 2,
          current: totalSteps,
          total: totalSteps,
        });

        const { changes, errors, stats } = buildSprintPushPreview({
          filteredItems,
          jiraSprintMap,
          sprintMap,
          localToJira,
          jiraToLocal,
          findByJiraId: (jiraId) => docIndex.findByJiraId(jiraId),
          getLocalEntry: (filename) => docIndex.get(filename),
        });

        logInfo(
          'POST /api/jira/push-sprints-preview',
          `${stats.adds} add, ${stats.changes} change, ${stats.pulls} pull, ${stats.unchanged} unchanged, ${errors.length} errors`
        );
        send({ type: 'result', changes, errors, stats });
        res.end();
      } catch (err) {
        const apiErr = parseApiError(err);
        logError(
          'POST /api/jira/push-sprints-preview',
          apiErr.message,
          apiErr.details as Record<string, unknown> | undefined
        );
        send({ type: 'error', message: apiErr.message });
        res.end();
      }
    }
  );

  // ── POST /api/jira/push-sprints ── push/pull sprint assignments ─────────────
  router.post('/api/jira/push-sprints', validateBody(JiraPushSprintsSchema), async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    if (!JIRA_BOARD_ID) return sendError(res, 400, 'NO_BOARD', 'JIRA_BOARD_ID not configured');

    try {
      const { items = [] } = req.body;
      const sprintMap = await ensureSprintCache(jiraAgileRequest, JIRA_BOARD_ID);

      // Resolve local sprint name to JIRA sprint ID (with fuzzy matching)
      const resolveId = (name: string): number | null => {
        const exact = sprintMap.get(name);
        if (exact != null) return exact;
        for (const [jiraName, id] of sprintMap) {
          if (jiraName.endsWith(name) || name.endsWith(jiraName)) return id;
        }
        return null;
      };

      const touchedFilenames: string[] = [];
      const results = await pMap(
        items as Array<{
          filename: string;
          sprint: string | null;
          changeType: string;
          jiraId?: string;
          docType?: string;
        }>,
        async (item) => {
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
              touchedFilenames.push(filename);
              broadcast({ type: 'batch_sprint_updated' });
              logInfo(
                'jira/push-sprints',
                `Pulled sprint "${sprint}" from JIRA for ${jiraId} → ${filename}`
              );
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
            if (!sprintId)
              return {
                filename,
                status: 'skipped',
                reason: `sprint "${sprint}" not found on board`,
              };
            await jiraAgileRequest('POST', `/sprint/${sprintId}/issue`, { issues: [jiraId] });
            logInfo('jira/push-sprints', `Assigned ${jiraId} to sprint "${sprint}"`);
            return { filename, status: 'ok', jiraId, sprint };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logWarn('jira/push-sprints', `Failed sprint op for ${jiraId}: ${msg}`);
            return { filename, status: 'error', error: msg };
          }
        },
        { concurrency: config.JIRA_CONCURRENCY }
      );

      if (touchedFilenames.length) await docIndex.invalidateMany(touchedFilenames);

      res.json({ results });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/jira/push-sprints',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/jira/pull-sprint-preview ── scan JIRA sprints for issues not in local app (SSE) ──
  router.post('/api/jira/pull-sprint-preview', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');
    if (!JIRA_BOARD_ID) return sendError(res, 400, 'NO_BOARD', 'JIRA_BOARD_ID not configured');

    setupSSE(res);
    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      const { selectedSprints = [] } = req.body as { selectedSprints: string[] };

      send({ type: 'progress', message: 'Loading sprint data from JIRA board…' });
      const sprintMap = await ensureSprintCache(jiraAgileRequest, JIRA_BOARD_ID);

      // Build sprint name mapping
      const { localToJira } = buildSprintNameMap(selectedSprints, sprintMap);
      const activeSprintMap = new Map<string, number>();
      for (const localName of selectedSprints) {
        const jiraName = localToJira.get(localName);
        if (jiraName) activeSprintMap.set(jiraName, sprintMap.get(jiraName)!);
      }

      if (!activeSprintMap.size) {
        send({
          type: 'error',
          message: `No matching JIRA sprints found for: ${selectedSprints.join(', ')}`,
        });
        res.end();
        return;
      }

      const sprintEntries = [...activeSprintMap.entries()];

      // Scan each selected sprint in parallel (capped at JIRA_CONCURRENCY), then
      // flatten in original sprint order so results match the old sequential loop.
      const perSprintResults = await pMap(
        sprintEntries,
        async ([jiraSprintName, sprintId], i) => {
          send({
            type: 'progress',
            message: `Scanning ${jiraSprintName}…`,
            current: i + 1,
            total: sprintEntries.length,
          });
          return fetchUnimportedSprintIssues(
            jiraAgileRequest,
            sprintId,
            jiraSprintName,
            FIELD_STORY_POINTS,
            (jiraId) => docIndex.findByJiraId(jiraId)
          );
        },
        { concurrency: config.JIRA_CONCURRENCY }
      );

      const results = perSprintResults.flat();

      send({ type: 'done', results });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/jira/pull-sprint-preview',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      send({ type: 'error', message: apiErr.message });
      res.end();
    }
  });

  // ── POST /api/jira/pull-sprint ── import selected JIRA issues as local docs ──
  router.post('/api/jira/pull-sprint', async (req, res) => {
    if (!process.env.JIRA_API_TOKEN)
      return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    try {
      const { issues = [] } = req.body as { issues: Array<{ key: string; sprintName: string }> };

      // Load PI settings for sprint→PI mapping
      const piSettingsPath = path.join(
        path.dirname(TYPE_CONFIG.story.dir()),
        '..',
        '.pi-settings.json'
      );
      let piSettings: Record<string, unknown> = {};
      try {
        piSettings = JSON.parse(await fs.promises.readFile(piSettingsPath, 'utf-8'));
      } catch {
        // Optional file — best-effort read; sprint→PI mapping is simply skipped if missing/corrupt.
      }
      const sprintConfig = (piSettings.sprints || {}) as Record<string, Array<{ name: string }>>;
      const sprintToPi = new Map<string, string>();
      for (const [pi, sprints] of Object.entries(sprintConfig)) {
        for (const s of sprints) sprintToPi.set(s.name, pi);
      }

      const results = await pMap(
        issues,
        async ({ key, sprintName }) => {
          try {
            const issue = await jiraRequest('GET', `/issue/${key}?expand=renderedFields`);
            const { docType, content } = jiraIssueToMarkdown(issue);
            let finalContent = content;

            // Set Sprint field
            const localSprint = sprintName;
            finalContent = setFrontmatterField(finalContent, 'Sprint', localSprint);

            // Set Fix_Version from sprint→PI mapping
            const pi = sprintToPi.get(localSprint);
            if (pi) finalContent = setFrontmatterField(finalContent, 'Fix_Version', pi);

            // Set Team from JIRA labels
            const issueFields = (issue as { fields?: Record<string, unknown> }).fields ?? {};
            const labels: string[] = (issueFields.labels as string[]) || [];
            const teamLabel = labels.find((l: string) => JIRA_LABEL_TO_TEAM[l]);
            if (teamLabel)
              finalContent = setFrontmatterField(
                finalContent,
                'Team',
                JIRA_LABEL_TO_TEAM[teamLabel]
              );

            // Write file
            const dir =
              TYPE_CONFIG[docType as keyof typeof TYPE_CONFIG]?.dir() || TYPE_CONFIG.story.dir();
            ensureDir(dir);
            const slug = slugify(String(issueFields.summary || key));
            const filename = `${isoDate()}-${slug}.md`;
            const filePath = path.join(dir, filename);
            await fs.promises.writeFile(filePath, finalContent);

            logInfo('jira/pull-sprint', `Pulled ${key} → ${filename}`);
            broadcast({ type: 'doc-change', docType, filename });
            return { key, status: 'ok', filename };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logWarn('jira/pull-sprint', `Failed to pull ${key}: ${msg}`);
            return { key, status: 'error', error: msg };
          }
        },
        { concurrency: config.JIRA_CONCURRENCY }
      );

      res.json({ results });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/jira/pull-sprint',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
