// ── Unit tests: src/services/confluenceService.ts ─────────────────────────────
// Mirrors the structure of jiraService.test.js / jiraService-errors.test.js,
// stubbing global.fetch directly rather than mock.method (both patterns are
// used elsewhere in this suite; direct stubbing keeps per-test overrides terse).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { createConfluenceService } from '../../src/services/confluenceService.js';

function jsonRes(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h] ?? null },
    text: async () => JSON.stringify(body),
  };
}

function makeService() {
  return createConfluenceService({
    CONFLUENCE_BASE: 'https://example.atlassian.net',
    CONFLUENCE_TOKEN: 'super-secret-token',
    CONFLUENCE_EMAIL: 'me@example.com',
    CONFLUENCE_SPACE_KEY: 'MIDAS',
  });
}

const origFetch = global.fetch;

// ── Auth header ────────────────────────────────────────────────────────────
describe('createConfluenceService — auth header', () => {
  after(() => {
    global.fetch = origFetch;
  });

  test('sends Basic auth with base64-encoded email:token', async () => {
    let capturedHeaders;
    global.fetch = async (_url, opts) => {
      capturedHeaders = opts.headers;
      return jsonRes({ id: '123', key: 'MIDAS' });
    };
    const service = makeService();
    await service.getSpace();
    const expected = `Basic ${Buffer.from('me@example.com:super-secret-token').toString('base64')}`;
    assert.equal(capturedHeaders.Authorization, expected);
  });
});

// ── getPageByTitle ─────────────────────────────────────────────────────────
describe('getPageByTitle', () => {
  after(() => {
    global.fetch = origFetch;
  });

  test('returns null when no page matches (empty results array)', async () => {
    global.fetch = async () => jsonRes({ results: [], size: 0 });
    const service = makeService();
    const result = await service.getPageByTitle('Does Not Exist');
    assert.equal(result, null);
  });

  test('returns the mapped page on a match', async () => {
    global.fetch = async () =>
      jsonRes({
        results: [
          {
            id: '999',
            title: 'MIDAS Upload API',
            version: { number: 3 },
            body: { storage: { value: '<p>hello</p>' } },
            space: { key: 'MIDAS' },
          },
        ],
      });
    const service = makeService();
    const result = await service.getPageByTitle('MIDAS Upload API');
    assert.deepEqual(result, {
      id: '999',
      title: 'MIDAS Upload API',
      version: 3,
      body: '<p>hello</p>',
      spaceKey: 'MIDAS',
    });
  });

  test('lets a real HTTP error propagate rather than returning null', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: async () => 'Internal Server Error',
    });
    const service = makeService();
    await assert.rejects(() => service.getPageByTitle('Anything'), /500/);
  });
});

// ── createPage ─────────────────────────────────────────────────────────────
describe('createPage', () => {
  after(() => {
    global.fetch = origFetch;
  });

  test('returns the new page including id and version: 1', async () => {
    let spaceCalls = 0;
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/rest/api/space/')) {
        spaceCalls++;
        return jsonRes({ id: '42', key: 'MIDAS' });
      }
      return jsonRes({
        id: '1001',
        title: 'New Page',
        version: { number: 1 },
        body: { storage: { value: '<p>content</p>' } },
      });
    };
    const service = makeService();
    const page = await service.createPage('New Page', '<p>content</p>');
    assert.equal(page.id, '1001');
    assert.equal(page.title, 'New Page');
    assert.equal(page.version, 1);
    assert.equal(page.body, '<p>content</p>');
    assert.equal(page.spaceKey, 'MIDAS');

    // A second createPage call should reuse the cached space id, not
    // re-resolve it.
    await service.createPage('Another Page', '<p>more</p>');
    assert.equal(spaceCalls, 1, 'space id should be resolved once and cached');
  });

  test('sends the resolved spaceId in the request body', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/rest/api/space/')) return jsonRes({ id: '77', key: 'MIDAS' });
      capturedBody = JSON.parse(opts.body);
      return jsonRes({
        id: '2',
        title: 'X',
        version: { number: 1 },
        body: { storage: { value: '' } },
      });
    };
    const service = makeService();
    await service.createPage('X', 'body-text');
    assert.equal(capturedBody.spaceId, '77');
    assert.equal(capturedBody.status, 'current');
    assert.equal(capturedBody.body.representation, 'storage');
    assert.equal(capturedBody.body.value, 'body-text');
  });
});

// ── updatePage ─────────────────────────────────────────────────────────────
describe('updatePage', () => {
  after(() => {
    global.fetch = origFetch;
  });

  test('sends the given version and storage-format body, returns mapped result', async () => {
    let capturedUrl, capturedBody, capturedMethod;
    global.fetch = async (url, opts) => {
      capturedUrl = String(url);
      capturedMethod = opts.method;
      capturedBody = JSON.parse(opts.body);
      return jsonRes({
        id: '555',
        title: 'Updated Title',
        version: { number: 4 },
        body: { storage: { value: '<p>updated</p>' } },
        space: { key: 'MIDAS' },
      });
    };
    const service = makeService();
    const page = await service.updatePage('555', 4, 'Updated Title', '<p>updated</p>');
    assert.equal(capturedMethod, 'PUT');
    assert.ok(capturedUrl.endsWith('/wiki/api/v2/pages/555'));
    assert.equal(capturedBody.version.number, 4);
    assert.equal(capturedBody.title, 'Updated Title');
    assert.equal(capturedBody.body.representation, 'storage');
    assert.equal(capturedBody.body.value, '<p>updated</p>');
    assert.deepEqual(page, {
      id: '555',
      title: 'Updated Title',
      version: 4,
      body: '<p>updated</p>',
      spaceKey: 'MIDAS',
    });
  });
});

// ── deletePage ─────────────────────────────────────────────────────────────
describe('deletePage', () => {
  after(() => {
    global.fetch = origFetch;
  });

  test('does not throw on a 204 No Content response', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 204,
      headers: { get: () => null },
      text: async () => '',
    });
    const service = makeService();
    await assert.doesNotReject(() => service.deletePage('123'));
  });

  test('sends a DELETE request to the page endpoint', async () => {
    let capturedUrl, capturedMethod;
    global.fetch = async (url, opts) => {
      capturedUrl = String(url);
      capturedMethod = opts.method;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '' };
    };
    const service = makeService();
    await service.deletePage('42');
    assert.equal(capturedMethod, 'DELETE');
    assert.ok(capturedUrl.endsWith('/wiki/api/v2/pages/42'));
  });
});

// ── Error redaction ────────────────────────────────────────────────────────
describe('secret redaction', () => {
  after(() => {
    global.fetch = origFetch;
  });

  test('redacts the Basic auth header value from thrown error messages', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: async () =>
        `Unauthorized: Basic ${Buffer.from('me@example.com:super-secret-token').toString('base64')} is invalid`,
    });
    const service = makeService();
    await assert.rejects(
      () => service.getSpace(),
      (err) => {
        assert.ok(!err.message.includes('super-secret-token'), 'raw token must not appear');
        assert.ok(!err.message.includes('c3VwZXI'), 'base64 token fragment must not appear');
        assert.match(err.message, /401/);
        return true;
      }
    );
  });
});

// ── 429 retry behavior ─────────────────────────────────────────────────────
describe('HTTP 429 retry logic', () => {
  after(() => {
    global.fetch = origFetch;
  });

  test('retries on 429 and succeeds on second attempt', async () => {
    let callCount = 0;
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => {
      fn();
      return 0;
    };

    global.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, headers: { get: () => null } };
      }
      return jsonRes({ id: '1', key: 'MIDAS' });
    };

    const service = makeService();
    const result = await service.getSpace();
    assert.equal(callCount, 2, 'should have retried once');
    assert.deepEqual(result, { id: '1', key: 'MIDAS' });
    global.setTimeout = origSetTimeout;
  });

  test('throws after 3 consecutive 429s', async () => {
    let callCount = 0;
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => {
      fn();
      return 0;
    };

    global.fetch = async () => {
      callCount++;
      return { ok: false, status: 429, headers: { get: () => null } };
    };

    const service = makeService();
    await assert.rejects(() => service.getSpace(), /rate limit exceeded after 3 retries/);
    assert.equal(callCount, 3, 'should have attempted exactly 3 times');
    global.setTimeout = origSetTimeout;
  });

  test('respects the Retry-After header', async () => {
    const retryDelays = [];
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => {
      if (ms < 30_000) retryDelays.push(ms);
      fn();
      return 0;
    };

    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      if (callCount < 3) {
        return {
          ok: false,
          status: 429,
          headers: { get: (h) => (h === 'Retry-After' ? '5' : null) },
        };
      }
      return jsonRes({ id: '1', key: 'MIDAS' });
    };

    const service = makeService();
    await service.getSpace();
    global.setTimeout = origSetTimeout;
    assert.ok(retryDelays.length > 0, 'retry setTimeout should have been called');
    assert.ok(
      retryDelays.every((d) => d === 5000),
      `all retry delays should be 5000ms (Retry-After=5), got ${retryDelays}`
    );
  });
});
