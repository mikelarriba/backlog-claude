// ── Story routes: read, upgrade, delete, generate ────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, ensureDir, parseApiError, assertFilename } from '../utils/routeHelpers.js';
import { extractTitle, setFrontmatterField, isoDate, slugify } from '../utils/transforms.js';
import { parseStorySections, serializeStoryFile, extractStoryTitle } from '../services/storyService.js';
import { normalizeOutput } from '../services/claudeService.js';

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

      const upgradePrompt = `Rewrite the following User Story applying the feedback below. The feedback is provided — apply it directly. Do NOT ask for clarification. Do NOT ask what changes are needed. Output ONLY the rewritten markdown — no commentary, no preamble, no code fences.

Current story:
---
${sections[storyIndex]}
---${inboxHistory}

Feedback to apply:
${feedback.trim()}

Rewrite ONLY this story incorporating the feedback above. Keep the COVE sections and YAML frontmatter structure.`;

      let newStory = '';
      await streamClaude(upgradePrompt, chunk => { newStory += chunk; send({ text: chunk }); });

      newStory = normalizeOutput(newStory);
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
      const refineTemplate = loadCommand('refine-epics');
      const storiesPrompt = refineTemplate
        ? refineTemplate.replace('$ARGUMENTS', epicContent)
        : `Break down the following Epic into 3–6 sprint-sized User Stories using the COVE framework. Output ONLY the markdown, one story per ## Story N: Title section separated by ---.\n\n${epicContent}`;

      let fullContent = '';
      await streamClaude(storiesPrompt, (chunk) => { fullContent += chunk; send({ text: chunk }); });

      fullContent = normalizeOutput(fullContent);

      // Split into individual sections on "## Story N:" headings
      const rawSections = fullContent
        .split(/(?=^## Story \d+[:\s])/m)
        .map(s => s.trim())
        .filter(s => s && /^## Story \d+/i.test(s));

      ensureDir(STORIES_DIR);
      const date = isoDate();
      const createdFiles = [];

      for (const section of rawSections) {
        // Extract title — strip "Story N: " prefix to get the plain title
        const headingMatch = section.match(/^## Story \d+[:\s]+(.+)$/m);
        const storyTitle   = headingMatch ? headingMatch[1].trim() : 'Untitled Story';
        const slug         = slugify(storyTitle);
        const storyFilename = `${date}-${slug}.md`;

        // Replace "## Story N: Title" heading with clean "## Title"
        const cleanBody = section.replace(/^## Story \d+[:\s]+.+$/m, `## ${storyTitle}`);

        const frontmatter = `---\nJIRA_ID: TBD\nStory_Points: TBD\nStatus: Draft\nPriority: Medium\nEpic_ID: ${filename}\nSquad: TBD\nPI: TBD\nSprint: TBD\nCreated: ${date}\n---\n\n`;
        fs.writeFileSync(path.join(STORIES_DIR, storyFilename), frontmatter + cleanBody);
        broadcast({ type: 'story_created', filename: storyFilename, docType: 'story' });
        createdFiles.push({ filename: storyFilename, title: storyTitle });
      }

      send({ done: true, files: createdFiles });
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
