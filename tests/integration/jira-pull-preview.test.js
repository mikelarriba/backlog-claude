// ── Integration tests: POST /api/jira/pull-preview ────────────────────────────
// pull-preview previously had no test coverage — added alongside the #456
// jira-sync.ts service-layer refactor since the file was already being touched.
//
// The `includeChildren` branches below (issue #459) additionally cover: Epic ->
// JQL child search, issuelinks inward-issue children (including a fetch
// failure for one child), and the local-children-closed-in-JIRA deletion path.
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

describe('POST /api/jira/pull-preview — includeChildren via issuelinks (non-Epic parent)', () => {
  const originalFetch = globalThis.fetch;

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);

      const respond = (body, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });

      if (urlStr.includes('/issue/EAMDM-910')) {
        return respond({
          key: 'EAMDM-910',
          fields: {
            summary: 'Parent story with linked children',
            issuetype: { name: 'Story' },
            description: 'Parent description.',
            issuelinks: [
              { inwardIssue: { key: 'EAMDM-911' } },
              { inwardIssue: { key: 'EAMDM-912' } },
            ],
          },
        });
      }
      if (urlStr.includes('/issue/EAMDM-911')) {
        return respond({
          key: 'EAMDM-911',
          fields: {
            summary: 'Fetchable child',
            issuetype: { name: 'Task' },
            description: 'Child description.',
          },
        });
      }
      if (urlStr.includes('/issue/EAMDM-912')) {
        // Simulate a child that fails to fetch — must be skipped, not crash the request.
        return respond({ errorMessages: ['Issue does not exist'] }, 404);
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('includes only the parent and the successfully-fetched child', async () => {
    const { status, data } = await api('POST', '/api/jira/pull-preview', {
      jiraKey: 'EAMDM-910',
      includeChildren: true,
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].jiraKey, 'EAMDM-910');
    assert.equal(data.items[1].jiraKey, 'EAMDM-911');
    assert.ok(
      !data.items.some((i) => i.jiraKey === 'EAMDM-912'),
      'the unfetchable child must be omitted, not crash the request'
    );
  });
});

describe('POST /api/jira/pull-preview — includeChildren fetches multiple linked children concurrently', () => {
  const originalFetch = globalThis.fetch;
  const CHILD_KEYS = ['EAMDM-914', 'EAMDM-915', 'EAMDM-916', 'EAMDM-917', 'EAMDM-918', 'EAMDM-919'];

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);

      const respond = (body, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });

      if (urlStr.includes('/issue/EAMDM-913')) {
        return respond({
          key: 'EAMDM-913',
          fields: {
            summary: 'Parent story with many linked children',
            issuetype: { name: 'Story' },
            description: 'Parent description.',
            issuelinks: CHILD_KEYS.map((key) => ({ inwardIssue: { key } })),
          },
        });
      }
      const childMatch = CHILD_KEYS.find((key) => urlStr.includes(`/issue/${key}`));
      if (childMatch) {
        return respond({
          key: childMatch,
          fields: {
            summary: `Child ${childMatch}`,
            issuetype: { name: 'Task' },
            description: 'Child description.',
          },
        });
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('includes the parent and every fetched child, regardless of completion order', async () => {
    const { status, data } = await api('POST', '/api/jira/pull-preview', {
      jiraKey: 'EAMDM-913',
      includeChildren: true,
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.items.length, CHILD_KEYS.length + 1);
    assert.equal(data.items[0].jiraKey, 'EAMDM-913');
    const returnedKeys = data.items.slice(1).map((i) => i.jiraKey);
    assert.deepEqual([...returnedKeys].sort(), [...CHILD_KEYS].sort());
  });
});

describe('POST /api/jira/pull-preview — includeChildren via Epic Link JQL search', () => {
  const originalFetch = globalThis.fetch;

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);

      const respond = (body) => ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });

      if (urlStr.includes('/issue/EAMDM-920')) {
        return respond({
          key: 'EAMDM-920',
          fields: {
            summary: 'Parent epic',
            issuetype: { name: 'Epic' },
            description: 'Epic description.',
            issuelinks: [],
          },
        });
      }
      if (urlStr.includes('/search') && urlStr.includes('EAMDM-920')) {
        return respond({
          issues: [
            {
              key: 'EAMDM-921',
              fields: {
                summary: 'Epic child from JQL',
                issuetype: { name: 'Story' },
                description: 'Story under the epic.',
              },
            },
          ],
        });
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('includes children found via the Epic Link JQL search', async () => {
    const { status, data } = await api('POST', '/api/jira/pull-preview', {
      jiraKey: 'EAMDM-920',
      includeChildren: true,
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].jiraKey, 'EAMDM-920');
    assert.equal(data.items[1].jiraKey, 'EAMDM-921');
    assert.equal(data.items[1].jiraType, 'Story');
  });
});

describe('POST /api/jira/pull-preview — local children closed in JIRA are offered for deletion', () => {
  const originalFetch = globalThis.fetch;
  const EPIC_FILE = '2026-01-15-pull-preview-parent-epic.md';
  const STORY_FILE = '2026-01-15-pull-preview-closed-child.md';

  before(async () => {
    writeDoc(
      'epics',
      EPIC_FILE,
      `---
JIRA_ID: EAMDM-930
Story_Points: TBD
Status: In Progress
Priority: Medium
Created: 2026-01-15
---

## Parent Epic On Disk

Epic body.
`
    );
    writeDoc(
      'stories',
      STORY_FILE,
      `---
JIRA_ID: EAMDM-931
Epic_ID: ${EPIC_FILE}
Story_Points: 3
Status: In Progress
Priority: Medium
Created: 2026-01-15
---

## Closed Child Story

Story body.
`
    );
    // pull-preview reads parent/local-children relationships from docIndex.
    await api('POST', '/api/docs/rebuild-index');

    process.env.JIRA_API_TOKEN = 'fake-test-token';
    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);

      const respond = (body) => ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });

      if (urlStr.includes('/issue/EAMDM-930') && urlStr.includes('issuelinks')) {
        return respond({
          key: 'EAMDM-930',
          fields: {
            summary: 'Parent Epic On Disk',
            issuetype: { name: 'Epic' },
            description: 'Epic body.',
            issuelinks: [],
          },
        });
      }
      if (urlStr.includes('/search')) {
        // No children returned from the Epic-Link JQL search this time —
        // EAMDM-931 will instead be discovered via the local-children pass.
        return respond({ issues: [] });
      }
      if (urlStr.includes('/issue/EAMDM-931')) {
        return respond({
          fields: {
            status: { name: 'Done', statusCategory: { key: 'done' } },
            summary: 'Closed Child Story',
            issuetype: { name: 'Story' },
          },
        });
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('offers the closed local child for deletion', async () => {
    const { status, data } = await api('POST', '/api/jira/pull-preview', {
      jiraKey: 'EAMDM-930',
      includeChildren: true,
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    const deletion = data.items.find((i) => i.jiraKey === 'EAMDM-931');
    assert.ok(deletion, 'closed local child should be present in the preview');
    assert.equal(deletion.action, 'delete');
    assert.equal(deletion.localFilename, STORY_FILE);
    assert.match(deletion.reason, /Closed in JIRA/);
  });
});
