// ── Bug creation routes ──────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { sendError, ensureDir, parseApiError, assertFilename } from '../utils/routeHelpers.js';
import { isoDate, slugify, setFrontmatterField } from '../utils/transforms.js';
import { translateToEnglish, processAttachment } from '../services/bugService.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export default function bugRoutes({ BUGS_DIR, broadcast, callClaude, logInfo, logError, docIndex }) {
  const router = Router();

  // ── POST /api/bugs/create ─────────────────────────────────────────────────
  router.post('/api/bugs/create', upload.array('attachments', 5), async (req, res) => {
    try {
      const { id, title, description, team, workCategory } = req.body;
      if (!id || !title) return sendError(res, 400, 'VALIDATION_ERROR', 'ID and Title are required');
      if (String(id).length > 200) return sendError(res, 400, 'VALIDATION_ERROR', 'ID must be 200 characters or fewer');
      if (String(title).length > 200) return sendError(res, 400, 'VALIDATION_ERROR', 'Title must be 200 characters or fewer');

      const ALLOWED_MIME = [/^image\//, /^application\/pdf$/, /^message\/rfc822$/, /^application\/vnd\.ms-outlook$/, /^text\//];
      // These formats are sent as application/octet-stream by browsers — allow by extension
      const ALLOWED_EXT = new Set(['.msg', '.log', '.txt', '.csv']);
      const badFile = (req.files || []).find(f => {
        if (ALLOWED_MIME.some(p => p.test(f.mimetype))) return false;
        if (f.mimetype === 'application/octet-stream' && ALLOWED_EXT.has(path.extname(f.originalname).toLowerCase())) return false;
        return true;
      });
      if (badFile) return sendError(res, 400, 'VALIDATION_ERROR', `Unsupported file type: ${badFile.mimetype}`);

      // Concatenate id + title, translate if needed
      const rawTitle = `${id} ${title}`;
      const translatedTitle = await translateToEnglish(callClaude, rawTitle);
      const translatedDesc = description ? await translateToEnglish(callClaude, description) : '';

      // Build filename
      const slug = slugify(translatedTitle);
      const filename = `${isoDate()}-${slug}.md`;

      // Process attachments
      const files = req.files || [];
      const processed = [];
      for (const file of files) {
        try {
          const result = await processAttachment(file, callClaude);
          processed.push(result);
        } catch (e) {
          logError('bugs/create', `Failed to process attachment ${file.originalname}: ${e.message}`);
          // Save original on failure
          processed.push({ filename: file.originalname, buffer: file.buffer });
        }
      }

      // Save attachments
      let attachmentRefs = '';
      if (processed.length > 0) {
        const attachDir = path.join(BUGS_DIR, 'attachments', slug);
        ensureDir(attachDir);
        for (const att of processed) {
          const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
          fs.writeFileSync(path.join(attachDir, safeName), att.buffer);
          attachmentRefs += `- [${att.filename}](attachments/${slug}/${safeName})\n`;
        }
      }

      const bugTeam    = team        && team        !== 'TBD' ? team        : 'TBD';
      const bugWorkCat = workCategory && workCategory !== 'TBD' ? workCategory : 'TBD';

      // Build markdown content
      const content = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: Medium
Team: ${bugTeam}
Work_Category: ${bugWorkCat}
Created: ${isoDate()}
---

## ${translatedTitle}

### Description

${translatedDesc || '_No description provided._'}
${attachmentRefs ? `\n### Attachments\n\n${attachmentRefs}` : ''}`;

      ensureDir(BUGS_DIR);
      fs.writeFileSync(path.join(BUGS_DIR, filename), content);
      docIndex.invalidate('bug', filename);

      broadcast({ type: 'bug_created', filename, docType: 'bug' });
      logInfo('POST /api/bugs/create', `Bug created: ${filename}`, { attachments: processed.length });

      res.json({ filename, docType: 'bug', title: translatedTitle });
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/bugs/create', apiErr.message, apiErr.details || {});
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── GET /api/bugs/attachments/:slug/:file ─────────────────────────────────
  router.get('/api/bugs/attachments/:slug/:file', (req, res) => {
    let slug, file;
    try {
      slug = assertFilename(req.params.slug);
      file = assertFilename(req.params.file);
    } catch {
      return sendError(res, 400, 'INVALID_FILENAME', 'Invalid attachment path');
    }
    const filePath = path.join(BUGS_DIR, 'attachments', slug, file);
    if (!fs.existsSync(filePath)) return sendError(res, 404, 'NOT_FOUND', 'Attachment not found');
    res.sendFile(filePath);
  });

  return router;
}
