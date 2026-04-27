// ── Document CRUD + batch routes ──────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, ensureDir, parseApiError, assertDocType, assertStatus, assertFilename } from '../utils/routeHelpers.js';
import { normalizeOutput } from '../services/claudeService.js';
import {
  isoDate, slugify, extractTitle, extractWorkflowStatus,
  setFrontmatterField, extractFrontmatterField, stripFrontmatter,
} from '../utils/transforms.js';

export default function docsRoutes({ TYPE_CONFIG, INBOX_DIR, broadcast, loadCommand, callClaude, streamClaude, _apiInFlight, logInfo, logError }) {
  const router = Router();

  // ── POST /api/generate ─────────────────────────────────────────────────────
  router.post('/api/generate', async (req, res) => {
    try {
      const { title, idea, priority = 'Medium', type = 'epic', parentFeature } = req.body;
      if (!idea?.trim()) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Idea is required');
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
        fs.writeFileSync(path.join(destDir, filename), finalContent);
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

  // ── GET /api/docs ──────────────────────────────────────────────────────────
  router.get('/api/docs', (req, res) => {
    try {
      const entries = [];
      for (const [docType, cfg] of Object.entries(TYPE_CONFIG)) {
        const dir = cfg.dir();
        ensureDir(dir);
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep')) {
          const content = fs.readFileSync(path.join(dir, f), 'utf-8');
          const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})/);
          let parentFilename = null;
          let parentType     = null;
          if (docType === 'epic') {
            const val = extractFrontmatterField(content, 'Feature_ID');
            if (val && val !== 'TBD') { parentFilename = val; parentType = 'feature'; }
          } else if (docType === 'story' || docType === 'spike' || docType === 'bug') {
            const val = extractFrontmatterField(content, 'Epic_ID');
            if (val && val !== 'TBD') { parentFilename = val; parentType = 'epic'; }
          }

          const fixVersion  = extractFrontmatterField(content, 'Fix_Version');
          const jiraId      = extractFrontmatterField(content, 'JIRA_ID');
          const jiraUrl     = extractFrontmatterField(content, 'JIRA_URL');
          const storyPoints = extractFrontmatterField(content, 'Story_Points');

          entries.push({
            filename: f,
            docType,
            title: extractTitle(content) || f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', ''),
            date: dateMatch ? dateMatch[1] : '',
            status: extractWorkflowStatus(content),
            fixVersion: fixVersion && fixVersion !== 'TBD' ? fixVersion : null,
            jiraId:  jiraId  && jiraId  !== 'TBD' ? jiraId  : null,
            jiraUrl: jiraUrl || null,
            storyPoints: storyPoints && storyPoints !== 'TBD' ? Number(storyPoints) || null : null,
            parentFilename,
            parentType,
          });
        }
      }
      entries.sort((a, b) => b.filename.localeCompare(a.filename));
      res.json(entries);
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/doc/:type/:filename ───────────────────────────────────────────
  router.get('/api/doc/:type/:filename', (req, res) => {
    try {
      const docType = assertDocType(req.params.type, TYPE_CONFIG);
      const cfg = TYPE_CONFIG[docType];
      const filename = assertFilename(req.params.filename);
      const filepath = path.join(cfg.dir(), filename);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
      const content = fs.readFileSync(filepath, 'utf-8');
      res.json({ filename, docType, content });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, apiErr.code === 'INVALID_TYPE' || apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── PATCH /api/doc/:type/:filename ─────────────────────────────────────────
  router.patch('/api/doc/:type/:filename', (req, res) => {
    try {
      const docType = assertDocType(req.params.type, TYPE_CONFIG);
      const cfg = TYPE_CONFIG[docType];
      const filename = assertFilename(req.params.filename);
      const filepath = path.join(cfg.dir(), filename);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      const { status, title, fixVersion, storyPoints } = req.body;
      let content = fs.readFileSync(filepath, 'utf-8');

      if (status !== undefined) {
        assertStatus(status);
        content = setFrontmatterField(content, 'Status', status);
      }

      if (fixVersion !== undefined) {
        content = setFrontmatterField(content, 'Fix_Version', fixVersion || 'TBD');
      }

      if (storyPoints !== undefined) {
        const val = storyPoints === null || storyPoints === '' ? 'TBD' : String(Number(storyPoints) || storyPoints);
        content = setFrontmatterField(content, 'Story_Points', val);
      }

      if (title !== undefined) {
        const trimmed = title.trim();
        if (!trimmed) return sendError(res, 400, 'INVALID_TITLE', 'Title cannot be empty');
        const hasFrontmatter = content.startsWith('---');
        if (hasFrontmatter) {
          const end = content.indexOf('\n---', 3);
          const afterFm = end !== -1 ? content.slice(end + 4) : content;
          const beforeFm = end !== -1 ? content.slice(0, end + 4) : '';
          const updated = afterFm.replace(/^(##\s+).+$/m, `$1${trimmed}`);
          content = beforeFm + updated;
        } else {
          content = content.replace(/^(##\s+).+$/m, `$1${trimmed}`);
        }
      }

      fs.writeFileSync(filepath, content);
      broadcast({ type: 'title_updated', filename, docType });
      res.json({ success: true, ...(status !== undefined && { status }), ...(title !== undefined && { title }), ...(fixVersion !== undefined && { fixVersion }), ...(storyPoints !== undefined && { storyPoints }) });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(
        res,
        ['INVALID_TYPE', 'INVALID_FILENAME', 'INVALID_STATUS', 'INVALID_TITLE'].includes(apiErr.code) ? 400 : 500,
        apiErr.code, apiErr.message, apiErr.details
      );
    }
  });

  // ── DELETE /api/doc/:type/:filename ────────────────────────────────────────
  router.delete('/api/doc/:type/:filename', (req, res) => {
    try {
      const docType = assertDocType(req.params.type, TYPE_CONFIG);
      const cfg = TYPE_CONFIG[docType];
      const filename = assertFilename(req.params.filename);
      const filepath = path.join(cfg.dir(), filename);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      fs.unlinkSync(filepath);
      broadcast({ type: 'doc_deleted', filename, docType });
      res.json({ success: true });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/batch-fix-version ───────────────────────────────────────
  router.post('/api/docs/batch-fix-version', (req, res) => {
    try {
      const { fixVersion, docs } = req.body;
      if (!Array.isArray(docs) || !docs.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'docs array is required and must not be empty');
      }

      const newValue = fixVersion || 'TBD';
      const updated  = [];
      const skipped  = [];

      for (const entry of docs) {
        try {
          const docType  = assertDocType(entry.type, TYPE_CONFIG);
          const filename = assertFilename(entry.filename);
          const cfg      = TYPE_CONFIG[docType];
          const filepath = path.join(cfg.dir(), filename);

          if (!fs.existsSync(filepath)) {
            skipped.push({ filename, reason: 'not found' });
            continue;
          }

          const content = fs.readFileSync(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Fix_Version', newValue);
          fs.writeFileSync(filepath, patched);
          updated.push({ filename, docType });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr.message || 'invalid' });
        }
      }

      if (updated.length) {
        broadcast({ type: 'batch_fix_version_updated', fixVersion: newValue, filenames: updated.map(u => u.filename) });
      }

      logInfo('POST /api/docs/batch-fix-version', `Updated ${updated.length}, skipped ${skipped.length}`, { fixVersion: newValue });
      res.json({ success: true, updated: updated.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/doc/:type/:filename/upgrade ── regenerate with feedback (SSE) ─
  router.post('/api/doc/:type/:filename/upgrade', async (req, res) => {
    let docType, cfg, filename, filepath;
    try {
      docType = assertDocType(req.params.type, TYPE_CONFIG);
      cfg = TYPE_CONFIG[docType];
      filename = assertFilename(req.params.filename);
      filepath = path.join(cfg.dir(), filename);
    } catch (err) {
      const apiErr = parseApiError(err);
      return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
    }
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
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

  return router;
}
