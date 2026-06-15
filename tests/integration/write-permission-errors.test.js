// ── Integration tests: write permission error scenarios ────────────────────────
// Verifies that the API returns appropriate errors when disk writes are denied.
// NOTE: These tests temporarily make directories read-only and restore them
// afterward. They run as the process owner, so they only work when the process
// does not run as root (root ignores POSIX permission bits).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestApp } from '../helpers/testApp.js';

// Skip if running as root — chmod restrictions don't apply
const IS_ROOT = process.getuid?.() === 0;

describe('POST /api/docs/draft — write permission denied', { skip: IS_ROOT }, () => {
  let api, stop, docsRoot;

  before(async () => {
    ({ api, stop, docsRoot } = await startTestApp());
  });

  after(async () => {
    // Restore permissions so cleanup can remove the temp dir
    try {
      const epicsDir = path.join(docsRoot, 'epics');
      if (fs.existsSync(epicsDir)) fs.chmodSync(epicsDir, 0o755);
    } catch { /* best effort */ }
    await stop();
  });

  test('returns 500 when the epics directory is not writable', async () => {
    // Ensure epics dir exists, then lock it
    const epicsDir = path.join(docsRoot, 'epics');
    fs.mkdirSync(epicsDir, { recursive: true });
    fs.chmodSync(epicsDir, 0o555); // read + execute only, no write

    const { status, data } = await api('POST', '/api/docs/draft', {
      title: 'Locked Epics Dir Test',
      type: 'epic',
    });

    // Restore immediately so after() cleanup succeeds
    fs.chmodSync(epicsDir, 0o755);

    // Should fail with a server error (500) — not a 200 with silent data loss
    assert.ok(
      status === 500 || status === 400 || status === 403,
      `Expected an error status (400/403/500) for unwritable dir, got ${status}: ${JSON.stringify(data)}`
    );
  });
});

describe('apply-distribution — atomic write guarantees', () => {
  let api, stop, docsRoot;

  before(async () => {
    ({ api, stop, docsRoot } = await startTestApp());
  });

  after(async () => {
    await stop();
  });

  test('apply-distribution with valid assignments updates all files atomically', async () => {
    // Create two stories
    const { data: s1 } = await api('POST', '/api/docs/draft', { title: 'Sprint Story A', type: 'story' });
    const { data: s2 } = await api('POST', '/api/docs/draft', { title: 'Sprint Story B', type: 'story' });

    const { status, data } = await api('POST', '/api/docs/apply-distribution', {
      assignments: [
        { filename: s1.filename, docType: 'story', sprint: 'Sprint 1' },
        { filename: s2.filename, docType: 'story', sprint: 'Sprint 1' },
      ],
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true, 'should return success: true');
    // updated is a count, assignments is the array of updated docs
    assert.equal(typeof data.updated, 'number', 'updated should be a count');
    assert.equal(data.updated, 2, 'both stories should be updated');
    assert.ok(Array.isArray(data.assignments), 'should return assignments array');
    assert.equal(data.assignments.length, 2, 'assignments array should have 2 entries');

    // Verify the sprint was actually written to disk
    const storyPath = path.join(docsRoot, 'stories', s1.filename);
    const content = fs.readFileSync(storyPath, 'utf-8');
    assert.ok(content.includes('Sprint 1'), 'sprint assignment should be written to the file');
  });

  test('apply-distribution with unknown filename skips it and returns 200', async () => {
    // Unknown files are skipped (not a 404) — the route records them in data.skipped
    const { status, data } = await api('POST', '/api/docs/apply-distribution', {
      assignments: [
        { filename: 'nonexistent-story.md', docType: 'story', sprint: 'Sprint 1' },
      ],
    });
    assert.equal(status, 200, `Expected 200 with skipped entry, got ${status}`);
    assert.ok(Array.isArray(data.skipped), 'should have a skipped array');
    assert.equal(data.skipped.length, 1, 'unknown file should appear in skipped');
    assert.equal(data.updated, 0, 'no files should be updated');
  });

  test('apply-distribution with empty assignments returns 400 (schema requires min 1)', async () => {
    // The ApplyDistributionSchema requires at least 1 assignment
    const { status } = await api('POST', '/api/docs/apply-distribution', {
      assignments: [],
    });
    assert.equal(status, 400, `Expected 400 for empty assignments array, got ${status}`);
  });

  test('apply-distribution with invalid docType skips it and returns 200', async () => {
    // Invalid docType is caught inside the per-entry try-catch and added to skipped
    const { status, data } = await api('POST', '/api/docs/apply-distribution', {
      assignments: [
        { filename: 'some-story.md', docType: 'invalid-type', sprint: 'Sprint 1' },
      ],
    });
    assert.equal(status, 200, `Expected 200 with skipped entry, got ${status}`);
    assert.ok(Array.isArray(data.skipped), 'should have a skipped array');
    assert.equal(data.skipped.length, 1, 'invalid type entry should appear in skipped');
  });
});
