// ── Integration tests: file-system error scenarios ────────────────────────────
// Verifies graceful handling when files disappear from disk after indexing.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestApp } from '../helpers/testApp.js';

let api, stop, docsRoot;

before(async () => {
  ({ api, stop, docsRoot } = await startTestApp());
});

after(async () => {
  await stop();
});

describe('GET /api/doc — file deleted from disk after indexing', () => {
  test('returns 404 when the file no longer exists on disk', async () => {
    // 1. Create a draft doc (goes into index)
    const { status: cs, data: cd } = await api('POST', '/api/docs/draft', {
      title: 'Ghost Epic',
      type: 'epic',
    });
    assert.equal(cs, 200);
    const { filename } = cd;

    // 2. Delete the file from disk directly (bypassing the API / index)
    const filepath = path.join(docsRoot, 'epics', filename);
    assert.ok(fs.existsSync(filepath), 'file should exist after creation');
    fs.unlinkSync(filepath);

    // 3. GET the doc — should return 404, not 500
    const { status: gs, data: gd } = await api('GET', `/api/doc/epic/${encodeURIComponent(filename)}`);
    assert.equal(gs, 404);
    assert.equal(gd.error.code, 'NOT_FOUND');
  });

  test('server remains healthy after a missing-file 404', async () => {
    // A subsequent valid request must still work
    const { status } = await api('GET', '/api/docs');
    assert.equal(status, 200);
  });
});

describe('PATCH /api/doc — file deleted between index lookup and write', () => {
  test('returns 404 gracefully when the target file is gone', async () => {
    // Create a doc, then delete it, then try to PATCH
    const { data: cd } = await api('POST', '/api/docs/draft', {
      title: 'Gone Before Patch',
      type: 'story',
    });
    const { filename } = cd;

    const filepath = path.join(docsRoot, 'stories', filename);
    fs.unlinkSync(filepath);

    const { status, data } = await api('PATCH', `/api/doc/story/${encodeURIComponent(filename)}`, {
      status: 'Archived',
    });
    assert.equal(status, 404);
    assert.equal(data.error.code, 'NOT_FOUND');
  });
});

describe('DELETE /api/doc — file already absent', () => {
  test('returns 404 when trying to delete a non-existent file', async () => {
    const { status, data } = await api('DELETE', '/api/doc/epic/2099-01-01-ghost-epic.md');
    assert.equal(status, 404);
    assert.equal(data.error.code, 'NOT_FOUND');
  });
});
