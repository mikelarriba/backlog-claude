// ── Integration tests: JIRA sync — description + title update ─────────────────
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestApp } from '../helpers/testApp.js';

let api, stop, docsRoot, inboxDir;

before(async () => {
  ({ api, stop, docsRoot, inboxDir } = await startTestApp());
});

after(async () => {
  await stop();
});

function writeDoc(subdir, filename, content) {
  const dir = path.join(docsRoot, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

// ── sync-status: updates title and description, writes history ────────────────
describe('POST /api/jira/sync-status — title and description sync', () => {
  const EPIC_FILE = '2026-01-01-sync-desc-test.md';
  const originalFetch = globalThis.fetch;

  before(async () => {
    writeDoc('epics', EPIC_FILE, `---
JIRA_ID: EAMDM-501
Story_Points: TBD
Status: Draft
Priority: Medium
Created: 2026-01-01
---

## Old Title

Old description body text.
`);
    process.env.JIRA_API_TOKEN = 'fake-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            fields: {
              status:            { name: 'In Progress' },
              customfield_10006: 5,
              summary:           'New Title From JIRA',
              description:       'New description body text.',
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

  test('updates JIRA_Status and Story_Points', async () => {
    const { status, data } = await api('POST', `/api/jira/sync-status/epic/${encodeURIComponent(EPIC_FILE)}`);
    assert.equal(status, 200);
    assert.equal(data.jiraStatus, 'In Progress');
    assert.equal(data.storyPoints, 5);
  });

  test('updates title heading in the file when JIRA summary changed', async () => {
    const { data: doc } = await api('GET', `/api/doc/epic/${encodeURIComponent(EPIC_FILE)}`);
    assert.match(doc.content, /^## New Title From JIRA$/m);
  });

  test('writes description history to inbox when description changed', async () => {
    const inboxPath = path.join(inboxDir, EPIC_FILE);
    assert.ok(fs.existsSync(inboxPath), 'inbox history file should exist');
    const historyContent = fs.readFileSync(inboxPath, 'utf-8');
    assert.match(historyContent, /JIRA Description Update/);
    assert.match(historyContent, /Old description body text/);
    assert.match(historyContent, /New description body text/);
  });
});

// ── sync-status: no history when description unchanged ────────────────────────
describe('POST /api/jira/sync-status — no history when description unchanged', () => {
  const EPIC_FILE = '2026-01-01-sync-no-change.md';
  const originalFetch = globalThis.fetch;

  before(async () => {
    writeDoc('epics', EPIC_FILE, `---
JIRA_ID: EAMDM-502
Story_Points: TBD
Status: Draft
Priority: Medium
Created: 2026-01-01
---

## Stable Title

Stable description body.
`);
    process.env.JIRA_API_TOKEN = 'fake-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            fields: {
              status:            { name: 'Done' },
              customfield_10006: 3,
              summary:           'Stable Title',
              description:       'Stable description body.',
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

  test('does not write inbox history when description is unchanged', async () => {
    const { status } = await api('POST', `/api/jira/sync-status/epic/${encodeURIComponent(EPIC_FILE)}`);
    assert.equal(status, 200);
    const inboxPath = path.join(inboxDir, EPIC_FILE);
    assert.ok(!fs.existsSync(inboxPath), 'inbox history file should NOT exist when description unchanged');
  });
});

// ── update-from-jira: writes history when description changed ─────────────────
describe('POST /api/jira/update-from-jira — writes description history', () => {
  const EPIC_FILE = '2026-01-01-update-desc-test.md';
  const originalFetch = globalThis.fetch;

  before(async () => {
    writeDoc('epics', EPIC_FILE, `---
JIRA_ID: EAMDM-503
Story_Points: 2
Status: Draft
Priority: Low
Sprint: Sprint 1
Squad: Alpha
PI: PI-2026.1
Created: 2026-01-01
---

## Previous Title

Previous description from local file.
`);
    process.env.JIRA_API_TOKEN = 'fake-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      if (typeof url === 'string' && url.includes('/rest/api/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            key:    'EAMDM-503',
            fields: {
              summary:           'Fresh Title From JIRA',
              issuetype:         { name: 'Epic' },
              status:            { name: 'In Review' },
              priority:          { name: 'High' },
              description:       'Fresh description from JIRA.',
              fixVersions:       [{ name: 'PI-2026.2' }],
              customfield_10002: null,
              customfield_10006: 5,
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

  test('returns 200 and the JIRA key', async () => {
    const { status, data } = await api('POST', `/api/jira/update-from-jira/epic/${encodeURIComponent(EPIC_FILE)}`);
    assert.equal(status, 200);
    assert.equal(data.key, 'EAMDM-503');
  });

  test('writes description history to inbox when description changed', async () => {
    const inboxPath = path.join(inboxDir, EPIC_FILE);
    assert.ok(fs.existsSync(inboxPath), 'inbox history file should exist');
    const historyContent = fs.readFileSync(inboxPath, 'utf-8');
    assert.match(historyContent, /JIRA Description Update/);
    assert.match(historyContent, /Previous description from local file/);
    assert.match(historyContent, /Fresh description from JIRA/);
  });

  test('preserves local Sprint and Squad fields after update', async () => {
    const { data: doc } = await api('GET', `/api/doc/epic/${encodeURIComponent(EPIC_FILE)}`);
    assert.match(doc.content, /^Sprint: Sprint 1$/m);
    assert.match(doc.content, /^Squad: Alpha$/m);
  });
});
