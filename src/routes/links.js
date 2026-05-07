// ── Hierarchy & linking routes ────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, parseApiError, assertDocType, assertFilename, normalizeType } from '../utils/routeHelpers.js';
import { extractTitle, setFrontmatterField, extractFrontmatterField } from '../utils/transforms.js';

export default function linksRoutes({ TYPE_CONFIG, FEATURES_DIR, EPICS_DIR, STORIES_DIR, SPIKES_DIR, BUGS_DIR, broadcast, logInfo }) {
  const router = Router();

  // ── GET /api/links/:type/:filename ─────────────────────────────────────────
  router.get('/api/links/:type/:filename', (req, res) => {
    try {
      const docType  = assertDocType(req.params.type, TYPE_CONFIG);
      const filename = assertFilename(req.params.filename);

      let parent   = null;
      let children = [];

      if (docType === 'epic') {
        const filepath = path.join(EPICS_DIR, filename);
        if (fs.existsSync(filepath)) {
          const content = fs.readFileSync(filepath, 'utf-8');
          const featureFilename = extractFrontmatterField(content, 'Feature_ID');
          if (featureFilename && featureFilename !== 'TBD') {
            const featurePath = path.join(FEATURES_DIR, featureFilename);
            if (fs.existsSync(featurePath)) {
              const fc = fs.readFileSync(featurePath, 'utf-8');
              parent = {
                docType: 'feature',
                filename: featureFilename,
                title: extractTitle(fc) || featureFilename,
                jiraId: extractFrontmatterField(fc, 'JIRA_ID') || 'TBD',
                status: extractFrontmatterField(fc, 'Status') || 'Draft',
              };
            }
          }
        }

        for (const [childType, childDir] of [['story', STORIES_DIR], ['spike', SPIKES_DIR], ['bug', BUGS_DIR]]) {
          if (!fs.existsSync(childDir)) continue;
          for (const f of fs.readdirSync(childDir).filter(f => f.endsWith('.md'))) {
            const c = fs.readFileSync(path.join(childDir, f), 'utf-8');
            const epicId = extractFrontmatterField(c, 'Epic_ID');
            if (epicId === filename) {
              children.push({
                docType: childType, filename: f,
                title:  extractTitle(c) || f,
                jiraId: extractFrontmatterField(c, 'JIRA_ID') || 'TBD',
                status: extractFrontmatterField(c, 'Status') || 'Draft',
              });
            }
          }
        }
      } else if (docType === 'feature') {
        if (fs.existsSync(EPICS_DIR)) {
          for (const f of fs.readdirSync(EPICS_DIR).filter(f => f.endsWith('.md'))) {
            const c = fs.readFileSync(path.join(EPICS_DIR, f), 'utf-8');
            const featureId = extractFrontmatterField(c, 'Feature_ID');
            if (featureId === filename) {
              children.push({
                docType: 'epic', filename: f,
                title:  extractTitle(c) || f,
                jiraId: extractFrontmatterField(c, 'JIRA_ID') || 'TBD',
                status: extractFrontmatterField(c, 'Status') || 'Draft',
              });
            }
          }
        }
      }

      res.json({ parent, children });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  // ── POST /api/link ─────────────────────────────────────────────────────────
  router.post('/api/link', (req, res) => {
    const LINK_RULES = {
      'epic→feature': { field: 'Feature_ID', sourceDir: () => EPICS_DIR,   targetDir: () => FEATURES_DIR },
      'story→epic':   { field: 'Epic_ID',    sourceDir: () => STORIES_DIR, targetDir: () => EPICS_DIR    },
      'spike→epic':   { field: 'Epic_ID',    sourceDir: () => SPIKES_DIR,  targetDir: () => EPICS_DIR    },
      'bug→epic':     { field: 'Epic_ID',    sourceDir: () => BUGS_DIR,    targetDir: () => EPICS_DIR    },
    };

    try {
      const { sourceType, sourceFilename, targetType, targetFilename } = req.body;
      if (!sourceType || !sourceFilename || !targetType || !targetFilename) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'sourceType, sourceFilename, targetType and targetFilename are required');
      }

      const key  = `${normalizeType(sourceType)}→${normalizeType(targetType)}`;
      const rule = LINK_RULES[key];
      if (!rule) {
        return sendError(res, 400, 'INVALID_LINK', `Cannot link ${sourceType} → ${targetType}`, {
          allowed: Object.keys(LINK_RULES),
        });
      }

      const srcFile = assertFilename(sourceFilename);
      const tgtFile = assertFilename(targetFilename);
      const srcPath = path.join(rule.sourceDir(), srcFile);
      const tgtPath = path.join(rule.targetDir(), tgtFile);

      if (!fs.existsSync(srcPath)) return sendError(res, 404, 'NOT_FOUND', 'Source document not found');
      if (!fs.existsSync(tgtPath)) return sendError(res, 404, 'NOT_FOUND', 'Target document not found');

      const content = fs.readFileSync(srcPath, 'utf-8');
      const updated = setFrontmatterField(content, rule.field, tgtFile);
      fs.writeFileSync(srcPath, updated);

      broadcast({ type: 'link_updated', sourceType, sourceFilename: srcFile, targetType, targetFilename: tgtFile });
      logInfo('POST /api/link', `${srcFile} → ${tgtFile} (${rule.field})`);
      res.json({ success: true, field: rule.field, targetFilename: tgtFile });
    } catch (err) {
      const apiErr = parseApiError(err);
      sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
    }
  });

  return router;
}
