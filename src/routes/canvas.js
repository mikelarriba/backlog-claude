// ── Canvas layout persistence routes ─────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';

/** @param {import('../types.js').CanvasRouteContext} ctx */
export default function canvasRoutes({ rootDir, logInfo }) {
  const router = Router();

  const CANVAS_LAYOUT_PATH = path.join(rootDir, '.canvas-layout.json');

  function loadLayout() {
    try {
      if (fs.existsSync(CANVAS_LAYOUT_PATH)) return JSON.parse(fs.readFileSync(CANVAS_LAYOUT_PATH, 'utf-8'));
    } catch {}
    return {};
  }

  /** @param {Record<string, unknown>} data */
  function saveLayout(data) {
    fs.writeFileSync(CANVAS_LAYOUT_PATH, JSON.stringify(data, null, 2));
  }

  // GET /api/canvas/layout/:epicFilename
  router.get('/api/canvas/layout/:epicFilename', (req, res) => {
    const epicFilename = decodeURIComponent(req.params.epicFilename);
    const layout = loadLayout();
    res.json(layout[epicFilename] || {});
  });

  // PUT /api/canvas/layout/:epicFilename
  router.put('/api/canvas/layout/:epicFilename', (req, res) => {
    const epicFilename = decodeURIComponent(req.params.epicFilename);
    const { positions } = req.body;
    if (!positions || typeof positions !== 'object') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'positions object is required' } });
    }

    // Validate all positions have non-negative integer col/row
    for (const [fn, pos] of Object.entries(positions)) {
      if (
        !Number.isInteger(pos.col) || pos.col < 0 ||
        !Number.isInteger(pos.row) || pos.row < 0
      ) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Position for "${fn}" must have non-negative integer col and row` } });
      }
    }

    const layout = loadLayout();
    layout[epicFilename] = positions;
    saveLayout(layout);
    logInfo('PUT /api/canvas/layout', `Saved layout for ${epicFilename}`);
    res.json({ success: true });
  });

  // DELETE /api/canvas/layout/:epicFilename
  router.delete('/api/canvas/layout/:epicFilename', (req, res) => {
    const epicFilename = decodeURIComponent(req.params.epicFilename);
    const layout = loadLayout();
    delete layout[epicFilename];
    saveLayout(layout);
    logInfo('DELETE /api/canvas/layout', `Cleared layout for ${epicFilename}`);
    res.json({ success: true });
  });

  return router;
}
