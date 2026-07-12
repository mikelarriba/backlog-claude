// ── Unit tests: aiSavingsService.js ────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAiSavingsService,
  computeTimeSavedMinutes,
  isValidActionType,
  buildSavingsPdf,
  buildSavingsPptx,
  BENCHMARK_MINUTES,
} from '../../src/services/aiSavingsService.js';

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-savings-test-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── computeTimeSavedMinutes ──────────────────────────────────────────────────
describe('computeTimeSavedMinutes()', () => {
  test('multiplies per-item benchmark by item count', () => {
    assert.equal(computeTimeSavedMinutes('story_push', 3), BENCHMARK_MINUTES.story_push * 3);
    assert.equal(computeTimeSavedMinutes('bug_create', 2), BENCHMARK_MINUTES.bug_create * 2);
  });

  test('doc_ai_run is a flat benchmark regardless of item count', () => {
    assert.equal(computeTimeSavedMinutes('doc_ai_run', 1), BENCHMARK_MINUTES.doc_ai_run);
    assert.equal(computeTimeSavedMinutes('doc_ai_run', 10), BENCHMARK_MINUTES.doc_ai_run);
  });
});

// ── isValidActionType ────────────────────────────────────────────────────────
describe('isValidActionType()', () => {
  test('accepts all known action types', () => {
    for (const type of Object.keys(BENCHMARK_MINUTES)) {
      assert.equal(isValidActionType(type), true);
    }
  });

  test('rejects unknown action types', () => {
    assert.equal(isValidActionType('not_a_real_type'), false);
  });
});

// ── createAiSavingsService ───────────────────────────────────────────────────
describe('createAiSavingsService()', () => {
  test('getAll returns an empty log when no file exists yet', async () => {
    const svc = createAiSavingsService(path.join(tmpDir, 'empty-root'));
    const { entries, totalMinutes } = await svc.getAll();
    assert.deepEqual(entries, []);
    assert.equal(totalMinutes, 0);
  });

  test('appendEntry persists an entry and computes time_saved_minutes', async () => {
    const root = path.join(tmpDir, 'append-root');
    const svc = createAiSavingsService(root);
    const entry = await svc.appendEntry({
      action_type: 'story_push',
      item_count: 2,
      jira_keys: ['MIDAS-1', 'MIDAS-2'],
    });
    assert.ok(entry.id);
    assert.ok(entry.timestamp);
    assert.equal(entry.action_type, 'story_push');
    assert.equal(entry.item_count, 2);
    assert.equal(entry.time_saved_minutes, BENCHMARK_MINUTES.story_push * 2);
    assert.deepEqual(entry.jira_keys, ['MIDAS-1', 'MIDAS-2']);

    // File was created on first write
    assert.ok(fs.existsSync(path.join(root, 'data', 'ai-savings.json')));

    const { entries, totalMinutes } = await svc.getAll();
    assert.equal(entries.length, 1);
    assert.equal(totalMinutes, BENCHMARK_MINUTES.story_push * 2);
  });

  test('appendEntry rejects an invalid action_type', async () => {
    const svc = createAiSavingsService(path.join(tmpDir, 'invalid-root'));
    await assert.rejects(() => svc.appendEntry({ action_type: 'bogus', item_count: 1 }));
  });

  test('appendEntry defaults jira_keys and notes when omitted', async () => {
    const svc = createAiSavingsService(path.join(tmpDir, 'defaults-root'));
    const entry = await svc.appendEntry({ action_type: 'doc_ai_run', item_count: 1 });
    assert.deepEqual(entry.jira_keys, []);
    assert.equal(entry.notes, '');
  });

  test('multiple appendEntry calls accumulate in order', async () => {
    const svc = createAiSavingsService(path.join(tmpDir, 'accumulate-root'));
    await svc.appendEntry({ action_type: 'bug_create', item_count: 1 });
    await svc.appendEntry({ action_type: 'doc_confluence_modify', item_count: 3 });
    const { entries, totalMinutes } = await svc.getAll();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].action_type, 'bug_create');
    assert.equal(entries[1].action_type, 'doc_confluence_modify');
    assert.equal(
      totalMinutes,
      BENCHMARK_MINUTES.bug_create + BENCHMARK_MINUTES.doc_confluence_modify * 3
    );
  });
});

// ── Report builders ──────────────────────────────────────────────────────────
describe('buildSavingsPdf()', () => {
  test('produces a valid PDF buffer for an empty log', async () => {
    const buffer = await buildSavingsPdf([], 0);
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  });

  test('produces a valid PDF buffer for a populated log', async () => {
    const entries = [
      {
        id: '1',
        timestamp: new Date().toISOString(),
        action_type: 'story_push',
        item_count: 2,
        jira_keys: ['MIDAS-1'],
        time_saved_minutes: 30,
        notes: '',
      },
    ];
    const buffer = await buildSavingsPdf(entries, 30);
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  });
});

describe('buildSavingsPptx()', () => {
  test('produces a valid PPTX (zip) buffer for an empty log', async () => {
    const buffer = await buildSavingsPptx([], 0);
    assert.ok(Buffer.isBuffer(buffer));
    // PPTX files are zip archives, signature starts with "PK"
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  });

  test('produces a valid PPTX buffer for a populated log', async () => {
    const entries = [
      {
        id: '1',
        timestamp: new Date().toISOString(),
        action_type: 'bug_create',
        item_count: 1,
        jira_keys: [],
        time_saved_minutes: 10,
        notes: '',
      },
    ];
    const buffer = await buildSavingsPptx(entries, 10);
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  });
});
