// ── Document CRUD routes ──────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  sendError,
  ensureDir,
  handleRouteError,
  assertDocType,
  assertStatus,
  resolveDocPath,
} from '../utils/routeHelpers.js';
import { isoDate, slugify, setFrontmatterField } from '../utils/transforms.js';
import { logAudit } from '../utils/auditLog.js';
import { TEAMS, WORK_CATEGORIES } from '../config/metadata.js';
import { VALID_PRIORITIES } from '../utils/validate.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { DraftDocSchema, PatchDocSchema } from '../schemas/docs.js';
import type { RouteContext } from '../types.js';

export default function docsCrudRoutes({
  TYPE_CONFIG,
  broadcast,
  logInfo,
  docIndex,
}: RouteContext) {
  const router = Router();

  // ── GET /api/docs ──────────────────────────────────────────────────────────
  router.get('/api/docs', (req, res) => {
    try {
      // Ensure all doc dirs exist so newly-started servers don't return 500
      for (const cfg of Object.values(TYPE_CONFIG)) ensureDir(cfg.dir());
      res.json(docIndex.getAll());
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ── GET /api/doc/:type/:filename ───────────────────────────────────────────
  router.get('/api/doc/:type/:filename', async (req, res) => {
    try {
      const { docType, filename, filepath } = resolveDocPath(req, TYPE_CONFIG);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
      const content = await fs.promises.readFile(filepath, 'utf-8');
      res.json({ filename, docType, content });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ── PATCH /api/doc/:type/:filename ─────────────────────────────────────────
  router.patch('/api/doc/:type/:filename', validateBody(PatchDocSchema), async (req, res) => {
    try {
      const { docType, filename, filepath } = resolveDocPath(req, TYPE_CONFIG);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      const {
        status,
        title,
        fixVersion,
        storyPoints,
        sprint,
        rank,
        team,
        workCategory,
        priority,
        commentsSection,
      } = req.body;

      let content = await fs.promises.readFile(filepath, 'utf-8');

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
          if (!Number.isNaN(numVal) && numVal > 40) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'storyPoints cannot exceed 40');
          }
        }
        const val =
          storyPoints === null || storyPoints === ''
            ? 'TBD'
            : String(Number(storyPoints) || storyPoints);
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
        if (team && team !== 'TBD' && !TEAMS.includes(team)) {
          return sendError(
            res,
            400,
            'VALIDATION_ERROR',
            `Team must be one of: ${TEAMS.join(', ')}, TBD`
          );
        }
        content = setFrontmatterField(content, 'Team', team || 'TBD');
      }

      if (workCategory !== undefined) {
        if (workCategory && workCategory !== 'TBD' && !WORK_CATEGORIES.includes(workCategory)) {
          return sendError(
            res,
            400,
            'VALIDATION_ERROR',
            `Work Category must be one of: ${WORK_CATEGORIES.join(', ')}, TBD`
          );
        }
        content = setFrontmatterField(content, 'Work_Category', workCategory || 'TBD');
      }

      if (priority !== undefined) {
        if (!(VALID_PRIORITIES as readonly string[]).includes(priority)) {
          return sendError(
            res,
            400,
            'VALIDATION_ERROR',
            `Priority must be one of: ${VALID_PRIORITIES.join(', ')}`
          );
        }
        content = setFrontmatterField(content, 'Priority', priority);
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

      if (commentsSection !== undefined) {
        // Strip existing ## Comments section, then append the new one
        const commentIdx = content.search(/\n## Comments\b/);
        const withoutComments = commentIdx !== -1 ? content.slice(0, commentIdx) : content;
        content = commentsSection
          ? withoutComments.trimEnd() + '\n\n' + commentsSection
          : withoutComments;
      }

      await fs.promises.writeFile(filepath, content);
      await docIndex.invalidate(docType, filename);
      broadcast({ type: 'title_updated', filename, docType, doc: docIndex.get(filename) });
      const changedFields = Object.fromEntries(
        Object.entries({
          status,
          title,
          fixVersion,
          storyPoints,
          sprint,
          rank,
          team,
          workCategory,
          priority,
        }).filter(([, v]) => v !== undefined)
      );
      logAudit({ op: 'update', docType, filename, fields: changedFields, source: 'api' });
      logInfo(
        'PATCH /api/doc',
        `Patched ${docType}/${filename}: ${Object.keys(changedFields).join(', ')}`
      );
      res.json({
        success: true,
        ...(status !== undefined && { status }),
        ...(title !== undefined && { title }),
        ...(fixVersion !== undefined && { fixVersion }),
        ...(storyPoints !== undefined && { storyPoints }),
        ...(sprint !== undefined && { sprint }),
        ...(rank !== undefined && { rank }),
        ...(team !== undefined && { team }),
        ...(workCategory !== undefined && { workCategory }),
        ...(priority !== undefined && { priority }),
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ── DELETE /api/doc/:type/:filename ────────────────────────────────────────
  router.delete('/api/doc/:type/:filename', async (req, res) => {
    try {
      const { docType, filename, filepath } = resolveDocPath(req, TYPE_CONFIG);
      if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      await fs.promises.unlink(filepath);
      await docIndex.invalidate(docType, filename);
      broadcast({ type: 'doc_deleted', filename, docType });
      logAudit({ op: 'delete', docType, filename, source: 'api' });
      res.json({ success: true });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ── POST /api/docs/draft ── save a draft without AI ────────────────────────
  router.post('/api/docs/draft', validateBody(DraftDocSchema), async (req, res) => {
    try {
      const {
        title,
        idea,
        type = 'epic',
        priority = 'Medium',
        parentEpic,
        parentFeature,
        fixVersion,
        team,
        workCategory,
      } = req.body;

      const normalizedType = assertDocType(type, TYPE_CONFIG);
      const cfg = TYPE_CONFIG[normalizedType];
      const date = isoDate();
      const slug = slugify(title.trim().slice(0, 60));
      const filename = `${date}-${slug}.md`;
      const destDir = cfg.dir();
      ensureDir(destDir);

      const notesLine = idea?.trim() ? `\n${idea.trim()}\n` : '\n';

      // Build extra frontmatter lines for parent links
      const epicIdLine =
        ['story', 'spike', 'bug'].includes(normalizedType) && parentEpic
          ? `\nEpic_ID: ${parentEpic}`
          : '';
      const featureIdLine =
        normalizedType === 'epic' && parentFeature ? `\nFeature_ID: ${parentFeature}` : '';
      const fixVersionLine = fixVersion && fixVersion !== 'TBD' ? fixVersion : 'TBD';

      const teamLine = team && team !== 'TBD' ? team : 'TBD';
      const workCatLine = workCategory && workCategory !== 'TBD' ? workCategory : 'TBD';

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

      await fs.promises.writeFile(path.join(destDir, filename), content);
      await docIndex.invalidate(normalizedType, filename);
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
        fields: { title: title.trim() },
        source: 'api',
      });
      logInfo('POST /api/docs/draft', `Created draft ${filename}`);
      res.json({ success: true, filename, docType: normalizedType });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ── POST /api/docs/rebuild-index (test-only) ─────────────────────────────
  if (process.env.MOCK_CLAUDE) {
    router.post('/api/docs/rebuild-index', async (_req, res) => {
      await docIndex.invalidateAll();
      res.json({ success: true, count: docIndex.getAll().length });
    });
  }

  return router;
}
