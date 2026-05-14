// ── Document CRUD routes ──────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, ensureDir, parseApiError, assertDocType, assertStatus, assertFilename, resolveDocPath } from '../utils/routeHelpers.js';
import { isoDate, slugify, setFrontmatterField } from '../utils/transforms.js';

export default function docsCrudRoutes({ TYPE_CONFIG, broadcast, logInfo, docIndex }) {
  const router = Router();

  // ── GET /api/docs ──────────────────────────────────────────────────────────
  router.get('/api/docs', (req, res) => {
    try {
      // Ensure all doc dirs exist so newly-started servers don't return 500
      for (const cfg of Object.values(TYPE_CONFIG)) ensureDir(cfg.dir());
      res.json(docIndex.getAll());
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/doc/:type/:filename ───────────────────────────────────────────
  router.get('/api/doc/:type/:filename', (req, res) => {
    try {
      const { docType, filename, filepath } = resolveDocPath(req, TYPE_CONFIG);
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
      const { docType, filename, filepath } = resolveDocPath(req, TYPE_CONFIG);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      const { status, title, fixVersion, storyPoints, sprint, rank, team, workCategory } = req.body;
      let content = fs.readFileSync(filepath, 'utf-8');

      if (status !== undefined) {
        assertStatus(status);
        content = setFrontmatterField(content, 'Status', status);
      }

      if (fixVersion !== undefined) {
        content = setFrontmatterField(content, 'Fix_Version', fixVersion || 'TBD');
      }

      if (storyPoints !== undefined) {
        if (storyPoints !== null && storyPoints !== '') {
          const numVal = Number(storyPoints);
          if (!Number.isNaN(numVal) && numVal < 0) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'storyPoints must be non-negative');
          }
        }
        const val = storyPoints === null || storyPoints === '' ? 'TBD' : String(Number(storyPoints) || storyPoints);
        content = setFrontmatterField(content, 'Story_Points', val);
      }

      if (sprint !== undefined) {
        content = setFrontmatterField(content, 'Sprint', sprint || 'TBD');
      }

      if (rank !== undefined) {
        const numRank = Number(rank);
        if (!Number.isInteger(numRank) || numRank < 1) {
          return sendError(res, 400, 'VALIDATION_ERROR', 'rank must be a positive integer');
        }
        content = setFrontmatterField(content, 'Rank', String(numRank));
      }

      if (team !== undefined) {
        content = setFrontmatterField(content, 'Team', team || 'TBD');
      }

      if (workCategory !== undefined) {
        content = setFrontmatterField(content, 'Work_Category', workCategory || 'TBD');
      }

      if (title !== undefined) {
        const trimmed = title.trim();
        if (!trimmed) return sendError(res, 400, 'INVALID_TITLE', 'Title cannot be empty');
        const hasFrontmatter = content.startsWith('---');
        if (hasFrontmatter) {
          const end = content.indexOf('\n---', 3);
          const afterFm = end !== -1 ? content.slice(end + 4) : content;
          const beforeFm = end !== -1 ? content.slice(0, end + 4) : '';
          const updated = afterFm.replace(/^(#{1,2}\s+).+$/m, `$1${trimmed}`);
          content = beforeFm + updated;
        } else {
          content = content.replace(/^(#{1,2}\s+).+$/m, `$1${trimmed}`);
        }
      }

      fs.writeFileSync(filepath, content);
      docIndex.invalidate(docType, filename);
      broadcast({ type: 'title_updated', filename, docType });
      res.json({ success: true, ...(status !== undefined && { status }), ...(title !== undefined && { title }), ...(fixVersion !== undefined && { fixVersion }), ...(storyPoints !== undefined && { storyPoints }), ...(sprint !== undefined && { sprint }), ...(rank !== undefined && { rank }), ...(team !== undefined && { team }), ...(workCategory !== undefined && { workCategory }) });
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
      const { docType, filename, filepath } = resolveDocPath(req, TYPE_CONFIG);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      fs.unlinkSync(filepath);
      docIndex.invalidate(docType, filename);
      broadcast({ type: 'doc_deleted', filename, docType });
      res.json({ success: true });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/draft ── save a draft without AI ────────────────────────
  router.post('/api/docs/draft', (req, res) => {
    try {
      const { title, idea, type = 'epic', priority = 'Medium', parentEpic, parentFeature, fixVersion, team, workCategory } = req.body;
      if (!title?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'Title is required');
      if (title.length > 200) return sendError(res, 400, 'VALIDATION_ERROR', 'Title must be 200 characters or fewer');
      if (idea && idea.length > 5000) return sendError(res, 400, 'VALIDATION_ERROR', 'Idea must be 5000 characters or fewer');

      const normalizedType = assertDocType(type, TYPE_CONFIG);
      const cfg  = TYPE_CONFIG[normalizedType];
      const date = isoDate();
      const slug = slugify(title.trim().slice(0, 60));
      const filename = `${date}-${slug}.md`;
      const destDir  = cfg.dir();
      ensureDir(destDir);

      const notesLine = idea?.trim() ? `\n${idea.trim()}\n` : '\n';

      // Build extra frontmatter lines for parent links
      const epicIdLine     = (['story','spike','bug'].includes(normalizedType) && parentEpic)
        ? `\nEpic_ID: ${parentEpic}` : '';
      const featureIdLine  = (normalizedType === 'epic' && parentFeature)
        ? `\nFeature_ID: ${parentFeature}` : '';
      const fixVersionLine = (fixVersion && fixVersion !== 'TBD')
        ? fixVersion : 'TBD';

      const teamLine     = team        && team        !== 'TBD' ? team        : 'TBD';
      const workCatLine  = workCategory && workCategory !== 'TBD' ? workCategory : 'TBD';

      const content = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: ${priority}
Fix_Version: ${fixVersionLine}
Squad: TBD
PI: TBD
Sprint: TBD
Team: ${teamLine}
Work_Category: ${workCatLine}
Created: ${date}${epicIdLine}${featureIdLine}
---

## ${title.trim()}
${notesLine}`;

      fs.writeFileSync(path.join(destDir, filename), content);
      docIndex.invalidate(normalizedType, filename);
      broadcast({ type: cfg.event, filename, docType: normalizedType });
      logInfo('POST /api/docs/draft', `Created draft ${filename}`);
      res.json({ success: true, filename, docType: normalizedType });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['VALIDATION_ERROR', 'INVALID_TYPE'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
