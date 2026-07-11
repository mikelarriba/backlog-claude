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
      `/api/jira/push/epic/${encodeURIComponent(epicFilename)}`
    );
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
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

// ── GET /api/jira/versions — no token ────────────────────────────────────────
describe('GET /api/jira/versions — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status } = await api('GET', '/api/jira/versions');
    assert.equal(status, 503);
  });
});

// ── GET /api/jira/children/:key — no token ───────────────────────────────────
describe('GET /api/jira/children/:key — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status } = await api('GET', '/api/jira/children/EAMDM-1');
    assert.equal(status, 503);
  });
});

// ── GET /api/jira/by-fix-version/:version — no token ─────────────────────────
describe('GET /api/jira/by-fix-version/:version — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/by-fix-version/${encodeURIComponent('Digi PI2026.2')}`
    );
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});

// ── GET /api/jira/by-fix-version/:version — request validation ───────────────
describe('GET /api/jira/by-fix-version/:version — request validation', () => {
  before(() => {
    // Token must be present so the 400 check (not the 503 guard) is exercised.
    process.env.JIRA_API_TOKEN = 'fake-test-token';
  });

  after(() => {
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns 400 for a blank version param', async () => {
    const { status, data } = await api('GET', '/api/jira/by-fix-version/%20');
    assert.equal(status, 400);
    assert.equal(data.code, 'INVALID_VERSION');
  });
});

// ── GET /api/jira/board-sprints — no token ───────────────────────────────────
describe('GET /api/jira/board-sprints — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api('GET', '/api/jira/board-sprints');
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});

// ── GET /api/jira/board-sprints — no board configured ────────────────────────
describe('GET /api/jira/board-sprints — no board configured', () => {
  before(() => {
    // Token present so the 503 guard is bypassed and the board-not-configured
    // branch (a normal, expected 200 — not an error) is exercised instead.
    // JIRA_BOARD_ID is never set anywhere in this test file/process, so it
    // stays at its config default of '' for every test here.
    process.env.JIRA_API_TOKEN = 'fake-test-token';
  });

  after(() => {
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns 200 with an empty sprints array and boardNotConfigured: true', async () => {
    const { status, data } = await api('GET', '/api/jira/board-sprints');
    assert.equal(status, 200);
    assert.deepEqual(data.sprints, []);
    assert.equal(data.boardNotConfigured, true);
  });
});

// ── POST /api/jira/sync-status — no token ─────────────────────────────────────
describe('POST /api/jira/sync-status — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { data: doc } = await api('POST', '/api/generate', {
      idea: 'Sync status no token test',
      type: 'epic',
    });
    const { status } = await api(
      'POST',
      `/api/jira/sync-status/epic/${encodeURIComponent(doc.filename)}`
    );
    assert.equal(status, 503);
  });
});

// ── POST /api/jira/update-from-jira — no token ───────────────────────────────
describe('POST /api/jira/update-from-jira — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { data: doc } = await api('POST', '/api/generate', {
      idea: 'Update from jira no token test',
      type: 'epic',
    });
    const { status } = await api(
      'POST',
      `/api/jira/update-from-jira/epic/${encodeURIComponent(doc.filename)}`
    );
    assert.equal(status, 503);
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
      `/api/jira/push/epic/${encodeURIComponent(epicFilename)}`
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

// ── GET /api/jira/children/:key — happy path (JIRA fetch mocked) ─────────────
describe('GET /api/jira/children/:key — happy path (JIRA fetch mocked)', () => {
  const originalFetch = globalThis.fetch;

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/')) {
        const body = {
          fields: {
            issuetype: { name: 'Epic' },
            issuelinks: [
              {
                inwardIssue: {
                  key: 'EAMDM-42',
                  fields: {
                    summary: 'Child story',
                    issuetype: { name: 'Story' },
                    status: { name: 'In Progress' },
                  },
                },
              },
            ],
            subtasks: [],
          },
        };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns children list from JIRA issue links', async () => {
    const { status, data } = await api('GET', '/api/jira/children/EAMDM-100');
    assert.equal(status, 200);
    assert.equal(data.parentKey, 'EAMDM-100');
    assert.ok(Array.isArray(data.children));
    assert.ok(data.children.some((c) => c.key === 'EAMDM-42'));
    assert.equal(data.children.find((c) => c.key === 'EAMDM-42').summary, 'Child story');
  });
});

// ── GET /api/jira/by-fix-version/:version — happy path (JIRA fetch mocked) ──
describe('GET /api/jira/by-fix-version/:version — happy path (JIRA fetch mocked)', () => {
  let existingFilename;
  const originalFetch = globalThis.fetch;

  before(async () => {
    // Create a local epic and give it a real JIRA_ID via the push flow (rather
    // than writing frontmatter straight to disk) so docIndex — which is only
    // ever updated through docIndex.invalidate on API writes — actually knows
    // about it. That lets findByJiraId('EAMDM-9000') resolve for real below.
    const { data: doc } = await api('POST', '/api/generate', {
      idea: 'Existing epic already imported for a fix version',
      type: 'epic',
    });
    existingFilename = doc.filename;

    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ key: 'EAMDM-9000', id: '9000' }),
          text: async () => JSON.stringify({ key: 'EAMDM-9000' }),
        };
      }
      return originalFetch(url, opts);
    });
    await api('POST', `/api/jira/push/epic/${encodeURIComponent(existingFilename)}`);
    mock.restoreAll();

    // Stub JIRA's paged search endpoint: page 1 is a full 100-issue page
    // (including the already-imported EAMDM-9000) so jiraPagedRequest is
    // forced to fetch a second, short page before it stops.
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/2/search')) {
        const startAt = Number(new URL(url).searchParams.get('startAt'));
        if (startAt === 0) {
          const issues = Array.from({ length: 100 }, (_, i) => ({
            key: i === 0 ? 'EAMDM-9000' : `EAMDM-9${String(100 + i).padStart(3, '0')}`,
            fields: {
              summary: i === 0 ? 'Already imported epic' : `Issue ${i}`,
              issuetype: { name: 'Story' },
              status: { name: 'To Do' },
              priority: { name: 'Medium' },
            },
          }));
          const body = { issues, total: 101 };
          return {
            ok: true,
            status: 200,
            json: async () => body,
            text: async () => JSON.stringify(body),
          };
        }
        const body = {
          issues: [
            {
              key: 'EAMDM-9423',
              fields: {
                summary: 'Support Structured Lists',
                issuetype: { name: 'Epic' },
                status: { name: 'In Progress' },
                priority: { name: 'Major' },
              },
            },
          ],
          total: 101,
        };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('collapses multiple JIRA pages into one response with matching total', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/by-fix-version/${encodeURIComponent('Digi PI2026.2')}`
    );
    assert.equal(status, 200);
    assert.equal(data.fixVersion, 'Digi PI2026.2');
    assert.equal(data.total, 101);
    assert.equal(data.issues.length, 101);
  });

  test('flags an issue with a local file as localExists: true', async () => {
    const { data } = await api(
      'GET',
      `/api/jira/by-fix-version/${encodeURIComponent('Digi PI2026.2')}`
    );
    const existingIssue = data.issues.find((i) => i.key === 'EAMDM-9000');
    assert.ok(existingIssue);
    assert.equal(existingIssue.localExists, true);
    assert.equal(existingIssue.localFilename, existingFilename);
  });

  test('flags an issue with no local file as localExists: false', async () => {
    const { data } = await api(
      'GET',
      `/api/jira/by-fix-version/${encodeURIComponent('Digi PI2026.2')}`
    );
    const newIssue = data.issues.find((i) => i.key === 'EAMDM-9423');
    assert.ok(newIssue);
    assert.equal(newIssue.localExists, false);
    assert.equal(newIssue.localFilename, null);
    assert.equal(newIssue.summary, 'Support Structured Lists');
    assert.equal(newIssue.issuetype, 'Epic');
    assert.equal(newIssue.status, 'In Progress');
    assert.equal(newIssue.priority, 'Major');
  });
});

// ── GET /api/jira/search — fixVersion filter (JIRA fetch mocked) ─────────────
describe('GET /api/jira/search — fixVersion filter (JIRA fetch mocked)', () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/2/search')) {
        capturedUrl = url;
        const body = {
          issues: [
            {
              key: 'EAMDM-9500',
              fields: {
                summary: 'Issue scoped to a fix version',
                issuetype: { name: 'Story' },
                status: { name: 'To Do' },
                priority: { name: 'Medium' },
                fixVersions: [{ name: 'Digi PI2026.2' }],
              },
            },
          ],
          total: 1,
        };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('includes a fixVersion JQL clause and returns fixVersions on each issue', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/search?fixVersion=${encodeURIComponent('Digi PI2026.2')}`
    );
    assert.equal(status, 200);
    assert.ok(capturedUrl.includes(encodeURIComponent('fixVersion = "Digi PI2026.2"')));
    assert.equal(data.issues.length, 1);
    assert.deepEqual(data.issues[0].fixVersions, ['Digi PI2026.2']);
  });
});

// ── POST /api/jira/sync-status — happy path (JIRA fetch mocked) ──────────────
describe('POST /api/jira/sync-status — happy path (JIRA fetch mocked)', () => {
  let epicFilename;
  const originalFetch = globalThis.fetch;

  before(async () => {
    // Write a doc with a real JIRA_ID directly
    const content = `---
JIRA_ID: EAMDM-888
Story_Points: TBD
Status: Draft
Priority: High
Created: 2026-01-01
---

## Sync Status Test Epic

## Context
Test.
`;
    epicFilename = '2026-01-01-sync-status-test.md';
    const dir = path.join(docsRoot, 'epics');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, epicFilename), content);

    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/')) {
        const body = {
          fields: {
            status: { name: 'In Progress' },
            customfield_10006: 5,
          },
        };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns 400 when JIRA_ID is TBD', async () => {
    const { data: doc } = await api('POST', '/api/generate', {
      idea: 'No JIRA ID epic',
      type: 'epic',
    });
    const { status, data } = await api(
      'POST',
      `/api/jira/sync-status/epic/${encodeURIComponent(doc.filename)}`
    );
    assert.equal(status, 400);
    assert.equal(data.code, 'NO_JIRA_ID');
  });

  test('writes JIRA_Status and Story_Points to frontmatter', async () => {
    const { status, data } = await api(
      'POST',
      `/api/jira/sync-status/epic/${encodeURIComponent(epicFilename)}`
    );
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.jiraStatus, 'In Progress');
    assert.equal(data.storyPoints, 5);

    // Verify frontmatter was updated on disk
    const { data: doc } = await api('GET', `/api/doc/epic/${encodeURIComponent(epicFilename)}`);
    assert.match(doc.content, /^JIRA_Status: In Progress$/m);
    assert.match(doc.content, /^Story_Points: 5$/m);
  });
});

// ── POST /api/jira/update-from-jira — happy path (JIRA fetch mocked) ─────────
describe('POST /api/jira/update-from-jira — happy path (JIRA fetch mocked)', () => {
  let epicFilename;
  const originalFetch = globalThis.fetch;

  before(async () => {
    // Write a doc with local-only fields we want to preserve
    const content = `---
JIRA_ID: EAMDM-777
Story_Points: 3
Status: Draft
Priority: Medium
Sprint: Sprint 4
Squad: Squad Alpha
PI: PI-2026.1
Created: 2026-01-01
---

## Update From JIRA Test Epic

## Context
Local context.
`;
    epicFilename = '2026-01-01-update-from-jira-test.md';
    const dir = path.join(docsRoot, 'epics');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, epicFilename), content);

    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/')) {
        const body = {
          key: 'EAMDM-777',
          fields: {
            summary: 'Updated From JIRA Title',
            issuetype: { name: 'Epic' },
            status: { name: 'In Review' },
            priority: { name: 'High' },
            description: null,
            fixVersions: [{ name: 'PI-2026.2' }],
            customfield_10002: null,
            customfield_10006: 8,
          },
        };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('overwrites JIRA-sourced fields and preserves local Sprint/Squad/PI', async () => {
    const { status, data } = await api(
      'POST',
      `/api/jira/update-from-jira/epic/${encodeURIComponent(epicFilename)}`
    );
    assert.equal(status, 200);
    assert.equal(data.key, 'EAMDM-777');

    const { data: doc } = await api('GET', `/api/doc/epic/${encodeURIComponent(epicFilename)}`);
    // JIRA-sourced fields should be updated (jiraIssueToMarkdown sets Status to 'Created in JIRA')
    assert.match(doc.content, /^Status: Created in JIRA$/m);
    assert.match(doc.content, /^Story_Points: 8$/m);
    // Local-only fields must be preserved
    assert.match(doc.content, /^Sprint: Sprint 4$/m);
    assert.match(doc.content, /^Squad: Squad Alpha$/m);
    assert.match(doc.content, /^PI: PI-2026\.1$/m);
  });
});
