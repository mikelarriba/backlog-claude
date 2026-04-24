// ── Story routes: read, upgrade, delete, generate ────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, ensureDir, parseApiError, assertFilename } from '../utils/routeHelpers.js';
import { extractTitle, setFrontmatterField } from '../utils/transforms.js';
import { parseStorySections, serializeStoryFile, extractStoryTitle } from '../services/storyService.js';

export default function storiesRoutes({ TYPE_CONFIG, EPICS_DIR, STORIES_DIR, INBOX_DIR, broadcast, loadCommand, callClaude, streamClaude, logError }) {
  const router = Router();

  // ── GET /api/stories/:filename ─────────────────────────────────────────────
  router.get('/api/stories/:filename', (req, res) => {
    try {
      const filename = assertFilename(req.params.filename);
      const filepath = path.join(STORIES_DIR, filename);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Stories file not found');
      const content = fs.readFileSync(filepath, 'utf-8');
      const { sections } = parseStorySections(content);
      res.json({
        filename,
        sections: sections.map((s, i) => ({ index: i, title: extractStoryTitle(s), content: s }))
      });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/stories/:filename/upgrade-story (SSE) ────────────────────────
  router.post('/api/stories/:filename/upgrade-story', async (req, res) => {
    let filename, filepath;
    try {
      filename = assertFilename(req.params.filename);
      filepath = path.join(STORIES_DIR, filename);
    } catch (err) {
      const apiErr = parseApiError(err);
      return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
    }
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Stories file not found');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = p => res.write(`data: ${JSON.stringify(p)}\n\n`);

    try {
      const { storyIndex, feedback } = req.body;
      if (!feedback?.trim()) { send({ error: { code: 'VALIDATION_ERROR', message: 'Feedback is required' } }); return res.end(); }

      const content = fs.readFileSync(filepath, 'utf-8');
      const { frontmatter, sections } = parseStorySections(content);
      if (storyIndex < 0 || storyIndex >= sections.length) {
        send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid story index' } }); return res.end();
      }

      const epicFilename = filename.replace('-stories.md', '.md');
      const inboxPath = path.join(INBOX_DIR, epicFilename);
      const inboxHistory = fs.existsSync(inboxPath)
        ? `\n\nOriginal epic idea and upgrade history:\n---\n${fs.readFileSync(inboxPath, 'utf-8')}\n---`
        : '';

      const upgradePrompt = `You are upgrading a single User Story based on user feedback.

Current story:
---
${sections[storyIndex]}
---${inboxHistory}

New feedback / requested changes:
${feedback.trim()}

Rewrite ONLY this story incorporating the feedback. Keep the "## Story N: Title" heading format. Output ONLY the markdown — no files, no explanation.`;

      let newStory = '';
      await streamClaude(upgradePrompt, chunk => { newStory += chunk; send({ text: chunk }); });

      newStory = newStory.trim().replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '');
      sections[storyIndex] = newStory;
      fs.writeFileSync(filepath, serializeStoryFile(frontmatter, sections));

      if (fs.existsSync(inboxPath)) {
        const note = `\n\n---\n\n## Story Upgrade Note — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (Story ${storyIndex + 1})\n\n${feedback.trim()}\n`;
        fs.appendFileSync(inboxPath, note);
      }

      send({ done: true, title: extractStoryTitle(newStory), content: newStory });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/stories/:filename/upgrade-story', apiErr.message, apiErr.details || {});
      send({ error: { code: apiErr.code, message: apiErr.message, ...(apiErr.details ? { details: apiErr.details } : {}) } });
      res.end();
    }
  });

  // ── DELETE /api/stories/:filename/story ────────────────────────────────────
  router.delete('/api/stories/:filename/story', (req, res) => {
    try {
      const filename = assertFilename(req.params.filename);
      const filepath = path.join(STORIES_DIR, filename);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Stories file not found');

      const { storyIndex } = req.body;
      const content = fs.readFileSync(filepath, 'utf-8');
      const { frontmatter, sections } = parseStorySections(content);
      if (storyIndex < 0 || storyIndex >= sections.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid story index');
      }

      sections.splice(storyIndex, 1);
      fs.writeFileSync(filepath, serializeStoryFile(frontmatter, sections));
      res.json({ success: true, remaining: sections.length });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/epic/:filename/stories (SSE) ─────────────────────────────────
  router.post('/api/epic/:filename/stories', async (req, res) => {
    let filename, filepath;
    try {
      filename = assertFilename(req.params.filename);
      filepath = path.join(EPICS_DIR, filename);
    } catch (err) {
      const apiErr = parseApiError(err);
      return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
    }
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Epic not found');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      const epicContent = fs.readFileSync(filepath, 'utf-8');
      const storiesTemplate = loadCommand('create-stories');
      const storiesPrompt = storiesTemplate
        ? storiesTemplate.replace('$ARGUMENTS', epicContent)
        : `Break down the following Epic into 3–6 INVEST-compliant User Stories with Gherkin acceptance criteria. Output ONLY the markdown content.\n\n${epicContent}`;

      let fullContent = '';
      await streamClaude(storiesPrompt, (chunk) => { fullContent += chunk; send({ text: chunk }); });

      fullContent = fullContent.trim().replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '');

      if (!fullContent.startsWith('---')) {
        fullContent = `---\nEpic_ID: ${filename}\n---\n\n${fullContent}`;
      } else {
        fullContent = setFrontmatterField(fullContent, 'Epic_ID', filename);
      }

      const storyFilename = filename.replace('.md', '-stories.md');
      ensureDir(STORIES_DIR);
      fs.writeFileSync(path.join(STORIES_DIR, storyFilename), fullContent);
      broadcast({ type: 'story_created', filename: storyFilename, docType: 'story' });

      send({ done: true, filename: storyFilename });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/epic/:filename/stories', apiErr.message, apiErr.details || {});
      send({ error: { code: apiErr.code, message: apiErr.message, ...(apiErr.details ? { details: apiErr.details } : {}) } });
      res.end();
    }
  });

  // ── Legacy endpoints ───────────────────────────────────────────────────────
  router.get('/api/epics', (_, res) => {
    try {
      ensureDir(EPICS_DIR);
      const files = fs.readdirSync(EPICS_DIR)
        .filter(f => f.endsWith('.md') && f !== '.gitkeep')
        .map(f => {
          const content = fs.readFileSync(path.join(EPICS_DIR, f), 'utf-8');
          const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})/);
          return { filename: f, docType: 'epic', title: extractTitle(content) || f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', ''), date: dateMatch ? dateMatch[1] : '' };
        })
        .sort((a, b) => b.filename.localeCompare(a.filename));
      res.json(files);
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  router.get('/api/epic/:filename', (req, res) => {
    try {
      const filename = assertFilename(req.params.filename);
      const filepath = path.join(EPICS_DIR, filename);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Epic not found');
      res.json({ filename, docType: 'epic', content: fs.readFileSync(filepath, 'utf-8') });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
