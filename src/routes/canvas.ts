// ── Canvas layout persistence routes ─────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import type { CanvasRouteContext } from '../types.js';
import { sendError } from '../utils/routeHelpers.js';

export default function canvasRoutes({ rootDir, logInfo }: CanvasRouteContext) {
  const router = Router();

  const CANVAS_LAYOUT_PATH = path.join(rootDir, '.canvas-layout.json');

  // Null-prototype object: an epicFilename of "__proto__" then becomes a plain
  // own property instead of reassigning this object's prototype chain.
  async function loadLayout(): Promise<Record<string, unknown>> {
    try {
      if (fs.existsSync(CANVAS_LAYOUT_PATH)) {
        const parsed = JSON.parse(await fs.promises.readFile(CANVAS_LAYOUT_PATH, 'utf-8'));
        return Object.assign(Object.create(null), parsed);
      }
    } catch (err) {
      logInfo(
        'canvas',
        `canvas layout file unreadable, using empty layout: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return Object.create(null);
  }

  async function saveLayout(data: Record<string, unknown>) {
    await fs.promises.writeFile(CANVAS_LAYOUT_PATH, JSON.stringify(data, null, 2));
  }

  // GET /api/canvas/layout/:epicFilename
  router.get('/api/canvas/layout/:epicFilename', async (req, res) => {
    const epicFilename = decodeURIComponent(req.params.epicFilename);
    const layout = await loadLayout();
    res.json(layout[epicFilename] || {});
  });

  // PUT /api/canvas/layout/:epicFilename
  router.put('/api/canvas/layout/:epicFilename', async (req, res) => {
    const epicFilename = decodeURIComponent(req.params.epicFilename);
    const { positions } = req.body;
    if (!positions || typeof positions !== 'object') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'positions object is required');
    }

    // Validate all positions have non-negative integer col/row
    for (const [fn, pos] of Object.entries(
      positions as Record<string, { col: unknown; row: unknown }>
    )) {
      if (
        !Number.isInteger(pos.col) ||
        (pos.col as number) < 0 ||
        !Number.isInteger(pos.row) ||
        (pos.row as number) < 0
      ) {
        return sendError(
          res,
          400,
          'VALIDATION_ERROR',
          `Position for "${fn}" must have non-negative integer col and row`
        );
      }
    }

    const layout = await loadLayout();
    layout[epicFilename] = positions;
    await saveLayout(layout);
    logInfo('PUT /api/canvas/layout', `Saved layout for ${epicFilename}`);
    res.json({ success: true });
  });

  // DELETE /api/canvas/layout/:epicFilename
  router.delete('/api/canvas/layout/:epicFilename', async (req, res) => {
    const epicFilename = decodeURIComponent(req.params.epicFilename);
    const layout = await loadLayout();
    delete layout[epicFilename];
    await saveLayout(layout);
    logInfo('DELETE /api/canvas/layout', `Cleared layout for ${epicFilename}`);
    res.json({ success: true });
  });

  return router;
}
