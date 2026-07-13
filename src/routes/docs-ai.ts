// ── Document AI generation routes ─────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  sendError,
  parseApiError,
  assertDocType,
  assertFilename,
  setupSSE,
  resolveDocPath,
} from '../utils/routeHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { GenerateDocSchema, SplitStorySchema, SplitEpicSchema } from '../schemas/docs.js';
import { generateDoc, upgradeDoc, splitStory, splitEpic } from '../services/aiService.js';
import type { RouteContext } from '../types.js';

export default function docsAiRoutes(ctx: RouteContext) {
  const {
    TYPE_CONFIG,
    broadcast,
    loadCommand,
    callClaude,
    streamClaude,
    _apiInFlight,
    logInfo,
    logError,
    docIndex,
    INBOX_DIR,
  } = ctx;

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

      const normalizedType = assertDocType(type, TYPE_CONFIG);

      const { filename, docType } = await generateDoc(
        {
          rawTitle,
          rawIdea,
          priority,
          type: normalizedType,
          parentFeature,
          parentEpic,
          fixVersion,
          team,
          workCategory,
          pi,
        },
        ctx
      );

      res.json({ success: true, filename, docType });
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

      const { fullContent } = await upgradeDoc(
        { filepath, filename, docType, feedback, INBOX_DIR },
        { streamClaude, docIndex },
        (chunk) => send({ text: chunk })
      );

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
    let docType, filename, filepath, rawCount, sprints;
    try {
      const { filename: fn, docType: dt, targetCount = 2, sprints: sprintsRaw = [] } = req.body;
      sprints = sprintsRaw;
      rawCount = Number(targetCount);
      docType = assertDocType(dt, TYPE_CONFIG);
      filename = assertFilename(fn);
      filepath = path.join(TYPE_CONFIG[docType].dir(), filename);
    } catch (err) {
      const apiErr = parseApiError(err);
      return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
    }
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    setupSSE(res);
    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      const count = Math.max(2, Math.min(rawCount || 2, 6));

      const { createdFiles, deletedOriginal } = await splitStory(
        { filepath, filename, docType, count, sprints: sprints as string[] },
        { TYPE_CONFIG, broadcast, streamClaude, logInfo, docIndex },
        (chunk) => send({ text: chunk })
      );

      send({ done: true, files: createdFiles, deletedOriginal });
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
      const epicPath = path.join(TYPE_CONFIG.epic.dir(), epicFilename);
      if (!fs.existsSync(epicPath)) return sendError(res, 404, 'NOT_FOUND', 'Epic not found');

      const result = await splitEpic({ epicFilename, description }, ctx);

      res.json({ success: true, ...result });
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
