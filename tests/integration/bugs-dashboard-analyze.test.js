// ── Integration tests: POST /api/bugs/dashboard/analyze cache freshness (#540) ──
// Before this fix, analyze read _cacheOpen/_cacheAll directly with no TTL check,
// so it could silently analyze arbitrarily stale bug data (status/assignee/
// resolution could be hours or days out of date). This exercises the STALE_CACHE
// guard added to mirror the freshness check GET /api/bugs/dashboard already
// applies when deciding whether to reuse its own cache.
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

const originalFetch = globalThis.fetch;

function jiraEmptySearchFetchMock() {
  return async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('/rest/api/2/search')) {
      const body = { issues: [], total: 0 };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }
    return originalFetch(url, opts);
  };
}

describe('POST /api/bugs/dashboard/analyze — stale/missing cache (#540)', () => {
  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
  });

  after(() => {
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns 400 STALE_CACHE when the dashboard has never been loaded', async () => {
    const { status, data } = await api('POST', '/api/bugs/dashboard/analyze', {
      bugKeys: ['BUG-1'],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'STALE_CACHE');
    assert.match(data.error, /reload the dashboard/i);
  });

  test('returns 400 STALE_CACHE once a previously-loaded cache is past CACHE_TTL_MS', async () => {
    let now = Date.now();
    mock.method(Date, 'now', () => now);
    mock.method(globalThis, 'fetch', jiraEmptySearchFetchMock());

    // Populate the cache. GET streams SSE (not JSON), so api()'s res.json() call
    // fails to parse the body, but it still fully reads the response stream —
    // and thus waits for the handler (including its cache write, which happens
    // before the stream's final event) to finish — before resolving.
    await api('GET', '/api/bugs/dashboard');

    // Fast-forward well past the 10-minute CACHE_TTL_MS without waiting in real
    // time — Date.now() is mocked, so the route's own `now - fetchedAt` check
    // sees the elapsed time directly.
    now += 11 * 60 * 1000;

    const { status, data } = await api('POST', '/api/bugs/dashboard/analyze', {
      bugKeys: ['BUG-1'],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'STALE_CACHE');

    mock.restoreAll();
  });

  test('accepts a fresh cache and proceeds past the STALE_CACHE guard (fails later with NO_BUGS_FOUND for an unknown key)', async () => {
    mock.method(globalThis, 'fetch', jiraEmptySearchFetchMock());

    await api('GET', '/api/bugs/dashboard');

    // Cache is fresh (just loaded, real Date.now() this time) — the guard added
    // by #540 should let this request through to the existing "bug key not
    // found in cache" check rather than rejecting it as stale.
    const { status, data } = await api('POST', '/api/bugs/dashboard/analyze', {
      bugKeys: ['NONEXISTENT-1'],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'NO_BUGS_FOUND');

    mock.restoreAll();
  });
});
