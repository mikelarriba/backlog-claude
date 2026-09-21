// ── Integration tests: POST /api/jira/pull ─────────────────────────────────────
// Added alongside the #669 refactor that split the previously fully-sequential
// per-key loop into a pMap-parallelized JIRA fetch pass followed by a
// sequential filesystem-write/rank-assignment pass. These tests pin the
// behavior that refactor must preserve: conflict detection short-circuits the
// JIRA fetch, overwrites reuse the existing filename/rank, fresh imports get
// sequential incrementing ranks (each reading the previous import's write),
// and multiple keys are fetched concurrently while still returning results in
// the original request order.
import { test, describe, before, after, mock } from 'node:test';
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

function writeDoc(subdir, filename, content) {
  const dir = path.join(docsRoot, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

function readDoc(subdir, filename) {
  return fs.readFileSync(path.join(docsRoot, subdir, filename), 'utf8');
}

function fieldOf(content, field) {
  const m = content.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'));
  if (!m) return undefined;
  return m[1].trim().replace(/^'(.*)'$/, '$1');
}

describe('POST /api/jira/pull — happy path (single new import)', () => {
  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    fetchedUrls.length = 0;
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      fetchedUrls.push(urlStr);
      const body = {
        key: 'EAMDM-950',
        fields: {
          summary: 'A freshly pulled story',
          issuetype: { name: 'Story' },
          description: 'Body text.',
          labels: [],
        },
      };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('creates a new local doc with Rank 1 and TBD Fix_Version/Sprint', async () => {
    const { status, data } = await api('POST', '/api/jira/pull', { keys: ['EAMDM-950'] });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.conflicts.length, 0);
    assert.equal(data.pulled.length, 1);
    assert.equal(data.pulled[0].key, 'EAMDM-950');
    assert.equal(data.pulled[0].docType, 'story');
    assert.equal(fetchedUrls.length, 1);

    const content = readDoc('stories', data.pulled[0].filename);
    assert.equal(fieldOf(content, 'Rank'), '1');
    assert.equal(fieldOf(content, 'Fix_Version'), 'TBD');
    assert.equal(fieldOf(content, 'Sprint'), 'TBD');
    assert.equal(fieldOf(content, 'Team'), 'TBD');
  });
});

describe('POST /api/jira/pull — conflict detection skips the JIRA fetch', () => {
  const originalFetch = globalThis.fetch;
  const EXISTING_FILE = '2026-01-15-pull-conflict-existing.md';
  const fetchedUrls = [];

  before(async () => {
    writeDoc(
      'stories',
      EXISTING_FILE,
      `---
JIRA_ID: EAMDM-951
Story_Points: 3
Status: In Progress
Priority: Medium
Rank: 7
Created: 2026-01-15
---

## Existing local story

Body.
`
    );
    await api('POST', '/api/docs/rebuild-index');

    process.env.JIRA_API_TOKEN = 'fake-test-token';
    fetchedUrls.length = 0;
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      fetchedUrls.push(urlStr);
      return { ok: true, status: 404, json: async () => ({}), text: async () => '{}' };
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('reports the conflict without hitting JIRA', async () => {
    const { status, data } = await api('POST', '/api/jira/pull', { keys: ['EAMDM-951'] });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.pulled.length, 0);
    assert.equal(data.conflicts.length, 1);
    assert.equal(data.conflicts[0].key, 'EAMDM-951');
    assert.equal(data.conflicts[0].existingFilename, EXISTING_FILE);
    assert.equal(fetchedUrls.length, 0);
  });
});

describe('POST /api/jira/pull — overwrite reuses the existing filename and Rank', () => {
  const originalFetch = globalThis.fetch;
  const EXISTING_FILE = '2026-01-15-pull-overwrite-existing.md';

  before(async () => {
    writeDoc(
      'stories',
      EXISTING_FILE,
      `---
JIRA_ID: EAMDM-952
Story_Points: 3
Status: In Progress
Priority: Medium
Rank: 9
Created: 2026-01-15
---

## Existing local story

Body.
`
    );
    await api('POST', '/api/docs/rebuild-index');

    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      const body = {
        key: 'EAMDM-952',
        fields: {
          summary: 'Updated summary from JIRA',
          issuetype: { name: 'Story' },
          description: 'Updated body.',
          labels: [],
        },
      };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('overwrites the existing file in place and keeps its Rank', async () => {
    const { status, data } = await api('POST', '/api/jira/pull', {
      keys: ['EAMDM-952'],
      overwriteKeys: ['EAMDM-952'],
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.conflicts.length, 0);
    assert.equal(data.pulled.length, 1);
    assert.equal(data.pulled[0].filename, EXISTING_FILE);

    const content = readDoc('stories', EXISTING_FILE);
    assert.equal(fieldOf(content, 'Rank'), '9');
  });
});

describe('POST /api/jira/pull — fetches multiple keys concurrently, writes ranks in order', () => {
  const originalFetch = globalThis.fetch;
  const KEYS = ['EAMDM-960', 'EAMDM-961', 'EAMDM-962'];
  const fetchedUrls = [];

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    fetchedUrls.length = 0;
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      fetchedUrls.push(urlStr);
      const key = KEYS.find((k) => urlStr.includes(`/issue/${k}`));
      // Resolve the *last*-requested key first so a naive sequential
      // implementation (or one that wrote in fetch-completion order) would
      // surface a reordering bug immediately.
      const delayMs = key === KEYS[KEYS.length - 1] ? 0 : 15;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const body = {
        key,
        fields: { summary: `Story ${key}`, issuetype: { name: 'Story' }, labels: [] },
      };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns all three pulled in request order with strictly incrementing ranks', async () => {
    const { status, data } = await api('POST', '/api/jira/pull', { keys: KEYS });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(
      data.conflicts.length,
      0,
      `Unexpected conflicts: ${JSON.stringify(data.conflicts)}, pulled: ${JSON.stringify(data.pulled)}`
    );
    assert.equal(data.pulled.length, KEYS.length, `data: ${JSON.stringify(data)}`);
    assert.deepEqual(
      data.pulled.map((p) => p.key),
      KEYS
    );
    assert.equal(fetchedUrls.length, KEYS.length);

    const ranks = data.pulled.map((p) => Number(fieldOf(readDoc('stories', p.filename), 'Rank')));
    assert.deepEqual(
      ranks,
      [...ranks].sort((a, b) => a - b)
    );
    assert.equal(new Set(ranks).size, ranks.length);
  });
});
