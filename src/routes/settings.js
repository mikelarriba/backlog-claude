// ── Settings routes: PI versions, model override ─────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { setModelOverride, getModelOverride } from '../services/claudeService.js';

export default function settingsRoutes({ rootDir, broadcast, logInfo, jiraBase }) {
  const router = Router();

  // ── App config (read-only, consumed by frontend) ───────────────────────────
  router.get('/api/config', (req, res) => {
    res.json({ jiraBase: jiraBase || '' });
  });

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
    const { sprints, ...rest } = loadPiSettings();
    res.json(rest);
  });

  router.put('/api/settings/pi', (req, res) => {
    const { currentPi, nextPi } = req.body;
    const existing = loadPiSettings();
    const settings = { ...existing, currentPi: currentPi || null, nextPi: nextPi || null };
    savePiSettings(settings);
    broadcast({ type: 'pi_settings_updated', currentPi: settings.currentPi, nextPi: settings.nextPi });
    res.json({ success: true, currentPi: settings.currentPi, nextPi: settings.nextPi });
  });

  // ── Split threshold ────────────────────────────────────────────────────────
  router.get('/api/settings/pi/split-threshold', (req, res) => {
    const settings = loadPiSettings();
    res.json({ splitThreshold: settings.splitThreshold ?? 8 });
  });

  router.put('/api/settings/pi/split-threshold', (req, res) => {
    const { splitThreshold } = req.body;
    const val = Number(splitThreshold);
    if (!Number.isInteger(val) || val < 1) {
      return res.status(400).json({ error: 'splitThreshold must be a positive integer' });
    }
    if (val > 50) {
      return res.status(400).json({ error: 'splitThreshold must be at most 50' });
    }
    const settings = loadPiSettings();
    settings.splitThreshold = val;
    savePiSettings(settings);
    broadcast({ type: 'split_threshold_updated', splitThreshold: val });
    res.json({ success: true, splitThreshold: val });
  });

  // ── Sprint config per PI ──────────────────────────────────────────────────
  router.get('/api/settings/pi/sprints/:piName', (req, res) => {
    const piName = decodeURIComponent(req.params.piName);
    const settings = loadPiSettings();
    const sprints = (settings.sprints && settings.sprints[piName]) || [];
    res.json({ piName, sprints });
  });

  router.put('/api/settings/pi/sprints/:piName', (req, res) => {
    const piName = decodeURIComponent(req.params.piName);
    if (!piName.trim()) {
      return res.status(400).json({ error: 'piName must be non-empty' });
    }
    const { sprints } = req.body;
    if (!Array.isArray(sprints) || sprints.length < 1) {
      return res.status(400).json({ error: 'At least one sprint is required' });
    }
    if (sprints.length > 10) {
      return res.status(400).json({ error: 'At most 10 sprints are allowed per PI' });
    }
    for (const s of sprints) {
      if (!s.name || typeof s.name !== 'string' || !s.name.trim()) {
        return res.status(400).json({ error: 'Each sprint must have a non-empty name' });
      }
      if (typeof s.capacity !== 'number' || s.capacity < 0 || s.capacity > 999) {
        return res.status(400).json({ error: `Sprint "${s.name}" capacity must be between 0 and 999` });
      }
    }
    const settings = loadPiSettings();
    if (!settings.sprints) settings.sprints = {};
    settings.sprints[piName] = sprints.map(s => ({ name: s.name.trim(), capacity: s.capacity }));
    savePiSettings(settings);
    broadcast({ type: 'sprint_settings_updated', piName });
    logInfo('PUT /api/settings/pi/sprints', `Saved ${sprints.length} sprint(s) for ${piName}`);
    res.json({ success: true, piName, sprints: settings.sprints[piName] });
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
