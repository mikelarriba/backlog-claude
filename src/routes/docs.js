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

export default function docsRoutes({ rootDir, TYPE_CONFIG, INBOX_DIR, broadcast, loadCommand, callClaude, streamClaude, _apiInFlight, logInfo, logError }) {
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

  // ── POST /api/docs/draft ── save a draft without AI ────────────────────────
  router.post('/api/docs/draft', (req, res) => {
    try {
      const { title, idea, type = 'epic', priority = 'Medium', parentEpic, parentFeature, fixVersion } = req.body;
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

      const content = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: ${priority}
Fix_Version: ${fixVersionLine}
Squad: TBD
PI: TBD
Sprint: TBD
Created: ${date}${epicIdLine}${featureIdLine}
---

## ${title.trim()}
${notesLine}`;

      fs.writeFileSync(path.join(destDir, filename), content);
      broadcast({ type: cfg.event, filename, docType: normalizedType });
      logInfo('POST /api/docs/draft', `Created draft ${filename}`);
      res.json({ success: true, filename, docType: normalizedType });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['VALIDATION_ERROR', 'INVALID_TYPE'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
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
          const sprint      = extractFrontmatterField(content, 'Sprint');

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
            sprint: sprint && sprint !== 'TBD' ? sprint : null,
            parentFilename,
            parentType,
            hasDescription: (() => {
              let body = content;
              if (body.startsWith('---')) {
                const end = body.indexOf('\n---', 3);
                if (end > -1) body = body.slice(end + 4);
              }
              body = body.replace(/^#{1,2}\s+.+$/m, '').trim();
              body = body.replace(/_No description in JIRA\._/gi, '').replace(/\bTBD\b/g, '').trim();
              return body.length > 30;
            })(),
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

      const { status, title, fixVersion, storyPoints, sprint } = req.body;
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

      if (sprint !== undefined) {
        content = setFrontmatterField(content, 'Sprint', sprint || 'TBD');
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
      broadcast({ type: 'title_updated', filename, docType });
      res.json({ success: true, ...(status !== undefined && { status }), ...(title !== undefined && { title }), ...(fixVersion !== undefined && { fixVersion }), ...(storyPoints !== undefined && { storyPoints }), ...(sprint !== undefined && { sprint }) });
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

  // ── POST /api/docs/batch-delete ──────────────────────────────────────────
  router.post('/api/docs/batch-delete', (req, res) => {
    try {
      const { docs } = req.body;
      if (!Array.isArray(docs) || !docs.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'docs array is required and must not be empty');
      }

      const deleted = [];
      const skipped = [];

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

          fs.unlinkSync(filepath);
          deleted.push({ filename, docType });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr.message || 'invalid' });
        }
      }

      if (deleted.length) {
        broadcast({ type: 'batch_deleted', filenames: deleted.map(d => d.filename) });
      }

      logInfo('POST /api/docs/batch-delete', `Deleted ${deleted.length}, skipped ${skipped.length}`);
      res.json({ success: true, deleted: deleted.length, skipped });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
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

  // ── POST /api/docs/distribute ── propose sprint assignments ─────────────────
  router.post('/api/docs/distribute', (req, res) => {
    try {
      const { piName } = req.body;
      if (!piName) return sendError(res, 400, 'VALIDATION_ERROR', 'piName is required');

      // Load sprint config
      const piSettingsPath = path.join(rootDir, '.pi-settings.json');
      let sprintCfg = [];
      try {
        const settings = JSON.parse(fs.readFileSync(piSettingsPath, 'utf-8'));
        sprintCfg = (settings.sprints && settings.sprints[piName]) || [];
      } catch {}
      if (!sprintCfg.length) return sendError(res, 400, 'NO_SPRINTS', 'No sprints configured for this PI');

      // Collect leaf docs in this PI
      const PRIORITY_RANK = { Critical: 0, Major: 0, High: 1, Medium: 2, Low: 3 };
      const leafTypes = ['story', 'spike', 'bug'];
      const leafDocs = [];

      for (const docType of leafTypes) {
        const cfg = TYPE_CONFIG[docType];
        if (!cfg) continue;
        const dir = cfg.dir();
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
          const content = fs.readFileSync(path.join(dir, f), 'utf-8');
          const fv = extractFrontmatterField(content, 'Fix_Version');
          if (fv !== piName) continue;
          const sp = extractFrontmatterField(content, 'Story_Points');
          const sprint = extractFrontmatterField(content, 'Sprint');
          const priority = extractFrontmatterField(content, 'Priority') || 'Medium';
          leafDocs.push({
            filename: f,
            docType,
            title: extractTitle(content) || f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', ''),
            storyPoints: sp && sp !== 'TBD' ? Number(sp) || 0 : 0,
            hasEstimate: !!(sp && sp !== 'TBD' && Number(sp)),
            priority,
            sprint: sprint && sprint !== 'TBD' ? sprint : null,
          });
        }
      }

      // Partition: already-assigned vs unassigned
      const assigned = leafDocs.filter(d => d.sprint);
      const unassigned = leafDocs.filter(d => !d.sprint);

      // Sort unassigned: priority rank asc, then SP desc (big items first)
      unassigned.sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority] ?? 2;
        const pb = PRIORITY_RANK[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        return b.storyPoints - a.storyPoints;
      });

      // Build sprint buckets, pre-fill with assigned docs
      const buckets = sprintCfg.map(s => ({
        name: s.name,
        capacity: s.capacity,
        assigned: assigned.filter(d => d.sprint === s.name).map(d => ({ ...d, wasAlreadyAssigned: true })),
        usedPoints: assigned.filter(d => d.sprint === s.name).reduce((sum, d) => sum + d.storyPoints, 0),
      }));

      // Greedy fill
      const overflow = [];
      for (const doc of unassigned) {
        let placed = false;
        for (const bucket of buckets) {
          if (bucket.usedPoints + doc.storyPoints <= bucket.capacity) {
            bucket.assigned.push({ ...doc, wasAlreadyAssigned: false });
            bucket.usedPoints += doc.storyPoints;
            placed = true;
            break;
          }
        }
        if (!placed) overflow.push(doc);
      }

      // Generate warnings and suggestions
      const warnings = [];
      const suggestions = [];
      const noEstimate = leafDocs.filter(d => !d.hasEstimate);
      if (noEstimate.length) warnings.push(`${noEstimate.length} item(s) have no story point estimates`);
      if (overflow.length) {
        const overflowSP = overflow.reduce((s, d) => s + d.storyPoints, 0);
        warnings.push(`${overflow.length} item(s) (${overflowSP} SP) exceed total capacity`);
      }
      for (const bucket of buckets) {
        const pct = bucket.capacity > 0 ? Math.round((bucket.usedPoints / bucket.capacity) * 100) : 0;
        if (pct > 100) suggestions.push(`${bucket.name} is at ${pct}% capacity — consider moving items to a later sprint`);
        else if (pct < 50 && bucket.capacity > 0) suggestions.push(`${bucket.name} has ${bucket.capacity - bucket.usedPoints} SP free capacity`);
      }

      res.json({ piName, sprints: buckets, overflow, warnings, suggestions });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/docs/apply-distribution ── batch assign sprints ──────────────
  router.post('/api/docs/apply-distribution', (req, res) => {
    try {
      const { assignments } = req.body;
      if (!Array.isArray(assignments) || !assignments.length) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'assignments array is required');
      }

      const updated = [];
      const skipped = [];

      for (const entry of assignments) {
        try {
          const docType = assertDocType(entry.docType, TYPE_CONFIG);
          const filename = assertFilename(entry.filename);
          const cfg = TYPE_CONFIG[docType];
          const filepath = path.join(cfg.dir(), filename);
          if (!fs.existsSync(filepath)) { skipped.push({ filename, reason: 'not found' }); continue; }

          const content = fs.readFileSync(filepath, 'utf-8');
          const patched = setFrontmatterField(content, 'Sprint', entry.sprint || 'TBD');
          fs.writeFileSync(filepath, patched);
          updated.push({ filename, docType, sprint: entry.sprint });
        } catch (entryErr) {
          skipped.push({ filename: entry.filename, reason: entryErr.message || 'invalid' });
        }
      }

      if (updated.length) {
        broadcast({ type: 'batch_sprint_updated', filenames: updated.map(u => u.filename) });
      }

      logInfo('POST /api/docs/apply-distribution', `Assigned ${updated.length} item(s), skipped ${skipped.length}`);
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

  // ── POST /api/docs/split-story ── AI-powered story split (SSE) ───────────────
  router.post('/api/docs/split-story', async (req, res) => {
    let docType, cfg, filename, filepath;
    try {
      const { filename: fn, docType: dt, targetCount = 2, sprints = [] } = req.body;
      if (!fn || !dt) return sendError(res, 400, 'VALIDATION_ERROR', 'filename and docType are required');
      docType  = assertDocType(dt, TYPE_CONFIG);
      cfg      = TYPE_CONFIG[docType];
      filename = assertFilename(fn);
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
      const count = Math.max(2, Math.min(Number(targetCount) || 2, 6));
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
