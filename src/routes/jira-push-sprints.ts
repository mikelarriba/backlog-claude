// ── JIRA push-sprints routes ──────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pMap } from '../utils/pMap.js';
import { sendError, parseApiError, setupSSE, ensureDir } from '../utils/routeHelpers.js';
import { setFrontmatterField, isoDate, slugify } from '../utils/transforms.js';
import { ensureSprintCache } from '../services/jiraService.js';
import { JIRA_LABEL_TO_TEAM } from '../config/metadata.js';
import { config } from '../config/env.js';
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
      const filteredItems = items.filter((i) => {
        if (!i.sprint || i.sprint === 'TBD') return true;
        return localToJira.has(i.sprint);
      });

      const changes: Array<Record<string, unknown>> = [];
      const errors: Array<{ jiraId: string; error: string }> = [];
      let unchanged = 0;

      // ── Step 1: Scan selected sprints from the board (bulk fetch) ──────────
      const sprintEntries = [...activeSprintMap.entries()];
      const totalSteps = sprintEntries.length;
      send({
        type: 'progress',
        message: `Scanning ${totalSteps} sprint(s) on JIRA board…`,
        phase: 1,
        total: totalSteps,
      });

      // Map: jiraId → { sprintName (JIRA), sprintId, summary }
      const jiraSprintMap = new Map<
        string,
        { sprintName: string; sprintId: number; summary: string }
      >();

      for (let si = 0; si < sprintEntries.length; si++) {
        const [sprintName, sprintId] = sprintEntries[si];
        const localName = jiraToLocal.get(sprintName) || sprintName;
        send({
          type: 'progress',
          message: `Scanning "${localName}" (${si + 1}/${totalSteps})…`,
          phase: 1,
          current: si + 1,
          total: totalSteps,
        });
        try {
          let startAt = 0;
          while (true) {
            const data = (await jiraAgileRequest(
              'GET',
              `/board/${JIRA_BOARD_ID}/sprint/${sprintId}/issue?fields=summary&maxResults=100&startAt=${startAt}`
            )) as Record<string, unknown>;
            const issues =
              (data.issues as Array<{ key: string; fields?: { summary?: string } }>) || [];
            for (const iss of issues) {
              if (!jiraSprintMap.has(iss.key)) {
                jiraSprintMap.set(iss.key, {
                  sprintName,
                  sprintId,
                  summary: iss.fields?.summary || '',
                });
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
      send({
        type: 'progress',
        message: `Comparing ${filteredItems.length} local items…`,
        phase: 2,
        current: totalSteps,
        total: totalSteps,
      });

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
            const jiraLocalName = jiraSprintName
              ? jiraToLocal.get(jiraSprintName) || jiraSprintName
              : null;
            changes.push({
              filename,
              jiraId,
              title,
              docType,
              changeType: jiraSprintName ? 'change' : 'add',
              currentJiraSprint: jiraLocalName,
              currentJiraSprintId: jiraSprintId,
              targetSprint: localSprint,
              targetSprintId: targetId,
            });
          }
        } else {
          // Local has no sprint — if JIRA has one, offer to pull (sync JIRA → local)
          if (jiraSprintName) {
            const jiraLocalName = jiraToLocal.get(jiraSprintName) || jiraSprintName;
            changes.push({
              filename,
              jiraId,
              title,
              docType,
              changeType: 'pull',
              currentJiraSprint: jiraLocalName,
              currentJiraSprintId: jiraSprintId,
              targetSprint: jiraLocalName,
              targetSprintId: jiraSprintId,
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
        if (localSprint && sprintNamesMatch(localSprint, entry.sprintName)) {
          unchanged++;
          continue;
        }
        if (localSprint && localSprint !== 'TBD') {
          const targetId = resolveSprintId(localSprint);
          changes.push({
            filename: local.filename,
            jiraId,
            title: entry.summary || local.filename,
            docType: local.docType,
            changeType: 'change',
            currentJiraSprint: jiraToLocal.get(entry.sprintName) || entry.sprintName,
            currentJiraSprintId: entry.sprintId,
            targetSprint: localSprint,
            targetSprintId: targetId,
          });
        } else {
          // In JIRA sprint but not locally — offer to pull
          const jiraLocalName = jiraToLocal.get(entry.sprintName) || entry.sprintName;
          changes.push({
            filename: local.filename,
            jiraId,
            title: entry.summary || local.filename,
            docType: local.docType,
            changeType: 'pull',
            currentJiraSprint: jiraLocalName,
            currentJiraSprintId: entry.sprintId,
            targetSprint: jiraLocalName,
            targetSprintId: entry.sprintId,
          });
        }
      }

      const stats = {
        total: changes.length,
        adds: changes.filter((c) => c.changeType === 'add').length,
        changes: changes.filter((c) => c.changeType === 'change').length,
        pulls: changes.filter((c) => c.changeType === 'pull').length,
        unchanged,
        errors: errors.length,
      };

      logInfo(
        'POST /api/jira/push-sprints-preview',
        `${stats.adds} add, ${stats.changes} change, ${stats.pulls} pull, ${unchanged} unchanged, ${errors.length} errors`
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
  });

  // ── POST /api/jira/push-sprints ── push/pull sprint assignments ─────────────
  router.post('/api/jira/push-sprints', async (req, res) => {
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
              await docIndex.invalidateAll();
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

      const results: Array<Record<string, unknown>> = [];
      const sprintEntries = [...activeSprintMap.entries()];

      for (let i = 0; i < sprintEntries.length; i++) {
        const [jiraSprintName, sprintId] = sprintEntries[i];
        send({
          type: 'progress',
          message: `Scanning ${jiraSprintName}…`,
          current: i + 1,
          total: sprintEntries.length,
        });

        let startAt = 0;
        const maxResults = 50;
        while (true) {
          const data = (await jiraAgileRequest(
            'GET',
            `/sprint/${sprintId}/issue?maxResults=${maxResults}&startAt=${startAt}&fields=summary,issuetype,priority,status,${FIELD_STORY_POINTS || 'customfield_10002'}`
          )) as Record<string, unknown>;
          type JiraIssueItem = {
            key: string;
            fields: Record<string, unknown> & {
              summary?: string;
              issuetype?: { name?: string };
              priority?: { name?: string };
              status?: { name?: string };
            };
          };
          const issues = (data.issues as JiraIssueItem[]) || [];
          if (!issues.length) break;

          for (const issue of issues) {
            const existing = docIndex.findByJiraId(issue.key);
            if (existing) continue;

            results.push({
              key: issue.key,
              summary: issue.fields.summary || '',
              issuetype: issue.fields.issuetype?.name || 'Story',
              priority: issue.fields.priority?.name || 'Medium',
              status: issue.fields.status?.name || '',
              storyPoints: issue.fields[FIELD_STORY_POINTS || 'customfield_10002'] || null,
              sprintName: jiraSprintName,
            });
          }

          if (startAt + issues.length >= ((data.total as number) || 0)) break;
          startAt += issues.length;
        }
      }

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
