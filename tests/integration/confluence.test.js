// ── Integration tests: POST /api/confluence/analyze ───────────────────────────
// JIRA_API_TOKEN is set to '' by startTestApp → validation-only tests exercise
// the 503 JIRA_NOT_CONFIGURED guard. Happy-path/unreachable-issue tests stub
// globalThis.fetch for JIRA URL patterns only, same pattern as jira.test.js /
// jira-board-sprints-mocked.test.js.
//
// The AI call itself is intercepted via mock.module() on claudeService.ts
// rather than relying on MOCK_CLAUDE=1 (set by startTestApp): MOCK_CLAUDE
// returns a fixed markdown string, not JSON, so it can't produce a parseable
// `suggestions` response for the happy-path test. mock.module() must be
// called before the first startTestApp() (i.e. first dynamic import of
// server.ts) in this process — see tests/helpers/mockRoadmapDeps.js for the
// same pattern applied to frontend modules.
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers/testApp.js';

// Mutable so individual tests can control what the "AI" returns without
// needing a fresh process per test. Read lazily inside the mocked callClaude.
let mockClaudeResponse = '[]';

mock.module('../../src/services/claudeService.ts', {
  namedExports: {
    callClaude: async () => mockClaudeResponse,
    streamClaude: async (_prompt, onChunk) => onChunk(mockClaudeResponse),
    loadCommand: () => null,
    loadCommandRaw: () => null,
    loadProductContext: () => ({ content: '', source: 'example' }),
    // Real fence-stripping logic (mirrors src/services/providers/claudeCli.ts)
    // so confluence.ts's own `normalizeOutput` import keeps working under the
    // mock — mocking the module replaces *all* of its named exports.
    normalizeOutput: (content) => {
      let c = content.trim();
      c = c.replace(/^```[\w]+\n(---[\s\S]*?---)\n```\n?/, '$1\n');
      c = c.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
      return c.trim();
    },
    setModelOverride: () => {},
    getModelOverride: () => null,
    setProviderOverride: () => {},
    getProviderOverride: () => null,
    setEffortOverride: () => {},
    getEffortOverride: () => null,
    getAvailableProviders: () => [],
  },
});

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let api, stop;
const originalFetch = globalThis.fetch;

before(async () => {
  ({ api, stop } = await startTestApp());
});

after(async () => {
  mock.restoreAll();
  await stop();
});

// ── Request validation (no JIRA token needed — validation runs first) ────────
describe('POST /api/confluence/analyze — validation', () => {
  test('returns 400 when jiraIds is missing', async () => {
    const { status, data } = await api('POST', '/api/confluence/analyze', {});
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when jiraIds is an empty array', async () => {
    const { status, data } = await api('POST', '/api/confluence/analyze', { jiraIds: [] });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when jiraIds is not an array', async () => {
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: 'EAMDM-123',
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when jiraIds contains a non-string/blank entry', async () => {
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-123', ''],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });
});

// ── No JIRA token configured ──────────────────────────────────────────────────
describe('POST /api/confluence/analyze — no JIRA token configured', () => {
  test('returns 503 once jiraIds passes validation', async () => {
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-123'],
    });
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});

// ── Unreachable JIRA issue (JIRA fetch mocked to fail) ────────────────────────
describe('POST /api/confluence/analyze — unreachable JIRA issue', () => {
  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      if (urlStr.includes('/issue/EAMDM-404')) {
        return { ok: false, status: 404, text: async () => 'Issue Does Not Exist' };
      }
      return jsonRes({ fields: { summary: 'A reachable issue', description: 'Some description' } });
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns 400 listing the unreachable JIRA ID(s)', async () => {
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-1', 'EAMDM-404'],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'JIRA_ISSUE_UNREACHABLE');
    assert.ok(Array.isArray(data.details?.unreachable));
    assert.equal(data.details.unreachable.length, 1);
    assert.equal(data.details.unreachable[0].key, 'EAMDM-404');
  });
});

// ── Happy path (JIRA fetch mocked, AI response mocked to valid JSON) ─────────
describe('POST /api/confluence/analyze — happy path', () => {
  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mockClaudeResponse = JSON.stringify([
      {
        pageTitle: 'MIDAS Upload API',
        hierarchyPath: 'MIDAS > API Reference > Upload',
        action: 'Update',
        currentContent: '',
        proposedContent: 'Document the new bulk-upload endpoint added in EAMDM-123.',
      },
    ]);
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      return jsonRes({
        fields: {
          summary: 'Add bulk upload endpoint',
          description: 'h2. Summary\nAllow bulk upload of records via a new REST endpoint.',
        },
      });
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
    mockClaudeResponse = '[]';
  });

  test('returns 200 with a well-formed suggestions array', async () => {
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-123'],
    });
    assert.equal(status, 200);
    assert.equal(data.suggestions.length, 1);
    const s = data.suggestions[0];
    assert.equal(s.pageTitle, 'MIDAS Upload API');
    assert.equal(s.hierarchyPath, 'MIDAS > API Reference > Upload');
    assert.equal(s.action, 'Update');
    assert.equal(typeof s.currentContent, 'string');
    assert.match(s.proposedContent, /bulk-upload endpoint/);
  });
});

// ── Parallel JIRA fetch (issue #454: analyze uses pMap, not a serial loop) ───
describe('POST /api/confluence/analyze — multiple issues fetched in parallel', () => {
  let fetchedKeys;

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mockClaudeResponse = '[]';
    fetchedKeys = [];
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      const match = urlStr.match(/\/issue\/([^?]+)/);
      const key = match ? decodeURIComponent(match[1]) : 'unknown';
      fetchedKeys.push(key);
      return jsonRes({ fields: { summary: `Summary for ${key}`, description: '' } });
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
    mockClaudeResponse = '[]';
  });

  test('fetches every requested issue exactly once regardless of ordering', async () => {
    const jiraIds = ['EAMDM-1', 'EAMDM-2', 'EAMDM-3', 'EAMDM-4', 'EAMDM-5', 'EAMDM-6'];
    const { status } = await api('POST', '/api/confluence/analyze', { jiraIds });
    assert.equal(status, 200);
    assert.equal(fetchedKeys.length, jiraIds.length);
    assert.deepEqual([...fetchedKeys].sort(), [...jiraIds].sort());
  });
});

// ── Epic mode (#556): epics + closed children fetched as a union, grouped ────
describe('POST /api/confluence/analyze — epic mode (epics + closedChildKeys)', () => {
  let fetchedKeys;

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mockClaudeResponse = '[]';
    fetchedKeys = [];
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      const match = urlStr.match(/\/issue\/([^?]+)/);
      const key = match ? decodeURIComponent(match[1]) : 'unknown';
      fetchedKeys.push(key);
      return jsonRes({ fields: { summary: `Summary for ${key}`, description: '' } });
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
    mockClaudeResponse = '[]';
  });

  test('fetches the union of epic keys and closed child keys exactly once each', async () => {
    fetchedKeys = [];
    const { status } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-1', 'EAMDM-2'],
      epics: [
        { key: 'EAMDM-1', summary: 'Epic One', closedChildKeys: ['EAMDM-10', 'EAMDM-11'] },
        { key: 'EAMDM-2', summary: 'Epic Two', closedChildKeys: ['EAMDM-20'] },
      ],
    });
    assert.equal(status, 200);
    assert.deepEqual(
      [...fetchedKeys].sort(),
      ['EAMDM-1', 'EAMDM-10', 'EAMDM-11', 'EAMDM-2', 'EAMDM-20'].sort()
    );
  });

  test('an epic with an empty closedChildKeys array still resolves (epic-only, no children fetched)', async () => {
    fetchedKeys = [];
    const { status } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-3'],
      epics: [{ key: 'EAMDM-3', summary: 'Internal-only epic', closedChildKeys: [] }],
    });
    assert.equal(status, 200);
    assert.deepEqual(fetchedKeys, ['EAMDM-3']);
  });

  test('propagates the AI\'s empty-array "no changes" response through in epic mode', async () => {
    mockClaudeResponse = '[]';
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-4'],
      epics: [{ key: 'EAMDM-4', summary: 'Internal cleanup epic', closedChildKeys: ['EAMDM-40'] }],
    });
    assert.equal(status, 200);
    assert.deepEqual(data.suggestions, []);
  });

  test('a suggestion proposed from epic mode is returned like any other', async () => {
    mockClaudeResponse = JSON.stringify([
      {
        pageTitle: 'Auth Guide',
        hierarchyPath: 'MIDAS > Auth',
        action: 'Update',
        currentContent: '',
        proposedContent: 'Document the new SSO login flow shipped under EAMDM-1.',
      },
    ]);
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-1'],
      epics: [{ key: 'EAMDM-1', summary: 'Auth epic', closedChildKeys: ['EAMDM-10'] }],
    });
    assert.equal(status, 200);
    assert.equal(data.suggestions.length, 1);
    assert.equal(data.suggestions[0].pageTitle, 'Auth Guide');
  });

  test('an unreachable closed-child key is reported the same way an unreachable jiraId is', async () => {
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      if (urlStr.includes('/issue/EAMDM-404')) {
        return { ok: false, status: 404, text: async () => 'Issue Does Not Exist' };
      }
      return jsonRes({ fields: { summary: 'Reachable', description: '' } });
    });
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-5'],
      epics: [{ key: 'EAMDM-5', summary: 'Epic', closedChildKeys: ['EAMDM-404'] }],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'JIRA_ISSUE_UNREACHABLE');
    assert.equal(data.details.unreachable[0].key, 'EAMDM-404');
  });
});

// ── jiraIds-only requests (no `epics` key) still work exactly as before ──────
describe('POST /api/confluence/analyze — jiraIds-only requests still work exactly as before (#556 back-compat)', () => {
  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mockClaudeResponse = JSON.stringify([
      {
        pageTitle: 'Search Mode Page',
        hierarchyPath: 'MIDAS',
        action: 'Create',
        currentContent: '',
        proposedContent: 'New page from a flat jiraIds request.',
      },
    ]);
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      return jsonRes({ fields: { summary: 'A search-mode issue', description: '' } });
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
    mockClaudeResponse = '[]';
  });

  test('returns 200 with suggestions, unaffected by the new epics field being absent', async () => {
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-123'],
    });
    assert.equal(status, 200);
    assert.equal(data.suggestions.length, 1);
    assert.equal(data.suggestions[0].pageTitle, 'Search Mode Page');
  });
});

// ── Malformed AI response ─────────────────────────────────────────────────────
describe('POST /api/confluence/analyze — AI returns unparseable content', () => {
  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mockClaudeResponse = 'Sure! Here is my analysis: this is not JSON at all.';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      return jsonRes({ fields: { summary: 'Some issue', description: '' } });
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
    mockClaudeResponse = '[]';
  });

  test('returns 500 with a descriptive error', async () => {
    const { status, data } = await api('POST', '/api/confluence/analyze', {
      jiraIds: ['EAMDM-123'],
    });
    assert.equal(status, 500);
    assert.ok(data.error);
    assert.match(data.error, /unparseable|not valid JSON/i);
  });
});

// ── GET /api/confluence/test (connection test, added by #373) ────────────────
// The route reads process.env.CONFLUENCE_BASE_URL / CONFLUENCE_API_TOKEN
// directly (same pattern as the JIRA_API_TOKEN check above), so these env
// vars can be toggled mid-suite without needing a fresh startTestApp().
describe('GET /api/confluence/test — not configured', () => {
  test('returns 503 CONFLUENCE_NOT_CONFIGURED when env vars are unset', async () => {
    const { status, data } = await api('GET', '/api/confluence/test');
    assert.equal(status, 503);
    assert.equal(data.code, 'CONFLUENCE_NOT_CONFIGURED');
  });
});

describe('GET /api/confluence/test — configured, Confluence reachable', () => {
  before(() => {
    process.env.CONFLUENCE_BASE_URL = 'https://example.atlassian.net';
    process.env.CONFLUENCE_API_TOKEN = 'fake-confluence-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/wiki/')) return originalFetch(url, opts);
      return jsonRes({ id: '10', key: 'MIDAS' });
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.CONFLUENCE_BASE_URL;
    delete process.env.CONFLUENCE_API_TOKEN;
  });

  test('returns 200 with {ok:true, spaceKey}', async () => {
    const { status, data } = await api('GET', '/api/confluence/test');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.spaceKey, 'MIDAS');
  });
});

describe('GET /api/confluence/test — configured, Confluence unreachable', () => {
  before(() => {
    process.env.CONFLUENCE_BASE_URL = 'https://example.atlassian.net';
    process.env.CONFLUENCE_API_TOKEN = 'fake-confluence-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/wiki/')) return originalFetch(url, opts);
      return { ok: false, status: 401, text: async () => 'Unauthorized' };
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.CONFLUENCE_BASE_URL;
    delete process.env.CONFLUENCE_API_TOKEN;
  });

  test('returns 503 with {ok:false, error}', async () => {
    const { status, data } = await api('GET', '/api/confluence/test');
    assert.equal(status, 503);
    assert.equal(data.ok, false);
    assert.ok(data.error);
    assert.match(data.error, /401/);
  });
});

// ── POST /api/confluence/execute + POST /api/confluence/undo/:snapshotId ─────
// (added by #374). A small in-memory "Confluence" is modeled as a
// title-keyed Map so create/update/delete/get-by-title round-trip through the
// same fake state a real space would — this lets the undo tests assert the
// reversal actually restores prior content/version, not just that the right
// endpoints were hit. Every confluence*() call in src/services/confluenceService.ts
// goes through a URL containing '/wiki/', matching this file's existing mock
// convention (see the GET /api/confluence/test blocks above).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeConfluenceFetchMock(pages) {
  let nextId = 1000;
  return async (url, opts) => {
    const urlStr = String(url);
    if (!urlStr.includes('/wiki/')) return originalFetch(url, opts);
    const method = opts?.method || 'GET';

    if (urlStr.includes('/wiki/rest/api/space/')) {
      return jsonRes({ id: '10', key: 'MIDAS' });
    }

    if (urlStr.includes('/wiki/rest/api/content')) {
      const titleParam = decodeURIComponent(urlStr.match(/title=([^&]+)/)?.[1] || '');
      const page = pages.get(titleParam);
      if (!page) return jsonRes({ results: [] });
      return jsonRes({
        results: [
          {
            id: page.id,
            title: page.title,
            version: { number: page.version },
            body: { storage: { value: page.body } },
            space: { key: 'MIDAS' },
          },
        ],
      });
    }

    if (method === 'POST' && urlStr.endsWith('/wiki/api/v2/pages')) {
      const body = JSON.parse(opts.body);
      const id = String(nextId++);
      pages.set(body.title, { id, title: body.title, version: 1, body: body.body.value });
      return jsonRes({
        id,
        title: body.title,
        version: { number: 1 },
        body: { storage: { value: body.body.value } },
        space: { key: 'MIDAS' },
      });
    }

    const idMatch = urlStr.match(/\/wiki\/api\/v2\/pages\/([^/?]+)/);
    if (method === 'PUT' && idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      const body = JSON.parse(opts.body);
      let updated = null;
      for (const page of pages.values()) {
        if (page.id === id) {
          page.version = body.version.number;
          page.body = body.body.value;
          page.title = body.title;
          updated = page;
        }
      }
      return jsonRes({
        id,
        title: body.title,
        version: { number: updated?.version ?? body.version.number },
        body: { storage: { value: body.body.value } },
        space: { key: 'MIDAS' },
      });
    }

    if (method === 'DELETE' && idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      for (const [title, page] of pages) {
        if (page.id === id) pages.delete(title);
      }
      return jsonRes({});
    }

    return jsonRes({});
  };
}

describe('POST /api/confluence/execute — validation', () => {
  test('returns 400 when suggestions is missing', async () => {
    const { status, data } = await api('POST', '/api/confluence/execute', {});
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when suggestions is an empty array', async () => {
    const { status, data } = await api('POST', '/api/confluence/execute', { suggestions: [] });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when a suggestion has an invalid action', async () => {
    const { status, data } = await api('POST', '/api/confluence/execute', {
      suggestions: [{ pageTitle: 'Page A', action: 'Archive', proposedContent: '' }],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when a suggestion is missing pageTitle', async () => {
    const { status, data } = await api('POST', '/api/confluence/execute', {
      suggestions: [{ action: 'Create', proposedContent: '' }],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });
});

describe('POST /api/confluence/execute — not configured', () => {
  test('returns 503 once suggestions pass validation', async () => {
    const { status, data } = await api('POST', '/api/confluence/execute', {
      suggestions: [{ pageTitle: 'Page A', action: 'Create', proposedContent: '<p>hi</p>' }],
    });
    assert.equal(status, 503);
    assert.equal(data.code, 'CONFLUENCE_NOT_CONFIGURED');
  });
});

describe('POST /api/confluence/execute + undo — happy path (Create/Update/Delete, then full reversal)', () => {
  let pages;

  before(() => {
    process.env.CONFLUENCE_BASE_URL = 'https://example.atlassian.net';
    process.env.CONFLUENCE_API_TOKEN = 'fake-confluence-token';
    pages = new Map([
      [
        'Existing Update Page',
        { id: '1', title: 'Existing Update Page', version: 1, body: '<p>old</p>' },
      ],
      [
        'Existing Delete Page',
        { id: '2', title: 'Existing Delete Page', version: 1, body: '<p>bye</p>' },
      ],
    ]);
    mock.method(globalThis, 'fetch', makeConfluenceFetchMock(pages));
  });

  after(() => {
    mock.restoreAll();
    delete process.env.CONFLUENCE_BASE_URL;
    delete process.env.CONFLUENCE_API_TOKEN;
  });

  let snapshotId;

  test('execute applies Create/Update/Delete and returns a snapshotId', async () => {
    const { status, data } = await api('POST', '/api/confluence/execute', {
      suggestions: [
        { pageTitle: 'New Page', action: 'Create', proposedContent: '<p>new</p>' },
        { pageTitle: 'Existing Update Page', action: 'Update', proposedContent: '<p>updated</p>' },
        { pageTitle: 'Existing Delete Page', action: 'Delete', proposedContent: '' },
      ],
    });
    assert.equal(status, 200);
    assert.match(data.snapshotId, UUID_RE);
    assert.equal(data.results.length, 3);
    assert.ok(data.results.every((r) => r.success === true));

    // Confluence-side state actually changed.
    assert.ok(pages.has('New Page'));
    assert.equal(pages.get('Existing Update Page').body, '<p>updated</p>');
    assert.equal(pages.get('Existing Update Page').version, 1); // updatePage called with version=1 (page's version at execute time)
    assert.ok(!pages.has('Existing Delete Page'));

    snapshotId = data.snapshotId;
  });

  test('undo reverses all three operations in reverse order', async () => {
    const { status, data } = await api('POST', `/api/confluence/undo/${snapshotId}`);
    assert.equal(status, 200);
    assert.equal(data.results.length, 3);
    assert.ok(data.results.every((r) => r.success === true));
    // Reverse order: Delete-undo (re-create) resolves first, then Update-undo, then Create-undo.
    assert.equal(data.results[0].pageTitle, 'Existing Delete Page');
    assert.equal(data.results[1].pageTitle, 'Existing Update Page');
    assert.equal(data.results[2].pageTitle, 'New Page');

    // Confluence-side state fully reversed.
    assert.ok(!pages.has('New Page'), 'created page should be deleted by undo');
    assert.equal(pages.get('Existing Update Page').body, '<p>old</p>');
    assert.ok(pages.has('Existing Delete Page'), 'deleted page should be re-created by undo');
    assert.equal(pages.get('Existing Delete Page').body, '<p>bye</p>');
  });

  test('the snapshot is single-use — a second undo returns 404', async () => {
    const { status, data } = await api('POST', `/api/confluence/undo/${snapshotId}`);
    assert.equal(status, 404);
    assert.equal(data.code, 'SNAPSHOT_NOT_FOUND');
  });
});

describe('POST /api/confluence/execute — partial failure (one target page not found)', () => {
  let pages;

  before(() => {
    process.env.CONFLUENCE_BASE_URL = 'https://example.atlassian.net';
    process.env.CONFLUENCE_API_TOKEN = 'fake-confluence-token';
    pages = new Map();
    mock.method(globalThis, 'fetch', makeConfluenceFetchMock(pages));
  });

  after(() => {
    mock.restoreAll();
    delete process.env.CONFLUENCE_BASE_URL;
    delete process.env.CONFLUENCE_API_TOKEN;
  });

  test('still returns a snapshotId and processes the remaining suggestions', async () => {
    const { status, data } = await api('POST', '/api/confluence/execute', {
      suggestions: [
        { pageTitle: 'Page B', action: 'Create', proposedContent: '<p>b</p>' },
        { pageTitle: 'Missing Page', action: 'Update', proposedContent: '<p>x</p>' },
      ],
    });
    assert.equal(status, 200);
    assert.match(data.snapshotId, UUID_RE);
    assert.equal(data.results.length, 2);

    const created = data.results.find((r) => r.pageTitle === 'Page B');
    assert.equal(created.success, true);
    assert.ok(created.pageId);

    const missing = data.results.find((r) => r.pageTitle === 'Missing Page');
    assert.equal(missing.success, false);
    assert.match(missing.error, /not found/i);
  });

  // #539: execute now applies suggestions with bounded concurrency (pMap)
  // instead of one at a time — this asserts that parallelizing the batch
  // didn't lose the "one failing page doesn't block the others" guarantee,
  // and that results stay in source order regardless of completion order.
  test('a mixed batch with a failing page in the middle still applies every other suggestion, in source order', async () => {
    const { status, data } = await api('POST', '/api/confluence/execute', {
      suggestions: [
        { pageTitle: 'Page One', action: 'Create', proposedContent: '<p>1</p>' },
        { pageTitle: 'Missing Page 2', action: 'Delete', proposedContent: '' },
        { pageTitle: 'Page Three', action: 'Create', proposedContent: '<p>3</p>' },
        { pageTitle: 'Missing Page 4', action: 'Update', proposedContent: '<p>x</p>' },
        { pageTitle: 'Page Five', action: 'Create', proposedContent: '<p>5</p>' },
      ],
    });
    assert.equal(status, 200);
    assert.equal(data.results.length, 5);

    assert.deepEqual(
      data.results.map((r) => r.pageTitle),
      ['Page One', 'Missing Page 2', 'Page Three', 'Missing Page 4', 'Page Five']
    );
    assert.deepEqual(
      data.results.map((r) => r.success),
      [true, false, true, false, true]
    );
    for (const title of ['Page One', 'Page Three', 'Page Five']) {
      assert.ok(pages.has(title), `${title} should have been created`);
    }
  });
});

describe('POST /api/confluence/undo/:snapshotId — unknown snapshot', () => {
  test('returns 404 SNAPSHOT_NOT_FOUND for an id that was never issued', async () => {
    const { status, data } = await api(
      'POST',
      '/api/confluence/undo/00000000-0000-0000-0000-000000000000'
    );
    assert.equal(status, 404);
    assert.equal(data.code, 'SNAPSHOT_NOT_FOUND');
  });
});
