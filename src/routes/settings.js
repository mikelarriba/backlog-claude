// ── Settings routes: PI versions, model override ─────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { setModelOverride, getModelOverride } from '../services/claudeService.js';

export default function settingsRoutes({ rootDir, broadcast, logInfo }) {
  const router = Router();

  const PI_SETTINGS_PATH    = path.join(rootDir, '.pi-settings.json');
  const MODEL_SETTINGS_PATH = path.join(rootDir, '.model-settings.json');

  function loadPiSettings() {
    try {
      if (fs.existsSync(PI_SETTINGS_PATH)) return JSON.parse(fs.readFileSync(PI_SETTINGS_PATH, 'utf-8'));
    } catch {}
    return { currentPi: null, nextPi: null };
  }

  function savePiSettings(settings) {
    fs.writeFileSync(PI_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  }

  // Apply saved model on startup
  try {
    if (fs.existsSync(MODEL_SETTINGS_PATH)) {
      const saved = JSON.parse(fs.readFileSync(MODEL_SETTINGS_PATH, 'utf-8'));
      if (saved.model) setModelOverride(saved.model);
    }
  } catch {}

  // ── PI settings ────────────────────────────────────────────────────────────
  router.get('/api/settings/pi', (req, res) => {
    res.json(loadPiSettings());
  });

  router.put('/api/settings/pi', (req, res) => {
    const { currentPi, nextPi } = req.body;
    const settings = { currentPi: currentPi || null, nextPi: nextPi || null };
    savePiSettings(settings);
    broadcast({ type: 'pi_settings_updated', ...settings });
    res.json({ success: true, ...settings });
  });

  // ── Model settings ─────────────────────────────────────────────────────────
  router.get('/api/settings/model', (req, res) => {
    res.json({ model: getModelOverride() });
  });

  router.put('/api/settings/model', (req, res) => {
    const { model } = req.body;
    setModelOverride(model || null);
    fs.writeFileSync(MODEL_SETTINGS_PATH, JSON.stringify({ model: model || null }, null, 2));
    logInfo('PUT /api/settings/model', `Model set to: ${model || 'default'}`);
    res.json({ success: true, model: getModelOverride() });
  });

  return router;
}
