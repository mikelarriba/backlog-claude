// ── Unit tests: jiraService error paths ───────────────────────────────────────
// Covers JIRA 4xx, 5xx, 429 retry loop, and request timeout.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJiraService } from '../../src/services/jiraService.js';
import { isoDate, slugify } from '../../src/utils/transforms.js';

let jiraService, tmpRoot;

const TYPE_CONFIG = {
  feature: { command: 'create-features', dir: null, event: 'feature_created' },
  epic: { command: 'create-epics', dir: null, event: 'epic_created' },
  story: { command: 'create-stories', dir: null, event: 'story_created' },
  spike: { command: 'create-spikes', dir: null, event: 'spike_created' },
  bug: { command: 'create-bugs', dir: null, event: 'bug_created' },
};

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-err-test-'));
  for (const type of Object.keys(TYPE_CONFIG)) {
    const dir = path.join(tmpRoot, type);
    fs.mkdirSync(dir, { recursive: true });
    TYPE_CONFIG[type].dir = () => dir;
  }
  jiraService = createJiraService({
    JIRA_BASE: 'https://jira.example.com',
    JIRA_TOKEN: 'test-token',
    FIELD_EPIC_NAME: 'customfield_10002',
    FIELD_STORY_POINTS: 'customfield_10006',
    TYPE_CONFIG,
    isoDate,
    slugify,
  });
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── HTTP 4xx errors ────────────────────────────────────────────────────────────

describe('jiraRequest — HTTP 4xx errors', () => {
  const origFetch = global.fetch;
  after(() => {
    global.fetch = origFetch;
  });

  test('throws on 401 Unauthorized', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: async () => 'Unauthorized',
    });
    await assert.rejects(() => jiraService.jiraRequest('GET', '/issue/TEST-1'), /401/);
  });

  test('throws on 403 Forbidden', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
      text: async () => 'Forbidden',
    });
    await assert.rejects(() => jiraService.jiraRequest('GET', '/issue/TEST-1'), /403/);
  });

  test('throws on 404 Not Found', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => 'Not Found',
    });
    await assert.rejects(() => jiraService.jiraRequest('GET', '/issue/MISSING-1'), /404/);
  });

  test('redacts Bearer token from 4xx error messages', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: async () => 'Token Bearer abc123xyz is invalid',
    });
    await assert.rejects(
      () => jiraService.jiraRequest('GET', '/issue/TEST-1'),
      (err) => {
        assert.ok(!err.message.includes('abc123xyz'), 'token must not appear in error');
        return true;
      }
    );
  });
});

// ── HTTP 5xx errors ────────────────────────────────────────────────────────────

describe('jiraRequest — HTTP 5xx errors', () => {
  const origFetch = global.fetch;
  after(() => {
    global.fetch = origFetch;
  });

  test('throws on 500 Internal Server Error', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: async () => 'Internal Server Error',
    });
    await assert.rejects(() => jiraService.jiraRequest('GET', '/issue/TEST-1'), /500/);
  });

  test('throws on 503 Service Unavailable', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: async () => 'Service Unavailable',
    });
    await assert.rejects(() => jiraService.jiraRequest('POST', '/issue'), /503/);
  });

  test('truncates long 5xx error body to 300 chars', async () => {
    const longBody = 'E'.repeat(500);
    global.fetch = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: async () => longBody,
    });
    await assert.rejects(
      () => jiraService.jiraRequest('GET', '/issue/TEST-1'),
      (err) => {
        assert.ok(err.message.length < 400, 'error message should be truncated');
        return true;
      }
    );
  });
});

// ── HTTP 429 retry logic ───────────────────────────────────────────────────────

describe('jiraRequest — HTTP 429 retry logic', () => {
  const origFetch = global.fetch;
  after(() => {
    global.fetch = origFetch;
  });

  test('retries on 429 and succeeds on second attempt', async () => {
    let callCount = 0;
    // Override setTimeout to avoid actual waiting
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => {
      fn();
      return 0;
    };

    global.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ id: '1', key: 'TEST-1' }),
      };
    };

    const result = await jiraService.jiraRequest('GET', '/issue/TEST-1');
    assert.equal(callCount, 2, 'should have retried once');
    assert.deepEqual(result, { id: '1', key: 'TEST-1' });
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
      return {
        ok: false,
        status: 429,
        headers: { get: () => null },
      };
    };

    await assert.rejects(
      () => jiraService.jiraRequest('GET', '/issue/TEST-1'),
      /rate limit exceeded after 3 retries/
    );
    assert.equal(callCount, 3, 'should have attempted exactly 3 times');
    global.setTimeout = origSetTimeout;
  });

  test('uses Retry-After header when present', async () => {
    // Capture only retry delays, not the AbortController timer (which uses JIRA_TIMEOUT_MS = 30s)
    const retryDelays = [];
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => {
      // AbortController timer uses 30000ms; retry delays are much shorter
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
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '{}',
      };
    };

    await jiraService.jiraRequest('GET', '/issue/TEST-1');
    global.setTimeout = origSetTimeout;
    assert.ok(retryDelays.length > 0, 'retry setTimeout should have been called');
    assert.ok(
      retryDelays.every((d) => d === 5000),
      `all retry delays should be 5000ms (Retry-After=5), got ${retryDelays}`
    );
  });

  test('falls back to default backoff delays when no Retry-After header', async () => {
    // Capture only retry delays, not the AbortController timer (30000ms)
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
          headers: { get: () => null },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '{}',
      };
    };

    await jiraService.jiraRequest('GET', '/issue/TEST-1');
    global.setTimeout = origSetTimeout;
    // Default delays are [2000, 4000, 8000] — first two should be used for 2 retries
    assert.ok(retryDelays.length >= 2, `expected at least 2 retry delays, got ${retryDelays}`);
    assert.equal(retryDelays[0], 2000, `first retry should wait 2s, got ${retryDelays[0]}`);
    assert.equal(retryDelays[1], 4000, `second retry should wait 4s, got ${retryDelays[1]}`);
  });
});

// ── Successful response parsing ────────────────────────────────────────────────

describe('jiraRequest — successful responses', () => {
  const origFetch = global.fetch;
  after(() => {
    global.fetch = origFetch;
  });

  test('returns parsed JSON on 200 OK', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ id: '42', key: 'TEST-42' }),
    });
    const result = await jiraService.jiraRequest('GET', '/issue/TEST-42');
    assert.deepEqual(result, { id: '42', key: 'TEST-42' });
  });

  test('returns undefined for empty 204 response body', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 204,
      headers: { get: () => null },
      text: async () => '',
    });
    const result = await jiraService.jiraRequest('DELETE', '/issue/TEST-1');
    assert.equal(result, undefined);
  });

  test('jiraAgileRequest uses agile API path', async () => {
    let capturedUrl;
    global.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '{"values":[]}',
      };
    };
    await jiraService.jiraAgileRequest('GET', '/board/1/sprint');
    assert.ok(
      capturedUrl.includes('/rest/agile/1.0/'),
      `URL should use agile API, got: ${capturedUrl}`
    );
  });
});
