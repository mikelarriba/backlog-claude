// ── Integration tests: settings routes ────────────────────────────────────────
// Covers: GET /api/config, GET/PUT /api/settings/pi, split-threshold,
//         sprints/:piName, and model settings.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestApp } from '../helpers/testApp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const PI_SETTINGS_PATH = path.join(PROJECT_ROOT, '.pi-settings.json');
const MODEL_SETTINGS_PATH = path.join(PROJECT_ROOT, '.model-settings.json');

let api, stop;

// Snapshot of any pre-existing settings files so we can restore them after.
let _prevPiSettings = null;
let _prevModelSettings = null;

before(async () => {
  ({ api, stop } = await startTestApp());
  // Preserve existing settings so this test suite is non-destructive.
  try {
    _prevPiSettings = fs.readFileSync(PI_SETTINGS_PATH, 'utf-8');
  } catch {
    /* no-op */
  }
  try {
    _prevModelSettings = fs.readFileSync(MODEL_SETTINGS_PATH, 'utf-8');
  } catch {
    /* no-op */
  }
});

after(async () => {
  await stop();
  // Restore (or remove) settings files to avoid polluting the dev environment.
  if (_prevPiSettings !== null) {
    fs.writeFileSync(PI_SETTINGS_PATH, _prevPiSettings);
  } else {
    try {
      fs.unlinkSync(PI_SETTINGS_PATH);
    } catch {
      /* no-op */
    }
  }
  if (_prevModelSettings !== null) {
    fs.writeFileSync(MODEL_SETTINGS_PATH, _prevModelSettings);
  } else {
    try {
      fs.unlinkSync(MODEL_SETTINGS_PATH);
    } catch {
      /* no-op */
    }
  }
});

// ── GET /api/config ───────────────────────────────────────────────────────────
describe('GET /api/config', () => {
  test('returns 200 with jiraBase string', async () => {
    const { status, data } = await api('GET', '/api/config');
    assert.equal(status, 200);
    assert.ok('jiraBase' in data, 'response should contain jiraBase');
    assert.equal(typeof data.jiraBase, 'string');
  });
});

// ── GET/PUT /api/settings/pi ──────────────────────────────────────────────────
describe('GET/PUT /api/settings/pi', () => {
  test('GET returns currentPi and nextPi fields', async () => {
    const { status, data } = await api('GET', '/api/settings/pi');
    assert.equal(status, 200);
    assert.ok('currentPi' in data);
    assert.ok('nextPi' in data);
  });

  test('PUT updates and persists currentPi and nextPi', async () => {
    const { status, data } = await api('PUT', '/api/settings/pi', {
      currentPi: 'PI-2026.1',
      nextPi: 'PI-2026.2',
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.currentPi, 'PI-2026.1');
    assert.equal(data.nextPi, 'PI-2026.2');

    // Verify persistence via a follow-up GET
    const { data: read } = await api('GET', '/api/settings/pi');
    assert.equal(read.currentPi, 'PI-2026.1');
    assert.equal(read.nextPi, 'PI-2026.2');
  });
});

// ── GET/PUT /api/settings/pi/split-threshold ──────────────────────────────────
describe('GET/PUT /api/settings/pi/split-threshold', () => {
  test('GET returns a numeric splitThreshold', async () => {
    const { status, data } = await api('GET', '/api/settings/pi/split-threshold');
    assert.equal(status, 200);
    assert.ok('splitThreshold' in data);
    assert.equal(typeof data.splitThreshold, 'number');
  });

  test('PUT updates threshold and GET reflects new value', async () => {
    const { status, data } = await api('PUT', '/api/settings/pi/split-threshold', {
      splitThreshold: 13,
    });
    assert.equal(status, 200);
    assert.equal(data.splitThreshold, 13);

    const { data: read } = await api('GET', '/api/settings/pi/split-threshold');
    assert.equal(read.splitThreshold, 13);
  });

  test('PUT returns 400 when threshold is zero', async () => {
    const { status } = await api('PUT', '/api/settings/pi/split-threshold', { splitThreshold: 0 });
    assert.equal(status, 400);
  });

  test('PUT returns 400 when threshold exceeds 50', async () => {
    const { status } = await api('PUT', '/api/settings/pi/split-threshold', { splitThreshold: 51 });
    assert.equal(status, 400);
  });
});

// ── GET/PUT /api/settings/pi/sprints/:piName ──────────────────────────────────
describe('GET/PUT /api/settings/pi/sprints/:piName', () => {
  const PI = 'PI-settings-test';

  test('GET returns empty sprints array for an unconfigured PI', async () => {
    const { status, data } = await api(
      'GET',
      `/api/settings/pi/sprints/${encodeURIComponent('PI-unconfigured-xyz')}`
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.sprints));
    assert.equal(data.sprints.length, 0);
  });

  test('PUT saves sprints and GET retrieves them', async () => {
    const sprints = [
      { name: 'Sprint A', capacity: 20 },
      { name: 'Sprint B', capacity: 15 },
    ];
    const { status, data } = await api(
      'PUT',
      `/api/settings/pi/sprints/${encodeURIComponent(PI)}`,
      { sprints }
    );
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.sprints.length, 2);
    assert.equal(data.sprints[0].name, 'Sprint A');
    assert.equal(data.sprints[1].capacity, 15);

    const { data: read } = await api('GET', `/api/settings/pi/sprints/${encodeURIComponent(PI)}`);
    assert.equal(read.sprints.length, 2);
    assert.equal(read.sprints[0].name, 'Sprint A');
  });

  test('PUT returns 400 for empty piName', async () => {
    const { status } = await api('PUT', `/api/settings/pi/sprints/${encodeURIComponent('   ')}`, {
      sprints: [{ name: 'S1', capacity: 10 }],
    });
    assert.equal(status, 400);
  });

  test('PUT returns 400 when a sprint has no name', async () => {
    const { status } = await api('PUT', `/api/settings/pi/sprints/${encodeURIComponent(PI)}`, {
      sprints: [{ name: '', capacity: 10 }],
    });
    assert.equal(status, 400);
  });

  test('PUT returns 400 when capacity exceeds 999', async () => {
    const { status } = await api('PUT', `/api/settings/pi/sprints/${encodeURIComponent(PI)}`, {
      sprints: [{ name: 'S1', capacity: 1000 }],
    });
    assert.equal(status, 400);
  });
});

// ── GET /api/settings/providers ──────────────────────────────────────────────
describe('GET /api/settings/providers', () => {
  test('returns 200 with providers array', async () => {
    const { status, data } = await api('GET', '/api/settings/providers');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.providers), 'providers must be an array');
  });

  test('providers array always contains claude-cli', async () => {
    const { data } = await api('GET', '/api/settings/providers');
    assert.ok(
      data.providers.some((p) => p.id === 'claude-cli'),
      'claude-cli must be present'
    );
  });

  test('each provider has id, name, and models array', async () => {
    const { data } = await api('GET', '/api/settings/providers');
    for (const p of data.providers) {
      assert.ok(typeof p.id === 'string', 'provider.id must be string');
      assert.ok(typeof p.name === 'string', 'provider.name must be string');
      assert.ok(Array.isArray(p.models), 'provider.models must be array');
    }
  });
});

// ── GET/PUT /api/settings/model ───────────────────────────────────────────────
describe('GET/PUT /api/settings/model', () => {
  test('GET returns model and provider fields', async () => {
    const { status, data } = await api('GET', '/api/settings/model');
    assert.equal(status, 200);
    assert.ok('model' in data);
    assert.ok('provider' in data);
  });

  test('PUT sets model and GET returns updated value', async () => {
    const { status, data } = await api('PUT', '/api/settings/model', {
      model: 'claude-haiku-4-5-20251001',
    });
    assert.equal(status, 200);
    assert.equal(data.model, 'claude-haiku-4-5-20251001');

    const { data: read } = await api('GET', '/api/settings/model');
    assert.equal(read.model, 'claude-haiku-4-5-20251001');
  });

  test('PUT sets provider and GET returns it', async () => {
    const { status, data } = await api('PUT', '/api/settings/model', {
      provider: 'claude-cli',
      model: null,
    });
    assert.equal(status, 200);
    assert.equal(data.provider, 'claude-cli');

    const { data: read } = await api('GET', '/api/settings/model');
    assert.equal(read.provider, 'claude-cli');
  });

  test('PUT with null clears the model override and defaults provider to claude-cli', async () => {
    const { status, data } = await api('PUT', '/api/settings/model', { model: null });
    assert.equal(status, 200);
    assert.equal(data.model, null);
    assert.equal(data.provider, 'claude-cli');
  });
});
