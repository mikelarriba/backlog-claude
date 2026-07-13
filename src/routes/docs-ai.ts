// ── Document AI generation routes ─────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  sendError,
  ensureDir,
  parseApiError,
  assertDocType,
  assertFilename,
  setupSSE,
  resolveDocPath,
} from '../utils/routeHelpers.js';
import { normalizeOutput } from '../services/claudeService.js';
import {
  buildGeneratePrompt,
  buildUpgradePrompt,
  buildSplitStoryPrompt,
} from '../services/aiPromptBuilder.js';
import { logAudit } from '../utils/auditLog.js';
import {
  isoDate,
  slugify,
  extractTitle,
  extractWorkflowStatus,
  setFrontmatterField,
  extractFrontmatterField,
} from '../utils/transforms.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { GenerateDocSchema, SplitStorySchema, SplitEpicSchema } from '../schemas/docs.js';
import { stripControls } from '../utils/docHelpers.js';
import type { RouteContext } from '../types.js';

export default function docsAiRoutes({
  TYPE_CONFIG,
  INBOX_DIR,
  broadcast,
  loadCommand,
  callClaude,
  streamClaude,
  _apiInFlight,
  logInfo,
  logError,
  docIndex,
}: RouteContext) {
  const router = Router();

  // ── POST /api/generate ─────────────────────────────────────────────────────
  router.post('/api/generate', validateBody(GenerateDocSchema), async (req, res) => {
    try {
      const {
        title: rawTitle,
        idea: rawIdea,
        priority = 'Medium',
        type = 'epic',
        parentFeature,
        parentEpic,
        fixVersion,
        team,
        workCategory,
        pi,
      } = req.body;
      const title = rawTitle ? stripControls(rawTitle) : rawTitle;
      const idea = stripControls(rawIdea);

      const normalizedType = assertDocType(type, TYPE_CONFIG);
      const cfg = TYPE_CONFIG[normalizedType];

      const date = isoDate();
      const slug = slugify(title || idea.slice(0, 40));
      const filename = `${date}-${slug}.md`;

      const rawContent = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Inbox — Awaiting Refinement
Priority: ${priority}
Created: ${new Date().toISOString()}
---

# ${title?.trim() || 'Untitled'}

## Raw Idea

${idea.trim()}
`;

      _apiInFlight.add(filename);
      const _genStart = Date.now();
      try {
        ensureDir(INBOX_DIR);
        await fs.promises.writeFile(path.join(INBOX_DIR, filename), rawContent);

        const prompt = buildGeneratePrompt(type, loadCommand(cfg.command), filename, rawContent);
        const generatedContent = await callClaude(prompt);

        const destDir = cfg.dir();
        ensureDir(destDir);
        let finalContent = setFrontmatterField(generatedContent, 'Status', 'Draft');
        if (normalizedType === 'epic' && parentFeature) {
          finalContent = setFrontmatterField(finalContent, 'Feature_ID', parentFeature);
        }
        if (['story', 'spike', 'bug'].includes(normalizedType) && parentEpic) {
          finalContent = setFrontmatterField(finalContent, 'Epic_ID', parentEpic);
        }
        if (fixVersion && fixVersion !== 'TBD') {
          finalContent = setFrontmatterField(finalContent, 'Fix_Version', fixVersion);
        }
        if (team && team !== 'TBD') {
          finalContent = setFrontmatterField(finalContent, 'Team', team);
        }
        if (workCategory && workCategory !== 'TBD') {
          finalContent = setFrontmatterField(finalContent, 'Work_Category', workCategory);
        }
        if (pi && pi !== 'TBD') {
          finalContent = setFrontmatterField(finalContent, 'PI', pi);
        }
        await fs.promises.writeFile(path.join(destDir, filename), finalContent);
        await docIndex.invalidate(normalizedType, filename);
      } finally {
        _apiInFlight.delete(filename);
      }

      broadcast({
        type: cfg.event,
        filename,
        docType: normalizedType,
        doc: docIndex.get(filename),
      });
      logAudit({
        op: 'create',
        docType: normalizedType,
        filename,
        fields: { title: title || idea.slice(0, 60) },
        source: 'api',
      });
      logInfo(
        'POST /api/generate',
        `Generated ${normalizedType}/${filename} in ${Date.now() - _genStart}ms`
      );
      res.json({ success: true, filename, docType: normalizedType });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/generate',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(
        res,
        apiErr.code === 'VALIDATION_ERROR' || apiErr.code === 'INVALID_TYPE' ? 400 : 500,
        apiErr.code,
        apiErr.message,
        apiErr.details
      );
    }
  });

  // ── POST /api/doc/:type/:filename/upgrade ── regenerate with feedback (SSE) ─
  router.post('/api/doc/:type/:filename/upgrade', async (req, res) => {
    let docType, filename, filepath;
    try {
      ({ docType, filename, filepath } = resolveDocPath(req, TYPE_CONFIG));
    } catch (err) {
      const apiErr = parseApiError(err);
      return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
    }
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    setupSSE(res);
    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      const { feedback } = req.body;

      if (!feedback || !String(feedback).trim()) {
        send({ error: { code: 'VALIDATION_ERROR', message: 'feedback is required' } });
        res.end();
        return;
      }

      const currentContent = await fs.promises.readFile(filepath, 'utf-8');
      const currentStatus = extractWorkflowStatus(currentContent);

      const inboxPath = path.join(INBOX_DIR, filename);
      const inboxExists = fs.existsSync(inboxPath);
      const inboxHistory = inboxExists
        ? `\n\nOriginal idea and upgrade history (for context):\n---\n${await fs.promises.readFile(inboxPath, 'utf-8')}\n---`
        : '';

      const upgradePrompt = buildUpgradePrompt(docType, currentContent, feedback, inboxHistory);

      let fullContent = '';
      await streamClaude(upgradePrompt, (chunk: string) => {
        fullContent += chunk;
        send({ text: chunk });
      });

      fullContent = normalizeOutput(fullContent);
      fullContent = setFrontmatterField(fullContent, 'Status', currentStatus);
      await fs.promises.writeFile(filepath, fullContent);
      await docIndex.invalidate(docType, filename);

      if (inboxExists) {
        const note = `\n\n---\n\n## Upgrade Note — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n\n${feedback.trim()}\n`;
        await fs.promises.appendFile(inboxPath, note);
      }

      send({ done: true, content: fullContent });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/doc/:type/:filename/upgrade',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      send({
        error: {
          code: apiErr.code,
          message: apiErr.message,
          ...(apiErr.details ? { details: apiErr.details } : {}),
        },
      });
      res.end();
    }
  });

  // ── POST /api/docs/split-story ── AI-powered story split (SSE) ───────────────
  router.post('/api/docs/split-story', validateBody(SplitStorySchema), async (req, res) => {
    let docType, cfg, filename, filepath, rawCount, sprints;
    try {
      const { filename: fn, docType: dt, targetCount = 2, sprints: sprintsRaw = [] } = req.body;
      sprints = sprintsRaw;
      rawCount = Number(targetCount);
      docType = assertDocType(dt, TYPE_CONFIG);
      cfg = TYPE_CONFIG[docType];
      filename = assertFilename(fn);
      filepath = path.join(cfg.dir(), filename);
    } catch (err) {
      const apiErr = parseApiError(err);
      return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
    }
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    setupSSE(res);
    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      const count = Math.max(2, Math.min(rawCount || 2, 6));
      const content = await fs.promises.readFile(filepath, 'utf-8');

      // Extract key frontmatter fields to forward to child stories
      const epicId = extractFrontmatterField(content, 'Epic_ID') || 'TBD';
      const fixVersion = extractFrontmatterField(content, 'Fix_Version') || 'TBD';
      const priority = extractFrontmatterField(content, 'Priority') || 'Medium';
      const currentSP = Number(extractFrontmatterField(content, 'Story_Points')) || 0;
      const perStorySP = currentSP ? Math.round(currentSP / count) : 'TBD';

      const sprintArr = sprints as string[];
      const sprintList = sprintArr.length
        ? sprintArr.map((s, i) => `Part ${i + 1} → sprint: "${s}"`).join(', ')
        : `assign all parts to the same sprint as the original`;

      const splitPrompt = buildSplitStoryPrompt({
        content,
        count,
        epicId,
        fixVersion,
        priority,
        perStorySP,
        sprintList,
      });

      let fullOutput = '';
      await streamClaude(splitPrompt, (chunk: string) => {
        fullOutput += chunk;
        send({ text: chunk });
      });

      fullOutput = normalizeOutput(fullOutput);

      // Parse parts by the ===SPLIT=== separator
      const parts = fullOutput
        .split(/^===SPLIT===/m)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (parts.length < 2) {
        throw new Error(
          `Claude returned ${parts.length} part(s) — expected ${count}. Please try again.`
        );
      }

      const date = isoDate();
      const createdFiles = [];

      for (let i = 0; i < parts.length; i++) {
        let part = normalizeOutput(parts[i]);

        // Apply sprint from the sprints array if provided
        if (sprints[i]) {
          part = setFrontmatterField(part, 'Sprint', sprints[i]);
        }

        const title = extractTitle(part) || `Part ${i + 1} of ${filename.replace(/\.md$/, '')}`;
        const slug = slugify(title);
        const newName = `${date}-${slug}.md`;
        const destPath = path.join(cfg.dir(), newName);

        await fs.promises.writeFile(destPath, part);
        await docIndex.invalidate(docType, newName);
        broadcast({
          type: `${docType}_created`,
          filename: newName,
          docType,
          doc: docIndex.get(newName),
        });
        createdFiles.push({ filename: newName, title, sprint: sprints[i] || null });
      }

      // Delete the original story
      await fs.promises.unlink(filepath);
      await docIndex.invalidateAll();
      broadcast({ type: 'doc_deleted', filename, docType });

      logInfo('POST /api/docs/split-story', `Split ${filename} into ${createdFiles.length} parts`);
      send({ done: true, files: createdFiles, deletedOriginal: filename });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/docs/split-story',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      send({
        error: {
          code: apiErr.code,
          message: apiErr.message,
          ...(apiErr.details ? { details: apiErr.details } : {}),
        },
      });
      res.end();
    }
  });

  // ── POST /api/split-epic ── Split an epic, auto-creating a Feature if needed ─
  router.post('/api/split-epic', validateBody(SplitEpicSchema), async (req, res) => {
    try {
      const { epicFilename: rawFilename, description } = req.body;

      const epicFilename = assertFilename(rawFilename);
      const epicCfg = TYPE_CONFIG.epic;
      const epicPath = path.join(epicCfg.dir(), epicFilename);
      if (!fs.existsSync(epicPath)) return sendError(res, 404, 'NOT_FOUND', 'Epic not found');

      const epicContent = await fs.promises.readFile(epicPath, 'utf-8');
      const epicTitle = extractTitle(epicContent) || epicFilename;
      const epicPriority = extractFrontmatterField(epicContent, 'Priority') || 'Medium';
      const epicFixVer = extractFrontmatterField(epicContent, 'Fix_Version');
      const epicPi = extractFrontmatterField(epicContent, 'PI');
      const epicTeam = extractFrontmatterField(epicContent, 'Team');
      const epicWorkCat = extractFrontmatterField(epicContent, 'Work_Category');
      let featureId = extractFrontmatterField(epicContent, 'Feature_ID');

      let featureFilename = null;
      let featureCreated = false;
      let featureTitle = null;

      // Step 1: Resolve or create the parent Feature
      if (!featureId || featureId === 'TBD') {
        // Auto-create a draft Feature
        const featureCfg = TYPE_CONFIG.feature;
        const date = isoDate();
        const slug = slugify(epicTitle);
        featureFilename = `${date}-${slug}.md`;
        featureTitle = epicTitle;

        const featureContent = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: ${epicPriority}
Created: ${date}
---

## ${epicTitle}

## Context

Auto-created feature to group related epics split from: ${epicTitle}.

## Objective

TBD — refine after reviewing the epics grouped under this feature.

## Value

TBD

## Execution

1. **Epic:** ${epicTitle} — original epic
2. **Epic:** (new) — split from original

## Out of Scope

TBD
`;

        ensureDir(featureCfg.dir());
        await fs.promises.writeFile(path.join(featureCfg.dir(), featureFilename), featureContent);
        await docIndex.invalidate('feature', featureFilename);
        broadcast({
          type: 'feature_created',
          filename: featureFilename,
          docType: 'feature',
          doc: docIndex.get(featureFilename),
        });

        // Link original epic to the new feature
        const updated = setFrontmatterField(epicContent, 'Feature_ID', featureFilename);
        await fs.promises.writeFile(epicPath, updated);
        await docIndex.invalidate('epic', epicFilename);

        featureId = featureFilename;
        featureCreated = true;

        logInfo(
          'POST /api/split-epic',
          `Auto-created feature ${featureFilename} for epic ${epicFilename}`
        );
      } else {
        featureFilename = featureId;
        // Resolve feature title
        const featureCfg = TYPE_CONFIG.feature;
        const featurePath = path.join(featureCfg.dir(), featureFilename);
        if (fs.existsSync(featurePath)) {
          featureTitle =
            extractTitle(await fs.promises.readFile(featurePath, 'utf-8')) || featureFilename;
        } else {
          featureTitle = featureFilename;
        }
      }

      // Step 2: Generate new epic via AI
      const idea = stripControls(
        `${description.trim()}\n\n---\nContext from original epic:\n${epicContent}`
      );

      const genBody: {
        idea: string;
        type: string;
        priority: string;
        parentFeature: string;
        fixVersion?: string;
        pi?: string;
        team?: string;
        workCategory?: string;
      } = {
        idea,
        type: 'epic',
        priority: epicPriority,
        parentFeature: featureFilename,
      };
      if (epicFixVer && epicFixVer !== 'TBD') genBody.fixVersion = epicFixVer;
      if (epicPi && epicPi !== 'TBD') genBody.pi = epicPi;
      if (epicTeam && epicTeam !== 'TBD') genBody.team = epicTeam;
      if (epicWorkCat && epicWorkCat !== 'TBD') genBody.workCategory = epicWorkCat;

      const date = isoDate();
      const slug = slugify(description.slice(0, 40));
      const newEpicFilename = `${date}-${slug}.md`;

      const rawContent = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Inbox — Awaiting Refinement
Priority: ${epicPriority}
Created: ${new Date().toISOString()}
---

# ${description.trim().slice(0, 80)}

## Raw Idea

${idea}
`;

      _apiInFlight.add(newEpicFilename);
      try {
        ensureDir(INBOX_DIR);
        await fs.promises.writeFile(path.join(INBOX_DIR, newEpicFilename), rawContent);

        const prompt = buildGeneratePrompt(
          'epic',
          loadCommand(epicCfg.command),
          newEpicFilename,
          rawContent
        );
        const generatedContent = await callClaude(prompt);

        const destDir = epicCfg.dir();
        ensureDir(destDir);
        let finalContent = setFrontmatterField(generatedContent, 'Status', 'Draft');
        finalContent = setFrontmatterField(finalContent, 'Feature_ID', featureFilename);
        if (epicFixVer && epicFixVer !== 'TBD')
          finalContent = setFrontmatterField(finalContent, 'Fix_Version', epicFixVer);
        if (epicPi && epicPi !== 'TBD')
          finalContent = setFrontmatterField(finalContent, 'PI', epicPi);
        if (epicTeam && epicTeam !== 'TBD')
          finalContent = setFrontmatterField(finalContent, 'Team', epicTeam);
        if (epicWorkCat && epicWorkCat !== 'TBD')
          finalContent = setFrontmatterField(finalContent, 'Work_Category', epicWorkCat);
        await fs.promises.writeFile(path.join(destDir, newEpicFilename), finalContent);
        await docIndex.invalidate('epic', newEpicFilename);
      } finally {
        _apiInFlight.delete(newEpicFilename);
      }

      broadcast({
        type: 'epic_created',
        filename: newEpicFilename,
        docType: 'epic',
        doc: docIndex.get(newEpicFilename),
      });
      logInfo(
        'POST /api/split-epic',
        `Split epic ${epicFilename} → new epic ${newEpicFilename}, feature ${featureFilename}`
      );

      res.json({
        success: true,
        featureFilename,
        featureTitle,
        newEpicFilename,
        featureCreated,
      });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError(
        'POST /api/split-epic',
        apiErr.message,
        apiErr.details as Record<string, unknown> | undefined
      );
      sendError(
        res,
        apiErr.code === 'VALIDATION_ERROR' || apiErr.code === 'NOT_FOUND' ? 400 : 500,
        apiErr.code,
        apiErr.message,
        apiErr.details
      );
    }
  });

  return router;
}
