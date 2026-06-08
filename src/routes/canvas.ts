// ── Canvas layout persistence routes ─────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import type { CanvasRouteContext } from '../types.js';

export default function canvasRoutes({ rootDir, logInfo }: CanvasRouteContext) {
  const router = Router();

  const CANVAS_LAYOUT_PATH = path.join(rootDir, '.canvas-layout.json');

  async function loadLayout(): Promise<Record<string, unknown>> {
    try {
      if (fs.existsSync(CANVAS_LAYOUT_PATH))
        return JSON.parse(await fs.promises.readFile(CANVAS_LAYOUT_PATH, 'utf-8'));
    } catch (err) {
      logInfo(
        'canvas',
        `canvas layout file unreadable, using empty layout: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return {};
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
      return res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: 'positions object is required' } });
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
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `Position for "${fn}" must have non-negative integer col and row`,
          },
        });
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
