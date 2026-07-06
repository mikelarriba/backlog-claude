// ── Integration tests: JIRA push/pull sprints — happy path (mocked JIRA) ─────
// Covers the successful, end-to-end behavior of the 4 HTTP endpoints in
// routes/jira-push-sprints.ts with a mocked JIRA fetch, following the pattern
// established in tests/integration/jira.test.js. Guard-clause behavior (missing
// token / missing board) is covered separately in
// tests/integration/jira-push-sprints.test.js — split into its own file because
// JIRA_BOARD_ID is parsed once into module-level config per process (see
// config/env.ts), so it must be set here *before* the first startTestApp() call
// in this process, and stays set for every test in this file.
//
// Board layout: Sprint 100 (id 10) already has EAMDM-1 and EAMDM-3 assigned;
// Sprint 200 (id 20) is empty. Local docs: Story A (EAMDM-1, Sprint 100 — matches
// JIRA, so "unchanged"), Story E (EAMDM-5, Sprint 200 — not on the board yet, so
// "add"), Story C (EAMDM-3, no local sprint — JIRA has it in Sprint 100, so "pull").
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startTestApp } from '../helpers/testApp.js';

// Must be set before the first startTestApp() call in this process: JIRA_BOARD_ID
// is read once into module-level config (config/env.ts) and captured into the
// route context at server startup (see app/context.ts), so setting it later
// would have no effect on already-built route closures.
process.env.JIRA_BOARD_ID = 'TEST-BOARD-1';

function writeDoc(docsRoot, subdir, filename, content) {
  const dir = path.join(docsRoot, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// ── SSE helper: POST to an SSE endpoint and collect all events ────────────────
function ssePost(baseUrl, urlPath, body) {
  const events = [];
  return new Promise((resolve, reject) => {
    const parsed = new URL(baseUrl + urlPath);
    const bodyStr = JSON.stringify(body || {});
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                events.push(JSON.parse(line.slice(6)));
              } catch {
                /* no-op */
              }
            }
          }
        });
        res.on('end', () => resolve({ status: res.statusCode, events }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

describe('JIRA push-sprints — happy path (JIRA fetch mocked)', () => {
  let api, stop, docsRoot, baseUrl;
  let storyAFilename, storyEFilename, storyCFilename;
  const originalFetch = globalThis.fetch;

  before(async () => {
    ({ api, stop, docsRoot, baseUrl } = await startTestApp());
    process.env.JIRA_API_TOKEN = 'fake-test-token';

    storyAFilename = '2026-01-01-story-a.md';
    storyEFilename = '2026-01-01-story-e.md';
    storyCFilename = '2026-01-01-story-c.md';

    const doc = ({ jiraId, sprint, title }) => `---
JIRA_ID: ${jiraId}
Story_Points: 3
Status: Draft
Priority: Medium
Sprint: ${sprint}
Created: 2026-01-01
---

## ${title}

## Context
Test.
`;

    writeDoc(
      docsRoot,
      'stories',
      storyAFilename,
      doc({ jiraId: 'EAMDM-1', sprint: 'Sprint 100', title: 'Story A' })
    );
    writeDoc(
      docsRoot,
      'stories',
      storyEFilename,
      doc({ jiraId: 'EAMDM-5', sprint: 'Sprint 200', title: 'Story E' })
    );
    writeDoc(
      docsRoot,
      'stories',
      storyCFilename,
      doc({ jiraId: 'EAMDM-3', sprint: 'TBD', title: 'Story C' })
    );
    // Docs were written directly to disk, not through /api/generate, so force
    // the in-memory docIndex (which the routes read from) to pick them up.
    await api('POST', '/api/docs/rebuild-index');

    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      const method = (opts && opts.method) || 'GET';
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);

      // Board sprint list (active + future sprints)
      if (method === 'GET' && urlStr.includes('/sprint?state=active')) {
        return jsonRes({
          values: [
            { name: 'Sprint 100', id: 10 },
            { name: 'Sprint 200', id: 20 },
          ],
          isLast: true,
        });
      }
      // Board scan: issues currently assigned to sprint 10 on the board
      if (method === 'GET' && urlStr.includes('/board/') && urlStr.includes('/sprint/10/issue')) {
        return jsonRes({
          issues: [
            { key: 'EAMDM-1', fields: { summary: 'Story A' } },
            { key: 'EAMDM-3', fields: { summary: 'Story C' } },
          ],
        });
      }
      // Board scan: issues assigned to sprint 20 on the board (empty so far)
      if (method === 'GET' && urlStr.includes('/board/') && urlStr.includes('/sprint/20/issue')) {
        return jsonRes({ issues: [] });
      }
      // Unimported-sprint scan (no /board/ prefix) — used by pull-sprint-preview
      if (method === 'GET' && urlStr.includes('/sprint/10/issue')) {
        return jsonRes({
          issues: [
            {
              key: 'EAMDM-1',
              fields: {
                summary: 'Story A',
                issuetype: { name: 'Story' },
                priority: { name: 'Medium' },
                status: { name: 'Done' },
                customfield_10006: 3,
              },
            },
            {
              key: 'EAMDM-9',
              fields: {
                summary: 'Unimported Issue',
                issuetype: { name: 'Bug' },
                priority: { name: 'High' },
                status: { name: 'To Do' },
                customfield_10006: 5,
              },
            },
          ],
          total: 2,
        });
      }
      // Push: assign an issue to sprint 200
      if (method === 'POST' && urlStr.includes('/sprint/20/issue')) {
        return jsonRes({});
      }
      // Remove: move an issue to the backlog
      if (method === 'POST' && urlStr.includes('/backlog/issue')) {
        return jsonRes({});
      }
      // Pull: fetch full issue detail to import as a local doc
      if (method === 'GET' && urlStr.includes('/rest/api/2/issue/EAMDM-9')) {
        return jsonRes({
          key: 'EAMDM-9',
          fields: {
            summary: 'Unimported Issue',
            description: null,
            issuetype: { name: 'Bug' },
            priority: { name: 'High' },
            fixVersions: [],
            labels: [],
            customfield_10006: 5,
          },
        });
      }
      // Pull: issue that no longer exists in JIRA — used to exercise per-item
      // error handling without failing the whole pull-sprint batch.
      if (method === 'GET' && urlStr.includes('/rest/api/2/issue/EAMDM-404')) {
        return jsonRes({ errorMessages: ['Issue Does Not Exist'] }, 404);
      }
      return originalFetch(url, opts);
    });
  });

  after(async () => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_BOARD_ID;
    await stop();
  });

  describe('POST /api/jira/push-sprints-preview', () => {
    const previewItems = [
      {
        filename: storyAFilename,
        sprint: 'Sprint 100',
        jiraId: 'EAMDM-1',
        title: 'Story A',
        docType: 'story',
      },
      {
        filename: storyEFilename,
        sprint: 'Sprint 200',
        jiraId: 'EAMDM-5',
        title: 'Story E',
        docType: 'story',
      },
    ];

    test('sends a progress event before the result event', async () => {
      const { status, events } = await ssePost(baseUrl, '/api/jira/push-sprints-preview', {
        items: previewItems,
        selectedSprints: ['Sprint 100', 'Sprint 200'],
      });
      assert.equal(status, 200);
      assert.ok(
        events.some((e) => e.type === 'progress'),
        'expected at least one progress event'
      );
    });

    test('reports Story A as unchanged since its local sprint already matches JIRA', async () => {
      const { events } = await ssePost(baseUrl, '/api/jira/push-sprints-preview', {
        items: previewItems,
        selectedSprints: ['Sprint 100', 'Sprint 200'],
      });
      const resultEvent = events.find((e) => e.type === 'result');
      assert.ok(resultEvent, 'expected a result event');
      assert.equal(resultEvent.stats.unchanged, 1);
      assert.equal(resultEvent.errors.length, 0);
      assert.ok(
        !resultEvent.changes.some((c) => c.jiraId === 'EAMDM-1'),
        'Story A should not appear as a change since it is unchanged'
      );
    });

    test('reports Story E as an add since JIRA does not have it in any sprint yet', async () => {
      const { events } = await ssePost(baseUrl, '/api/jira/push-sprints-preview', {
        items: previewItems,
        selectedSprints: ['Sprint 100', 'Sprint 200'],
      });
      const resultEvent = events.find((e) => e.type === 'result');
      assert.equal(resultEvent.stats.adds, 1);
      const addChange = resultEvent.changes.find((c) => c.jiraId === 'EAMDM-5');
      assert.ok(addChange, 'expected an add change for EAMDM-5');
      assert.equal(addChange.changeType, 'add');
      assert.equal(addChange.targetSprint, 'Sprint 200');
    });

    test('detects Story C as a pull candidate from the board scan even though it was not in the request', async () => {
      const { events } = await ssePost(baseUrl, '/api/jira/push-sprints-preview', {
        items: previewItems,
        selectedSprints: ['Sprint 100', 'Sprint 200'],
      });
      const resultEvent = events.find((e) => e.type === 'result');
      assert.equal(resultEvent.stats.pulls, 1);
      const pullChange = resultEvent.changes.find((c) => c.jiraId === 'EAMDM-3');
      assert.ok(pullChange, 'expected a pull change for EAMDM-3');
      assert.equal(pullChange.changeType, 'pull');
      assert.equal(pullChange.filename, storyCFilename);
      assert.equal(pullChange.targetSprint, 'Sprint 100');
    });

    test('excludes an item whose sprint is not one of the selected local sprint names', async () => {
      const { events } = await ssePost(baseUrl, '/api/jira/push-sprints-preview', {
        items: [
          ...previewItems,
          {
            filename: 'unrelated.md',
            sprint: 'Sprint 999',
            jiraId: 'EAMDM-777',
            title: 'Unrelated',
            docType: 'story',
          },
        ],
        selectedSprints: ['Sprint 100', 'Sprint 200'],
      });
      const resultEvent = events.find((e) => e.type === 'result');
      assert.ok(
        !resultEvent.changes.some((c) => c.jiraId === 'EAMDM-777'),
        'item with an unselected sprint should be filtered out entirely'
      );
      assert.ok(!resultEvent.errors.some((e) => e.jiraId === 'EAMDM-777'));
    });

    test('returns an error event when no local sprint names match any JIRA sprint', async () => {
      const { events } = await ssePost(baseUrl, '/api/jira/push-sprints-preview', {
        items: [],
        selectedSprints: ['Nonexistent Sprint'],
      });
      const errEvent = events.find((e) => e.type === 'error');
      assert.ok(errEvent, 'expected an error event');
      assert.match(errEvent.message, /No matching JIRA sprints found/);
    });
  });

  describe('POST /api/jira/push-sprints', () => {
    test('push: assigns an issue to the target sprint on the board', async () => {
      const { status, data } = await api('POST', '/api/jira/push-sprints', {
        items: [
          { filename: storyEFilename, sprint: 'Sprint 200', changeType: 'push', jiraId: 'EAMDM-5' },
        ],
      });
      assert.equal(status, 200);
      assert.equal(data.results.length, 1);
      assert.equal(data.results[0].status, 'ok');
      assert.equal(data.results[0].sprint, 'Sprint 200');
    });

    test('remove: moves an issue to the backlog', async () => {
      const { status, data } = await api('POST', '/api/jira/push-sprints', {
        items: [
          { filename: storyAFilename, sprint: null, changeType: 'remove', jiraId: 'EAMDM-1' },
        ],
      });
      assert.equal(status, 200);
      assert.equal(data.results[0].status, 'ok');
      assert.equal(data.results[0].sprint, '(backlog)');
    });

    test('pull: patches the local doc Sprint frontmatter field and persists it to disk', async () => {
      const { status, data } = await api('POST', '/api/jira/push-sprints', {
        items: [
          {
            filename: storyCFilename,
            sprint: 'Sprint 100',
            changeType: 'pull',
            jiraId: 'EAMDM-3',
            docType: 'story',
          },
        ],
      });
      assert.equal(status, 200);
      assert.equal(data.results[0].status, 'ok');
      assert.equal(data.results[0].sprint, 'Sprint 100');

      const content = fs.readFileSync(path.join(docsRoot, 'stories', storyCFilename), 'utf-8');
      assert.match(content, /^Sprint: Sprint 100$/m);
    });

    test('skips an item with no resolvable JIRA ID', async () => {
      const { status, data } = await api('POST', '/api/jira/push-sprints', {
        items: [{ filename: 'missing-doc.md', sprint: 'Sprint 100', changeType: 'push' }],
      });
      assert.equal(status, 200);
      assert.equal(data.results[0].status, 'skipped');
      assert.equal(data.results[0].reason, 'no JIRA ID');
    });

    test('skips a push when the target sprint name is not found on the board', async () => {
      const { status, data } = await api('POST', '/api/jira/push-sprints', {
        items: [
          { filename: 'ghost.md', sprint: 'Ghost Sprint', changeType: 'push', jiraId: 'EAMDM-7' },
        ],
      });
      assert.equal(status, 200);
      assert.equal(data.results[0].status, 'skipped');
      assert.match(data.results[0].reason, /not found on board/);
    });
  });

  describe('POST /api/jira/pull-sprint-preview', () => {
    test('includes a JIRA issue that is not yet imported locally', async () => {
      const { events } = await ssePost(baseUrl, '/api/jira/pull-sprint-preview', {
        selectedSprints: ['Sprint 100'],
      });
      const doneEvent = events.find((e) => e.type === 'done');
      assert.ok(doneEvent, 'expected a done event');
      const unimported = doneEvent.results.find((r) => r.key === 'EAMDM-9');
      assert.ok(unimported, 'expected EAMDM-9 in the results');
      assert.equal(unimported.sprintName, 'Sprint 100');
    });

    test('excludes a JIRA issue that is already imported locally', async () => {
      const { events } = await ssePost(baseUrl, '/api/jira/pull-sprint-preview', {
        selectedSprints: ['Sprint 100'],
      });
      const doneEvent = events.find((e) => e.type === 'done');
      // EAMDM-1 belongs to Story A, which already exists locally.
      assert.ok(!doneEvent.results.some((r) => r.key === 'EAMDM-1'));
    });
  });

  describe('POST /api/jira/pull-sprint', () => {
    test('imports a JIRA issue as a new local doc', async () => {
      const { status, data } = await api('POST', '/api/jira/pull-sprint', {
        issues: [{ key: 'EAMDM-9', sprintName: 'Sprint 100' }],
      });
      assert.equal(status, 200);
      assert.equal(data.results.length, 1);
      assert.equal(data.results[0].key, 'EAMDM-9');
      assert.equal(data.results[0].status, 'ok');
      assert.ok(data.results[0].filename);

      // "Bug" issuetype maps to the local "bug" doc type.
      const filepath = path.join(docsRoot, 'bugs', data.results[0].filename);
      assert.ok(fs.existsSync(filepath));
      const content = fs.readFileSync(filepath, 'utf-8');
      assert.match(content, /^JIRA_ID: EAMDM-9$/m);
      assert.match(content, /^Sprint: Sprint 100$/m);
    });

    test('reports a per-issue error without failing the whole batch when the JIRA fetch fails', async () => {
      const { status, data } = await api('POST', '/api/jira/pull-sprint', {
        issues: [{ key: 'EAMDM-404', sprintName: 'Sprint 100' }],
      });
      assert.equal(status, 200);
      assert.equal(data.results.length, 1);
      assert.equal(data.results[0].key, 'EAMDM-404');
      assert.equal(data.results[0].status, 'error');
      assert.ok(data.results[0].error);
    });
  });
});
