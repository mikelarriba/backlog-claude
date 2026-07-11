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
