// ── Document AI generation routes ─────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, ensureDir, parseApiError, assertDocType, assertFilename, setupSSE, resolveDocPath } from '../utils/routeHelpers.js';
import { normalizeOutput } from '../services/claudeService.js';
import {
  isoDate, slugify, extractTitle, extractWorkflowStatus,
  setFrontmatterField, extractFrontmatterField,
} from '../utils/transforms.js';

export default function docsAiRoutes({ TYPE_CONFIG, INBOX_DIR, broadcast, loadCommand, callClaude, streamClaude, _apiInFlight, logInfo, logError, docIndex }) {
  const router = Router();

  // ── POST /api/generate ─────────────────────────────────────────────────────
  router.post('/api/generate', async (req, res) => {
    try {
      const { title, idea, priority = 'Medium', type = 'epic', parentFeature, parentEpic, fixVersion } = req.body;
      if (!idea?.trim()) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Idea is required');
      }
      if (title && title.length > 200) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Title must be 200 characters or fewer');
      }
      if (idea.length > 5000) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Idea must be 5000 characters or fewer');
      }

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
      try {
        ensureDir(INBOX_DIR);
        fs.writeFileSync(path.join(INBOX_DIR, filename), rawContent);

        const template = loadCommand(cfg.command);
        const prompt = template
          ? template.replace('$ARGUMENTS', `File: ${filename}\n\n${rawContent}`)
          : `Generate a complete ${type} using the COVE Framework. Output ONLY the markdown content.\n\nFile: ${filename}\n\n${rawContent}`;
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
        fs.writeFileSync(path.join(destDir, filename), finalContent);
        docIndex.invalidate(normalizedType, filename);
      } finally {
        _apiInFlight.delete(filename);
      }

      broadcast({ type: cfg.event, filename, docType: normalizedType });
      res.json({ success: true, filename, docType: normalizedType });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/generate', apiErr.message, apiErr.details || {});
      sendError(res, apiErr.code === 'VALIDATION_ERROR' || apiErr.code === 'INVALID_TYPE' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
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
    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      const { feedback } = req.body;
      if (!feedback?.trim()) { send({ error: { code: 'VALIDATION_ERROR', message: 'Feedback is required' } }); return res.end(); }

      const currentContent = fs.readFileSync(filepath, 'utf-8');
      const currentStatus  = extractWorkflowStatus(currentContent);

      const inboxPath = path.join(INBOX_DIR, filename);
      const inboxExists = fs.existsSync(inboxPath);
      const inboxHistory = inboxExists
        ? `\n\nOriginal idea and upgrade history (for context):\n---\n${fs.readFileSync(inboxPath, 'utf-8')}\n---`
        : '';

      const upgradePrompt = `Rewrite the following ${docType} document applying the feedback below. The feedback is provided — apply it directly. Do NOT ask for clarification. Do NOT ask what changes are needed. Do NOT say you cannot see feedback. Output ONLY the rewritten markdown — no commentary, no preamble, no code fences.

Current document:
---
${currentContent}
---${inboxHistory}

Feedback to apply:
${feedback.trim()}

Rewrite the complete document incorporating the feedback above. Preserve all COVE sections and YAML frontmatter structure.`;

      let fullContent = '';
      await streamClaude(upgradePrompt, (chunk) => { fullContent += chunk; send({ text: chunk }); });

      fullContent = normalizeOutput(fullContent);
      fullContent = setFrontmatterField(fullContent, 'Status', currentStatus);
      fs.writeFileSync(filepath, fullContent);
      docIndex.invalidate(docType, filename);

      if (inboxExists) {
        const note = `\n\n---\n\n## Upgrade Note — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n\n${feedback.trim()}\n`;
        fs.appendFileSync(inboxPath, note);
      }

      send({ done: true, content: fullContent });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/doc/:type/:filename/upgrade', apiErr.message, apiErr.details || {});
      send({ error: { code: apiErr.code, message: apiErr.message, ...(apiErr.details ? { details: apiErr.details } : {}) } });
      res.end();
    }
  });

  // ── POST /api/docs/split-story ── AI-powered story split (SSE) ───────────────
  router.post('/api/docs/split-story', async (req, res) => {
    let docType, cfg, filename, filepath, rawCount, sprints;
    try {
      const { filename: fn, docType: dt, targetCount = 2, sprints: sprintsRaw = [] } = req.body;
      if (!fn || !dt) return sendError(res, 400, 'VALIDATION_ERROR', 'filename and docType are required');
      sprints = sprintsRaw;
      if (!Array.isArray(sprints)) return sendError(res, 400, 'VALIDATION_ERROR', 'sprints must be an array');
      rawCount = Number(targetCount);
      if (Number.isNaN(rawCount)) return sendError(res, 400, 'VALIDATION_ERROR', 'targetCount must be a number');
      docType  = assertDocType(dt, TYPE_CONFIG);
      cfg      = TYPE_CONFIG[docType];
      filename = assertFilename(fn);
      filepath = path.join(cfg.dir(), filename);
    } catch (err) {
      const apiErr = parseApiError(err);
      return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
    }
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    setupSSE(res);
    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      const count = Math.max(2, Math.min(rawCount || 2, 6));
      const content = fs.readFileSync(filepath, 'utf-8');

      // Extract key frontmatter fields to forward to child stories
      const epicId      = extractFrontmatterField(content, 'Epic_ID')      || 'TBD';
      const fixVersion  = extractFrontmatterField(content, 'Fix_Version')   || 'TBD';
      const priority    = extractFrontmatterField(content, 'Priority')      || 'Medium';
      const currentSP   = Number(extractFrontmatterField(content, 'Story_Points')) || 0;
      const perStorySP  = currentSP ? Math.round(currentSP / count) : 'TBD';

      const sprintList = sprints.length
        ? sprints.map((s, i) => `Part ${i + 1} → sprint: "${s}"`).join(', ')
        : `assign all parts to the same sprint as the original`;

      const splitPrompt = `You are splitting a user story that is too large for a single sprint into exactly ${count} smaller, independently deliverable user stories.

Original story:
${content}

Requirements:
- Split into exactly ${count} user stories
- Each story should be independently valuable and testable
- Distribute the scope evenly across all ${count} parts
- Each part MUST start with a YAML frontmatter block in this exact format (no extra fields):
---
JIRA_ID: TBD
Story_Points: ${perStorySP}
Status: Draft
Priority: ${priority}
Epic_ID: ${epicId}
Fix_Version: ${fixVersion}
Sprint: TBD
Created: ${isoDate()}
---
- After the frontmatter, write the story title as "## Title" then COVE sections (Context, Objective, Value, Execution) and Acceptance Criteria
- Sprint assignments: ${sprintList}
- Separate each story with exactly this marker on its own line: ===SPLIT===
- Output ONLY the ${count} story files separated by ===SPLIT===, nothing else`;

      let fullOutput = '';
      await streamClaude(splitPrompt, (chunk) => {
        fullOutput += chunk;
        send({ text: chunk });
      });

      fullOutput = normalizeOutput(fullOutput);

      // Parse parts by the ===SPLIT=== separator
      const parts = fullOutput
        .split(/^===SPLIT===/m)
        .map(p => p.trim())
        .filter(p => p.length > 0);

      if (parts.length < 2) {
        throw new Error(`Claude returned ${parts.length} part(s) — expected ${count}. Please try again.`);
      }

      const date = isoDate();
      const createdFiles = [];

      for (let i = 0; i < parts.length; i++) {
        let part = normalizeOutput(parts[i]);

        // Apply sprint from the sprints array if provided
        if (sprints[i]) {
          part = setFrontmatterField(part, 'Sprint', sprints[i]);
        }

        const title    = extractTitle(part) || `Part ${i + 1} of ${filename.replace(/\.md$/, '')}`;
        const slug     = slugify(title);
        const newName  = `${date}-${slug}.md`;
        const destPath = path.join(cfg.dir(), newName);

        fs.writeFileSync(destPath, part);
        broadcast({ type: `${docType}_created`, filename: newName, docType });
        createdFiles.push({ filename: newName, title, sprint: sprints[i] || null });
      }

      // Delete the original story
      fs.unlinkSync(filepath);
      docIndex.invalidateAll();
      broadcast({ type: 'doc_deleted', filename, docType });

      logInfo('POST /api/docs/split-story', `Split ${filename} into ${createdFiles.length} parts`);
      send({ done: true, files: createdFiles, deletedOriginal: filename });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/docs/split-story', apiErr.message, apiErr.details || {});
      send({ error: { code: apiErr.code, message: apiErr.message, ...(apiErr.details ? { details: apiErr.details } : {}) } });
      res.end();
    }
  });

  return router;
}
