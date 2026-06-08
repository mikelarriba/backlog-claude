// ── Integration tests: /api/v1/ versioning alias ──────────────────────────────
// Verifies that /api/v1/* returns identical responses to /api/* so clients
// can migrate to the versioned endpoint at their own pace.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers/testApp.js';

let api, stop;

before(async () => {
  ({ api, stop } = await startTestApp());
});

after(async () => {
  await stop();
});

describe('/api/v1/ — versioned endpoint alias', () => {
  test('GET /api/v1/docs returns 200 with array (same as /api/docs)', async () => {
    const v0 = await api('GET', '/api/docs');
    const v1 = await api('GET', '/api/v1/docs');
    assert.equal(v1.status, 200);
    assert.ok(Array.isArray(v1.data), '/api/v1/docs should return an array');
    // Same result length (no docs yet)
    assert.equal(v1.data.length, v0.data.length);
  });

  test('GET /api/v1/docs/:type/:filename returns same 404 as /api/', async () => {
    const { status } = await api('GET', '/api/v1/doc/epic/nonexistent-file.md');
    assert.equal(status, 404);
  });

  test('POST /api/v1/docs/draft creates a doc just like /api/docs/draft', async () => {
    const { status, data } = await api('POST', '/api/v1/docs/draft', {
      title: 'Versioned Endpoint Test',
      type: 'epic',
    });
    assert.equal(status, 200);
    assert.ok(data.filename, 'filename should be returned');
    assert.equal(data.docType, 'epic');
  });

  test('POST /api/v1/generate accepts and handles missing idea (same 400)', async () => {
    const { status, data } = await api('POST', '/api/v1/generate', { type: 'epic' });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('/api/ and /api/v1/ paths share state (doc created via v1 appears in /api/docs)', async () => {
    // Create via v1
    const { data: created } = await api('POST', '/api/v1/docs/draft', {
      title: 'State Sharing Test',
      type: 'story',
    });
    const filename = created.filename;

    // Read via v0
    const { status, data: doc } = await api(
      'GET',
      `/api/doc/story/${encodeURIComponent(filename)}`
    );
    assert.equal(status, 200);
    assert.equal(doc.filename, filename);
  });
});
