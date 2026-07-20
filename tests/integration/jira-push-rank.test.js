// ── Integration tests: POST /api/jira/push-rank (#421) ─────────────────────────
// This route mutates JIRA's backlog rank order via an external API call and had
// zero test coverage anywhere in the repo before this file. Covers: happy path
// (rank before / rank after), JIRA-error passthrough, and validation (missing
// key, missing beforeKey/afterKey — the latter is a cross-field business rule
// the Zod schema in schemas/jira.ts can't express, so it's still enforced by
// hand in the route and is covered here rather than in
// jira-push-validation.test.js).
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers/testApp.js';

let api, stop;
const originalFetch = globalThis.fetch;

before(async () => {
  ({ api, stop } = await startTestApp());
});

after(async () => {
  await stop();
});

describe('POST /api/jira/push-rank — guard clauses', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api('POST', '/api/jira/push-rank', {
      key: 'EAMDM-1',
      beforeKey: 'EAMDM-2',
    });
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});

describe('POST /api/jira/push-rank — validation', () => {
  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
  });
  after(() => {
    delete process.env.JIRA_API_TOKEN;
  });

  test('rejects a missing key', async () => {
    const { status, data } = await api('POST', '/api/jira/push-rank', { beforeKey: 'EAMDM-2' });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('rejects when neither beforeKey nor afterKey is given', async () => {
    const { status, data } = await api('POST', '/api/jira/push-rank', { key: 'EAMDM-1' });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.match(data.error, /beforeKey or afterKey/);
  });
});

describe('POST /api/jira/push-rank — happy path (JIRA fetch mocked)', () => {
  let lastRequest;

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    lastRequest = null;
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/rest/api/')) {
        lastRequest = { url: urlStr, method: opts?.method, body: opts?.body };
        return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('ranks an issue before another and echoes the request back', async () => {
    const { status, data } = await api('POST', '/api/jira/push-rank', {
      key: 'EAMDM-1',
      beforeKey: 'EAMDM-2',
    });
    assert.equal(status, 200);
    assert.deepEqual(data, { success: true, key: 'EAMDM-1', beforeKey: 'EAMDM-2', afterKey: null });
    assert.match(lastRequest.url, /\/issue\/EAMDM-1\/rank$/);
    assert.equal(lastRequest.method, 'PUT');
    assert.deepEqual(JSON.parse(lastRequest.body), { rankBeforeIssue: 'EAMDM-2' });
  });

  test('ranks an issue after another when only afterKey is given', async () => {
    const { status, data } = await api('POST', '/api/jira/push-rank', {
      key: 'EAMDM-3',
      afterKey: 'EAMDM-4',
    });
    assert.equal(status, 200);
    assert.deepEqual(data, { success: true, key: 'EAMDM-3', beforeKey: null, afterKey: 'EAMDM-4' });
    assert.deepEqual(JSON.parse(lastRequest.body), { rankAfterIssue: 'EAMDM-4' });
  });

  test('beforeKey takes precedence when both beforeKey and afterKey are given', async () => {
    await api('POST', '/api/jira/push-rank', {
      key: 'EAMDM-5',
      beforeKey: 'EAMDM-6',
      afterKey: 'EAMDM-7',
    });
    assert.deepEqual(JSON.parse(lastRequest.body), { rankBeforeIssue: 'EAMDM-6' });
  });
});

describe('POST /api/jira/push-rank — JIRA error passthrough', () => {
  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/rest/api/')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ errorMessages: ['Issue does not exist'] }),
          text: async () => JSON.stringify({ errorMessages: ['Issue does not exist'] }),
        };
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('surfaces a JIRA API failure as a 500 with the upstream message', async () => {
    const { status, data } = await api('POST', '/api/jira/push-rank', {
      key: 'EAMDM-404',
      beforeKey: 'EAMDM-2',
    });
    assert.equal(status, 500);
    assert.match(data.error, /Issue does not exist/);
  });
});
