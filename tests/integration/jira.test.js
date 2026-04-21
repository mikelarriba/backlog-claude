// ── Integration tests: JIRA push / pull ───────────────────────────────────────
// JIRA_API_TOKEN is set to '' by startTestApp → endpoints return 503.
// Happy-path tests stub globalThis.fetch for JIRA URL patterns only so that
// the test's own api() calls (to the local server) are not intercepted.
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

// Helper: write a doc directly to the temp docs dir
function writeDoc(subdir, filename, content) {
  const dir = path.join(docsRoot, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

// ── No JIRA token (default test environment) ──────────────────────────────────
describe('JIRA push — no token configured', () => {
  let epicFilename;

  before(async () => {
    const { data } = await api('POST', '/api/generate', {
      idea: 'Push this epic to JIRA',
      title: 'JIRA Push Epic',
      type: 'epic',
    });
    epicFilename = data.filename;
  });

  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api(
      'POST',
      `/api/jira/push/epic/${encodeURIComponent(epicFilename)}`,
    );
    assert.equal(status, 503);
    assert.equal(data.error.code, 'JIRA_NOT_CONFIGURED');
  });
});

describe('JIRA search — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status } = await api('GET', '/api/jira/search?q=MIDAS');
    assert.equal(status, 503);
  });
});

// ── JIRA pull — request validation ────────────────────────────────────────────
describe('JIRA pull — request validation', () => {
  test('returns 400 when keys array is missing', async () => {
    const { status, data } = await api('POST', '/api/jira/pull', {});
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  test('returns 400 when keys is not an array', async () => {
    const { status, data } = await api('POST', '/api/jira/pull', { keys: 'EAMDM-1' });
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});

// ── JIRA push — happy path with selective fetch mock ─────────────────────────
describe('JIRA push — happy path (JIRA fetch mocked)', () => {
  let epicFilename;
  const originalFetch = globalThis.fetch;

  before(async () => {
    // Write a pre-made epic directly so we control its exact content
    const content = `---
JIRA_ID: TBD
Story_Points: 3
Status: Draft
Priority: High
Created: 2026-01-01
---

## My Pushable Epic

## Context
Test.

## Objective
Push to JIRA.

## Value
Validates the push flow.

## Execution
V2 work.

## Acceptance Criteria
- Given a draft epic, when pushed, then JIRA_ID is updated.

## Out of Scope
N/A
`;
    epicFilename = '2026-01-01-my-pushable-epic.md';
    writeDoc('epics', epicFilename, content);

    // Activate a fake JIRA token so the 503 guard passes.
    // The token is checked dynamically (process.env), so setting it here works.
    process.env.JIRA_API_TOKEN = 'fake-test-token';

    // Stub globalThis.fetch only for JIRA API calls.
    // Test client calls (to localhost) use the real fetch.
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ key: 'EAMDM-999', id: '999' }),
          text: async () => JSON.stringify({ key: 'EAMDM-999' }),
        };
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns 200 and the JIRA key after creating the issue', async () => {
    const { status, data } = await api(
      'POST',
      `/api/jira/push/epic/${encodeURIComponent(epicFilename)}`,
    );
    assert.equal(status, 200);
    assert.equal(data.key, 'EAMDM-999');
    assert.equal(data.action, 'created');
  });

  test('persists the JIRA_ID in the file after push', async () => {
    const { data } = await api('GET', `/api/doc/epic/${encodeURIComponent(epicFilename)}`);
    assert.match(data.content, /^JIRA_ID: EAMDM-999$/m);
  });
});
