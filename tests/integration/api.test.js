// ── Integration tests: core API flows ─────────────────────────────────────────
// Covers: generate doc, update status, get doc, delete doc, get links.
// Claude calls are intercepted via MOCK_CLAUDE=1 (set in startTestApp).
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

// ── GET /api/docs ─────────────────────────────────────────────────────────────
describe('GET /api/docs', () => {
  test('returns 200 with an array', async () => {
    const { status, data } = await api('GET', '/api/docs');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
  });
});

// ── POST /api/generate ────────────────────────────────────────────────────────
describe('POST /api/generate', () => {
  test('returns 400 when idea is missing', async () => {
    const { status, data } = await api('POST', '/api/generate', { type: 'epic' });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('returns 400 for an invalid doc type', async () => {
    const { status, data } = await api('POST', '/api/generate', { idea: 'Test', type: 'bogus' });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'INVALID_TYPE');
  });

  test('creates an epic and returns filename + docType', async () => {
    const { status, data } = await api('POST', '/api/generate', {
      idea: 'As a user I want to search tests',
      title: 'Search Tests',
      type: 'epic',
      priority: 'High',
    });
    assert.equal(status, 200);
    assert.ok(data.filename, 'filename should be set');
    assert.equal(data.docType, 'epic');
    // The generated file should exist on disk
    const filePath = path.join(docsRoot, 'epics', data.filename);
    assert.ok(fs.existsSync(filePath), `expected ${filePath} to exist`);
  });

  test('creates a story', async () => {
    const { status, data } = await api('POST', '/api/generate', {
      idea: 'As a test engineer I want to filter by date',
      type: 'story',
    });
    assert.equal(status, 200);
    assert.equal(data.docType, 'story');
  });

  test('creates a spike', async () => {
    const { status, data } = await api('POST', '/api/generate', {
      idea: 'Investigate RabbitMQ throughput limits',
      type: 'spike',
    });
    assert.equal(status, 200);
    assert.equal(data.docType, 'spike');
  });
});

// ── GET /api/doc/:type/:filename ──────────────────────────────────────────────
describe('GET /api/doc/:type/:filename', () => {
  let createdFilename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', {
      idea: 'Get doc test idea',
      title: 'Get Doc Epic',
      type: 'epic',
    });
    createdFilename = data.filename;
  });

  test('returns 200 with content for an existing doc', async () => {
    const { status, data } = await api('GET', `/api/doc/epic/${encodeURIComponent(createdFilename)}`);
    assert.equal(status, 200);
    assert.equal(data.filename, createdFilename);
    assert.ok(typeof data.content === 'string');
  });

  test('returns 404 for a non-existent doc', async () => {
    const { status, data } = await api('GET', '/api/doc/epic/does-not-exist.md');
    assert.equal(status, 404);
    assert.equal(data.error.code, 'NOT_FOUND');
  });

  test('returns 400 for an invalid type', async () => {
    const { status } = await api('GET', '/api/doc/bogus/test.md');
    assert.equal(status, 400);
  });
});

// ── PATCH /api/doc/:type/:filename ── update status ──────────────────────────
describe('PATCH /api/doc/:type/:filename — update status', () => {
  let filename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', {
      idea: 'Status update test',
      title: 'Status Epic',
      type: 'epic',
    });
    filename = data.filename;
  });

  test('updates status to Archived and returns success', async () => {
    const { status, data } = await api('PATCH', `/api/doc/epic/${encodeURIComponent(filename)}`, {
      status: 'Archived',
    });
    assert.equal(status, 200);
    assert.equal(data.status, 'Archived');
  });

  test('persists the new status in the file', async () => {
    await api('PATCH', `/api/doc/epic/${encodeURIComponent(filename)}`, { status: 'Created in JIRA' });
    const { data } = await api('GET', `/api/doc/epic/${encodeURIComponent(filename)}`);
    assert.match(data.content, /^Status: Created in JIRA$/m);
  });

  test('returns 400 for an invalid status value', async () => {
    const { status, data } = await api('PATCH', `/api/doc/epic/${encodeURIComponent(filename)}`, {
      status: 'WrongStatus',
    });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'INVALID_STATUS');
  });

  test('returns 404 when doc does not exist', async () => {
    const { status } = await api('PATCH', '/api/doc/epic/ghost.md', { status: 'Draft' });
    assert.equal(status, 404);
  });
});

// ── DELETE /api/doc/:type/:filename ───────────────────────────────────────────
describe('DELETE /api/doc/:type/:filename', () => {
  let filename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', {
      idea: 'Delete me',
      type: 'epic',
    });
    filename = data.filename;
  });

  test('deletes the document and returns success', async () => {
    const { status, data } = await api('DELETE', `/api/doc/epic/${encodeURIComponent(filename)}`);
    assert.equal(status, 200);
    assert.equal(data.success, true);
  });

  test('returns 404 after deletion', async () => {
    const { status } = await api('GET', `/api/doc/epic/${encodeURIComponent(filename)}`);
    assert.equal(status, 404);
  });
});

// ── GET /api/links/:type/:filename ────────────────────────────────────────────
describe('GET /api/links/:type/:filename', () => {
  test('returns parent: null and children: [] for an unlinked epic', async () => {
    const { data: gen } = await api('POST', '/api/generate', {
      idea: 'Unlinked epic for hierarchy test',
      type: 'epic',
    });
    const { status, data } = await api('GET', `/api/links/epic/${encodeURIComponent(gen.filename)}`);
    assert.equal(status, 200);
    assert.equal(data.parent, null);
    assert.ok(Array.isArray(data.children));
  });

  test('returns 400 for an invalid doc type', async () => {
    const { status } = await api('GET', '/api/links/bogus/test.md');
    assert.equal(status, 400);
  });
});
