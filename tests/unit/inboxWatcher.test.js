// ── Unit tests: inboxWatcher retry logic ──────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpDir, inboxDir, epicsDir;
const watchers = [];

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-test-'));
  inboxDir = path.join(tmpDir, 'inbox');
  epicsDir = path.join(tmpDir, 'epics');
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(epicsDir, { recursive: true });
  process.env.INBOX_MAX_RETRIES = '2';
  process.env.AUDIT_LOG_PATH = 'none';
});

after(() => {
  watchers.forEach((w) => w.close());
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.INBOX_MAX_RETRIES;
  delete process.env.AUDIT_LOG_PATH;
});

function makeOptions({ callClaude }) {
  const infos = [];
  const errors = [];
  const broadcasts = [];
  return {
    INBOX_DIR: inboxDir,
    EPICS_DIR: epicsDir,
    DOC_DIRS: [epicsDir],
    isClaimedByApi: () => false,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    loadCommand: () => null,
    callClaude,
    broadcast: (evt) => broadcasts.push(evt),
    logInfo: (_ctx, msg) => infos.push(msg),
    logError: (_ctx, msg) => errors.push(msg),
    infos,
    errors,
    broadcasts,
  };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('inboxWatcher retry', () => {
  test('successfully processes an inbox file on first attempt', async () => {
    // Write a test inbox file BEFORE calling watchInbox so the scan picks it up
    const filename = 'test-success.md';
    fs.writeFileSync(path.join(inboxDir, filename), '# Test Epic\nContent here');

    const opts = makeOptions({ callClaude: async () => '# Generated Epic\nBody' });

    // Dynamic import after env vars are set
    const { watchInbox } = await import('../../src/services/inboxWatcher.js');
    watchers.push(watchInbox(opts));

    // Wait for async processing
    await wait(500);

    assert.ok(fs.existsSync(path.join(epicsDir, filename)), 'epic file should be created');
    assert.ok(opts.broadcasts.some((e) => e.type === 'epic_created'));
  });

  test('retries on failure then moves to errors dir after max retries', async () => {
    const filename = 'test-fail.md';
    fs.writeFileSync(path.join(inboxDir, filename), '# Fail Epic');

    let calls = 0;
    const opts = makeOptions({
      callClaude: async () => {
        calls++;
        throw new Error('Claude unavailable');
      },
    });

    const { watchInbox } = await import('../../src/services/inboxWatcher.js');
    watchers.push(watchInbox(opts));

    // Wait for retries (2 retries × 2s backoff + processing time)
    await wait(6000);

    assert.equal(calls, 2, 'should have tried exactly INBOX_MAX_RETRIES=2 times');
    assert.ok(!fs.existsSync(path.join(inboxDir, filename)), 'file should not remain in inbox');
    assert.ok(
      fs.existsSync(path.join(inboxDir, 'errors', filename)),
      'file should be in errors dir'
    );
    assert.ok(
      fs.existsSync(path.join(inboxDir, 'errors', `${filename}.error.json`)),
      'error JSON should exist'
    );

    const errorMeta = JSON.parse(
      fs.readFileSync(path.join(inboxDir, 'errors', `${filename}.error.json`), 'utf-8')
    );
    assert.equal(errorMeta.attempts, 2);
    assert.ok(errorMeta.lastError.includes('Claude unavailable'));
    assert.ok(errorMeta.timestamp);

    assert.ok(opts.broadcasts.some((e) => e.type === 'inbox-error' && e.filename === filename));
  });
});
