// ── Integration tests: POST /api/jira/check-all ───────────────────────────────
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

// ── No token ──────────────────────────────────────────────────────────────────
describe('POST /api/jira/check-all — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api('POST', '/api/jira/check-all');
    assert.equal(status, 503);
    assert.equal(data.error.code, 'JIRA_NOT_CONFIGURED');
  });
});

// ── With mock JIRA ────────────────────────────────────────────────────────────
describe('POST /api/jira/check-all — detects changes including description', () => {
  const CHANGED_FILE   = '2026-01-10-check-all-changed.md';
  const UNCHANGED_FILE = '2026-01-10-check-all-unchanged.md';
  const originalFetch  = globalThis.fetch;

  before(async () => {
    writeDoc('epics', CHANGED_FILE, `---
JIRA_ID: EAMDM-901
Story_Points: 3
Status: Draft
Priority: Medium
Created: 2026-01-10
---

## Old Title

Old description text.
`);
    writeDoc('epics', UNCHANGED_FILE, `---
JIRA_ID: EAMDM-902
Story_Points: 5
Status: In Progress
Priority: High
Created: 2026-01-10
---

## Stable Title

Stable description text.
`);
    process.env.JIRA_API_TOKEN = 'fake-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/') && url.includes('EAMDM-901')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: {
              summary:           'New Title From JIRA',
              status:            { name: 'In Progress' },
              customfield_10006: 3,
              description:       'New description text.',
            },
          }),
          text: async () => '{}',
        };
      }
      if (typeof url === 'string' && url.includes('/rest/api/') && url.includes('EAMDM-902')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: {
              summary:           'Stable Title',
              status:            { name: 'In Progress' },
              customfield_10006: 5,
              description:       'Stable description text.',
            },
          }),
          text: async () => '{}',
        };
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns 200 with changed/skipped/errors/total', async () => {
    const { status, data } = await api('POST', '/api/jira/check-all');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.changed));
    assert.ok(Array.isArray(data.skipped));
    assert.ok(Array.isArray(data.errors));
    assert.ok(typeof data.total === 'number');
  });

  test('EAMDM-901 appears in changed with summary and description diffs', async () => {
    const { data } = await api('POST', '/api/jira/check-all');
    const item = data.changed.find(c => c.jiraId === 'EAMDM-901');
    assert.ok(item, 'EAMDM-901 should be in changed list');
    assert.ok(item.changes.summary,     'summary change should be detected');
    assert.ok(item.changes.description, 'description change should be detected');
  });

  test('EAMDM-902 appears in skipped (no changes)', async () => {
    const { data } = await api('POST', '/api/jira/check-all');
    assert.ok(data.skipped.includes('EAMDM-902'), 'EAMDM-902 should be in skipped');
  });

  test('unchanged item must not appear in changed list (no false positive from missing description)', async () => {
    const { data } = await api('POST', '/api/jira/check-all');
    const item = data.changed.find(c => c.jiraId === 'EAMDM-902');
    assert.equal(item, undefined, 'unchanged item must not appear in changed list');
  });
});
