// ── Settings routes: PI versions, model override ─────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  setModelOverride,
  getModelOverride,
  setProviderOverride,
  getProviderOverride,
  setEffortOverride,
  getEffortOverride,
  getAvailableProviders,
} from '../services/claudeService.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { sendError } from '../utils/routeHelpers.js';
import {
  PiSettingsSchema,
  SplitThresholdSchema,
  SprintsSchema,
  ModelSchema,
} from '../schemas/settings.js';
import type { SettingsRouteContext } from '../types.js';

export default function settingsRoutes({
  rootDir,
  broadcast,
  logInfo,
  jiraBase,
}: SettingsRouteContext) {
  const router = Router();

  // ── App config (read-only, consumed by frontend) ───────────────────────────
  router.get('/api/config', (req, res) => {
    res.json({ jiraBase: jiraBase || '' });
  });

  const PI_SETTINGS_PATH = path.join(rootDir, '.pi-settings.json');
  const MODEL_SETTINGS_PATH = path.join(rootDir, '.model-settings.json');

  async function loadPiSettings() {
    try {
      if (fs.existsSync(PI_SETTINGS_PATH))
        return JSON.parse(await fs.promises.readFile(PI_SETTINGS_PATH, 'utf-8'));
    } catch {
      /* no-op */
    }
    return { currentPi: null, nextPi: null, defaultBufferPct: 0 };
  }

  async function savePiSettings(settings: Record<string, unknown>) {
    await fs.promises.writeFile(PI_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  }

  // Apply saved model, provider, and effort on startup (async read, fires before first request)
  void (async () => {
    try {
      if (fs.existsSync(MODEL_SETTINGS_PATH)) {
        const saved = JSON.parse(await fs.promises.readFile(MODEL_SETTINGS_PATH, 'utf-8'));
        if (saved.model) setModelOverride(saved.model);
        if (saved.provider) setProviderOverride(saved.provider);
        if (saved.effort) setEffortOverride(saved.effort);
      }
    } catch {
      /* no-op */
    }
  })();

  // ── PI settings ────────────────────────────────────────────────────────────
  router.get('/api/settings/pi', async (req, res) => {
    const { sprints: _sprints, ...rest } = await loadPiSettings();
    res.json(rest);
  });

  router.put('/api/settings/pi', validateBody(PiSettingsSchema), async (req, res) => {
    const { currentPi, nextPi } = req.body;
    const existing = await loadPiSettings();
    const settings = { ...existing, currentPi: currentPi || null, nextPi: nextPi || null };
    await savePiSettings(settings);
    broadcast({
      type: 'pi_settings_updated',
      currentPi: settings.currentPi,
      nextPi: settings.nextPi,
    });
    res.json({ success: true, currentPi: settings.currentPi, nextPi: settings.nextPi });
  });

  // ── Split threshold ────────────────────────────────────────────────────────
  router.get('/api/settings/pi/split-threshold', async (req, res) => {
    const settings = await loadPiSettings();
    res.json({ splitThreshold: settings.splitThreshold ?? 8 });
  });

  router.put(
    '/api/settings/pi/split-threshold',
    validateBody(SplitThresholdSchema),
    async (req, res) => {
      const { splitThreshold } = req.body;
      const val = Number(splitThreshold);
      const settings = await loadPiSettings();
      settings.splitThreshold = val;
      await savePiSettings(settings);
      broadcast({ type: 'split_threshold_updated', splitThreshold: val });
      res.json({ success: true, splitThreshold: val });
    }
  );

  // ── Sprint config per PI ──────────────────────────────────────────────────
  router.get('/api/settings/pi/sprints/:piName', async (req, res) => {
    const piName = decodeURIComponent(req.params.piName);
    const settings = await loadPiSettings();
    const sprints = (settings.sprints && settings.sprints[piName]) || [];
    res.json({ piName, sprints });
  });

  router.put('/api/settings/pi/sprints/:piName', validateBody(SprintsSchema), async (req, res) => {
    const piName = decodeURIComponent(String(req.params.piName)).trim();
    if (!piName) return sendError(res, 400, 'VALIDATION_ERROR', 'piName cannot be empty');
    const sprints: Array<{ name: string; capacity: number; bufferPct?: number }> = req.body.sprints;
    const settings = await loadPiSettings();
    if (!settings.sprints) settings.sprints = {};
    settings.sprints[piName] = sprints.map((s) => {
      const entry: { name: string; capacity: number; bufferPct?: number } = {
        name: s.name.trim(),
        capacity: s.capacity,
      };
      if (typeof s.bufferPct === 'number' && s.bufferPct > 0) entry.bufferPct = s.bufferPct;
      return entry;
    });
    await savePiSettings(settings);
    broadcast({ type: 'sprint_settings_updated', piName });
    logInfo('PUT /api/settings/pi/sprints', `Saved ${sprints.length} sprint(s) for ${piName}`);
    res.json({ success: true, piName, sprints: settings.sprints[piName] });
  });

  // ── Provider discovery ─────────────────────────────────────────────────────
  router.get('/api/settings/providers', async (req, res) => {
    const providers = await getAvailableProviders();
    res.json({ providers });
  });

  // ── Model settings ─────────────────────────────────────────────────────────
  router.get('/api/settings/model', (req, res) => {
    res.json({
      model: getModelOverride(),
      provider: getProviderOverride() || 'claude-cli',
      effort: getEffortOverride(),
    });
  });

  router.put('/api/settings/model', validateBody(ModelSchema), async (req, res) => {
    const { model, provider, effort } = req.body;
    setModelOverride(model || null);
    setProviderOverride(provider || null);
    setEffortOverride(effort || null);
    const saved = { model: model || null, provider: provider || null, effort: effort || null };
    await fs.promises.writeFile(MODEL_SETTINGS_PATH, JSON.stringify(saved, null, 2));
    logInfo(
      'PUT /api/settings/model',
      `Provider: ${provider || 'claude-cli'}, Model: ${model || 'default'}, Effort: ${effort || 'default'}`
    );
    res.json({
      success: true,
      model: getModelOverride(),
      provider: getProviderOverride() || 'claude-cli',
      effort: getEffortOverride(),
    });
  });

  return router;
}
