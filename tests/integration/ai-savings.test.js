// ── Integration tests: AI Time Saved routes ────────────────────────────────────
// Covers: GET /api/ai-savings, POST /api/ai-savings/log,
//         GET /api/ai-savings/export/pdf, GET /api/ai-savings/export/pptx.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestApp } from '../helpers/testApp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const AI_SAVINGS_PATH = path.join(PROJECT_ROOT, 'data', 'ai-savings.json');

let api, stop, baseUrl;

// Snapshot any pre-existing data file so this suite is non-destructive.
let _prevAiSavings = null;
let _dataDirExistedBefore = true;

before(async () => {
  ({ api, stop, baseUrl } = await startTestApp());
  try {
    _prevAiSavings = fs.readFileSync(AI_SAVINGS_PATH, 'utf-8');
  } catch {
    /* no-op */
  }
  _dataDirExistedBefore = fs.existsSync(path.dirname(AI_SAVINGS_PATH));
});

after(async () => {
  await stop();
  if (_prevAiSavings !== null) {
    fs.writeFileSync(AI_SAVINGS_PATH, _prevAiSavings);
  } else {
    try {
      fs.unlinkSync(AI_SAVINGS_PATH);
    } catch {
      /* no-op */
    }
    if (!_dataDirExistedBefore) {
      try {
        fs.rmdirSync(path.dirname(AI_SAVINGS_PATH));
      } catch {
        /* no-op — directory may hold other files */
      }
    }
  }
});

// ── GET /api/ai-savings ───────────────────────────────────────────────────────
describe('GET /api/ai-savings', () => {
  test('returns an empty log before anything has been recorded', async () => {
    const { status, data } = await api('GET', '/api/ai-savings');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.entries));
    assert.equal(data.entries.length, 0);
    assert.equal(data.total_minutes, 0);
  });
});

// ── POST /api/ai-savings/log ──────────────────────────────────────────────────
describe('POST /api/ai-savings/log', () => {
  test('logs a story_push entry and computes time saved', async () => {
    const { status, data } = await api('POST', '/api/ai-savings/log', {
      action_type: 'story_push',
      item_count: 2,
      jira_keys: ['MIDAS-1', 'MIDAS-2'],
    });
    assert.equal(status, 200);
    assert.ok(data.entry.id);
    assert.equal(data.entry.action_type, 'story_push');
    assert.equal(data.entry.item_count, 2);
    assert.equal(data.entry.time_saved_minutes, 30);
  });

  test('doc_ai_run uses a flat benchmark regardless of item_count', async () => {
    const { status, data } = await api('POST', '/api/ai-savings/log', {
      action_type: 'doc_ai_run',
      item_count: 5,
    });
    assert.equal(status, 200);
    assert.equal(data.entry.time_saved_minutes, 30);
  });

  test('logged entries are reflected in a follow-up GET', async () => {
    const { data } = await api('GET', '/api/ai-savings');
    assert.equal(data.entries.length, 2);
    assert.equal(data.total_minutes, 60);
  });

  test('rejects an invalid action_type with 400', async () => {
    const { status } = await api('POST', '/api/ai-savings/log', {
      action_type: 'not_a_real_type',
      item_count: 1,
    });
    assert.equal(status, 400);
  });

  test('rejects a missing item_count with 400', async () => {
    const { status } = await api('POST', '/api/ai-savings/log', {
      action_type: 'bug_create',
    });
    assert.equal(status, 400);
  });
});

// ── GET /api/ai-savings/export/pdf ────────────────────────────────────────────
describe('GET /api/ai-savings/export/pdf', () => {
  test('returns a PDF document', async () => {
    const res = await fetch(`${baseUrl}/api/ai-savings/export/pdf`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  });
});

// ── GET /api/ai-savings/export/pptx ───────────────────────────────────────────
describe('GET /api/ai-savings/export/pptx', () => {
  test('returns a PPTX document', async () => {
    const res = await fetch(`${baseUrl}/api/ai-savings/export/pptx`);
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  });
});
