// ── Integration tests: POST /api/jira/pull-preview ────────────────────────────
// pull-preview previously had no test coverage — added alongside the #456
// jira-sync.ts service-layer refactor since the file was already being touched.
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers/testApp.js';

let api, stop;

before(async () => {
  ({ api, stop } = await startTestApp());
});

after(async () => {
  await stop();
});

describe('POST /api/jira/pull-preview — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api('POST', '/api/jira/pull-preview', {
      jiraKey: 'EAMDM-1',
    });
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});

describe('POST /api/jira/pull-preview — validation', () => {
  test('returns 400 when jiraKey is missing', async () => {
    const { status, data } = await api('POST', '/api/jira/pull-preview', {});
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });
});

describe('POST /api/jira/pull-preview — happy path (single issue, no children)', () => {
  const originalFetch = globalThis.fetch;

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      const body = {
        key: 'EAMDM-900',
        fields: {
          summary: 'A story pulled from JIRA',
          issuetype: { name: 'Story' },
          description: 'Some description text.',
          issuelinks: [],
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

  test('returns a single preview item describing a new local doc to be created', async () => {
    const { status, data } = await api('POST', '/api/jira/pull-preview', {
      jiraKey: 'EAMDM-900',
    });
    assert.equal(status, 200);
    assert.equal(data.items.length, 1);
    const item = data.items[0];
    assert.equal(item.jiraKey, 'EAMDM-900');
    assert.equal(item.jiraTitle, 'A story pulled from JIRA');
    assert.equal(item.jiraType, 'Story');
    assert.equal(item.localFilename, null);
    assert.equal(item.action, 'create');
  });
});
