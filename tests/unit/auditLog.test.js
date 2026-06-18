// ── Unit tests: auditLog ───────────────────────────────────────────────────────
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpDir;
let auditPath;
let logAudit;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
  auditPath = path.join(tmpDir, 'audit.log');
  process.env.AUDIT_LOG_PATH = auditPath;
  // Dynamic import after env var is set so the module picks it up
  ({ logAudit } = await import('../../src/utils/auditLog.js'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AUDIT_LOG_PATH;
});

beforeEach(() => {
  // Reset log between tests
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
});

function waitForWrite() {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

function readEvents() {
  if (!fs.existsSync(auditPath)) return [];
  return fs
    .readFileSync(auditPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('auditLog', () => {
  test('writes a JSON event to the log file', async () => {
    logAudit({ op: 'create', docType: 'epic', filename: 'test.md', source: 'api' });
    await waitForWrite();
    const events = readEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].op, 'create');
    assert.equal(events[0].docType, 'epic');
    assert.equal(events[0].filename, 'test.md');
    assert.equal(events[0].source, 'api');
    assert.ok(typeof events[0].ts === 'string', 'ts should be a string');
  });

  test('appends multiple events', async () => {
    logAudit({ op: 'create', docType: 'story', filename: 'a.md', source: 'api' });
    logAudit({ op: 'delete', docType: 'story', filename: 'a.md', source: 'api' });
    await waitForWrite();
    const events = readEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].op, 'create');
    assert.equal(events[1].op, 'delete');
  });

  test('includes optional fields object when provided', async () => {
    logAudit({
      op: 'update',
      docType: 'epic',
      filename: 'x.md',
      fields: { status: 'Archived' },
      source: 'api',
    });
    await waitForWrite();
    const events = readEvents();
    assert.deepEqual(events[0].fields, { status: 'Archived' });
  });

  test('does nothing when AUDIT_LOG_PATH is "none"', async () => {
    const orig = process.env.AUDIT_LOG_PATH;
    process.env.AUDIT_LOG_PATH = 'none';
    logAudit({ op: 'create', docType: 'epic', filename: 'noop.md', source: 'api' });
    await waitForWrite();
    assert.ok(!fs.existsSync(auditPath), 'log file should not be created when path is "none"');
    process.env.AUDIT_LOG_PATH = orig;
  });
});
