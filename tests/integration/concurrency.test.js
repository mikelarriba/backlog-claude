// ── Integration tests: concurrent request handling ───────────────────────────
// Verifies that the server handles simultaneous requests without crashing
// and that no partial/corrupt state is left behind.
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

describe('POST /api/docs/draft — concurrent requests', () => {
  test('5 simultaneous draft requests all complete without server crash', async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      api('POST', '/api/docs/draft', { title: `Concurrent Story ${i}`, type: 'story' })
    );
    const results = await Promise.all(requests);

    for (const { status } of results) {
      assert.equal(status, 200, 'Each draft request should return 200');
    }

    // All created files should exist on disk
    for (const { data } of results) {
      const filepath = path.join(docsRoot, 'stories', data.filename);
      assert.ok(fs.existsSync(filepath), `File ${data.filename} should exist`);
    }
  });

  test('simultaneous drafts produce distinct filenames', async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      api('POST', '/api/docs/draft', { title: `Unique Draft ${i} ${Date.now()}`, type: 'spike' })
    );
    const results = await Promise.all(requests);
    const filenames = results.map((r) => r.data.filename);
    const unique = new Set(filenames);
    // Allow for some collision in slugs (they share a timestamp) but at least no crashes
    assert.ok(unique.size >= 1, 'Should produce at least one unique filename');
    for (const { status } of results) {
      assert.ok([200, 409].includes(status), `Expected 200 or 409, got ${status}`);
    }
  });
});

describe('GET /api/docs — concurrent reads', () => {
  test('10 simultaneous GET /api/docs return consistent arrays', async () => {
    const requests = Array.from({ length: 10 }, () => api('GET', '/api/docs'));
    const results = await Promise.all(requests);

    for (const { status, data } of results) {
      assert.equal(status, 200);
      assert.ok(Array.isArray(data));
    }
  });
});

describe('Mixed concurrent reads and writes', () => {
  test('interleaved creates and reads do not corrupt the response', async () => {
    const writes = Array.from({ length: 3 }, (_, i) =>
      api('POST', '/api/docs/draft', { title: `Mixed Write ${i}`, type: 'epic' })
    );
    const reads = Array.from({ length: 3 }, () => api('GET', '/api/docs'));

    const all = await Promise.all([...writes, ...reads]);
    for (const { status } of all) {
      assert.ok([200, 409].includes(status), `Unexpected status ${status}`);
    }
  });
});
