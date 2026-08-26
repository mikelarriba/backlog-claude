// ── Integration tests: GET /api/jira/closed-epics ────────────────────────────
// Documentation view support (#554): resolves a sprint/fix-version date
// window, queries Done issues resolved inside it, and groups them under their
// parent epics. JIRA_BOARD_ID must be set before the first startTestApp()
// call in this process (see jira-board-sprints-mocked.test.js for why).
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestApp } from '../helpers/testApp.js';

process.env.JIRA_BOARD_ID = 'TEST-BOARD-CE';

let api, stop, docsRoot;

before(async () => {
  ({ api, stop, docsRoot } = await startTestApp());
});

after(async () => {
  await stop();
});

function writeDoc(subdir, filename, jiraId) {
  const dir = path.join(docsRoot, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, filename),
    `---\nJIRA_ID: ${jiraId}\nStatus: Draft\nCreated: 2026-01-01\n---\n\n## Local doc for ${jiraId}\n`
  );
}

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// ── No JIRA token ─────────────────────────────────────────────────────────────
describe('GET /api/jira/closed-epics — no token configured', () => {
  test('returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api('GET', '/api/jira/closed-epics?sprint=Sprint%20Alpha');
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});

// ── Request validation ────────────────────────────────────────────────────────
describe('GET /api/jira/closed-epics — request validation', () => {
  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
  });

  after(() => {
    delete process.env.JIRA_API_TOKEN;
  });

  test('returns 400 when neither sprint nor fixVersion is given', async () => {
    const { status, data } = await api('GET', '/api/jira/closed-epics');
    assert.equal(status, 400);
    assert.equal(data.code, 'INVALID_PARAM');
  });

  test('returns 400 when both sprint and fixVersion are given', async () => {
    const { status, data } = await api('GET', '/api/jira/closed-epics?sprint=Foo&fixVersion=Bar');
    assert.equal(status, 400);
    assert.equal(data.code, 'INVALID_PARAM');
  });

  test('rejects a sprint name containing JQL keywords (400)', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/closed-epics?sprint=${encodeURIComponent('Sprint 1" OR 1=1 DROP TABLE')}`
    );
    assert.equal(status, 400);
    assert.equal(data.code, 'INVALID_PARAM');
  });

  test('rejects a fixVersion name containing JQL keywords (400)', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/closed-epics?fixVersion=${encodeURIComponent('PI1 UNION SELECT 1')}`
    );
    assert.equal(status, 400);
    assert.equal(data.code, 'INVALID_PARAM');
  });
});

// ── Sprint scope — happy path (JIRA fetch mocked) ─────────────────────────────
describe('GET /api/jira/closed-epics?sprint=... — happy path (JIRA fetch mocked)', () => {
  const originalFetch = globalThis.fetch;
  let lastSearchJql = null;

  before(() => {
    writeDoc('epics', '2026-01-01-reporting-overhaul.md', 'EAMDM-500');
    writeDoc('stories', '2026-01-01-add-csv-export.md', 'EAMDM-501');
    // Intentionally no local file for EAMDM-600 or EAMDM-502.

    process.env.JIRA_API_TOKEN = 'fake-test-token';

    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);

      if (urlStr.includes('/sprint?state=active')) {
        return jsonRes({
          values: [
            {
              id: 201,
              name: 'Sprint Alpha',
              state: 'closed',
              startDate: '2026-06-01T00:00:00.000Z',
              endDate: '2026-06-21T00:00:00.000Z',
            },
          ],
          isLast: true,
        });
      }

      if (urlStr.includes('/rest/api/2/search')) {
        const jql = decodeURIComponent(new URL(urlStr).searchParams.get('jql') || '');
        if (jql.includes('key in (')) {
          return jsonRes({
            issues: [
              {
                key: 'EAMDM-600',
                fields: {
                  summary: 'Data Platform',
                  status: { name: 'In Progress' },
                  customfield_10002: 'Data Platform Epic',
                },
              },
            ],
            total: 1,
          });
        }
        lastSearchJql = jql;
        return jsonRes({
          issues: [
            {
              key: 'EAMDM-500',
              fields: {
                summary: 'Reporting Overhaul',
                issuetype: { name: 'Epic' },
                status: { name: 'Done' },
                customfield_10002: 'Reporting Overhaul Epic',
              },
            },
            {
              key: 'EAMDM-501',
              fields: {
                summary: 'Add CSV export',
                issuetype: { name: 'Story' },
                status: { name: 'Done' },
                customfield_10000: 'EAMDM-600',
              },
            },
            {
              key: 'EAMDM-502',
              fields: {
                summary: 'Fix flaky test',
                issuetype: { name: 'Bug' },
                status: { name: 'Done' },
                customfield_10000: null,
              },
            },
          ],
          total: 3,
        });
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('resolves the sprint window and returns windowResolved: true', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/closed-epics?sprint=${encodeURIComponent('Sprint Alpha')}`
    );
    assert.equal(status, 200);
    assert.deepEqual(data.scope, {
      type: 'sprint',
      value: 'Sprint Alpha',
      windowResolved: true,
    });
  });

  test('queries statusCategory = Done with the resolved-date window', async () => {
    await api('GET', `/api/jira/closed-epics?sprint=${encodeURIComponent('Sprint Alpha')}`);
    assert.ok(lastSearchJql.includes('statusCategory = Done'));
    assert.ok(lastSearchJql.includes('resolved >= "2026-06-01"'));
    assert.ok(lastSearchJql.includes('resolved <= "2026-06-21"'));
  });

  test('groups closed issues under their parent epics, including a closed epic itself', async () => {
    const { data } = await api(
      'GET',
      `/api/jira/closed-epics?sprint=${encodeURIComponent('Sprint Alpha')}`
    );
    assert.equal(data.total, 3);

    const closedEpic = data.epics.find((e) => e.key === 'EAMDM-500');
    assert.ok(closedEpic);
    assert.equal(closedEpic.epicClosedInScope, true);
    assert.equal(closedEpic.summary, 'Reporting Overhaul');
    assert.equal(closedEpic.localExists, true);
    assert.equal(closedEpic.localFilename, '2026-01-01-reporting-overhaul.md');
    assert.deepEqual(closedEpic.closedChildren, []);

    const openEpic = data.epics.find((e) => e.key === 'EAMDM-600');
    assert.ok(openEpic);
    assert.equal(openEpic.epicClosedInScope, false);
    assert.equal(openEpic.summary, 'Data Platform');
    assert.equal(openEpic.status, 'In Progress');
    assert.equal(openEpic.localExists, false);
    assert.equal(openEpic.closedChildren.length, 1);
    assert.equal(openEpic.closedChildren[0].key, 'EAMDM-501');
    assert.equal(openEpic.closedChildren[0].localExists, true);
    assert.equal(openEpic.closedChildren[0].localFilename, '2026-01-01-add-csv-export.md');
  });

  test('puts issues with no epic link under a synthetic "(no epic)" bucket', async () => {
    const { data } = await api(
      'GET',
      `/api/jira/closed-epics?sprint=${encodeURIComponent('Sprint Alpha')}`
    );
    const noEpic = data.epics.find((e) => e.key === '(no epic)');
    assert.ok(noEpic);
    assert.equal(noEpic.isSynthetic, true);
    assert.equal(noEpic.localExists, false);
    assert.equal(noEpic.closedChildren.length, 1);
    assert.equal(noEpic.closedChildren[0].key, 'EAMDM-502');
    assert.equal(noEpic.closedChildren[0].localExists, false);
    assert.equal(noEpic.closedChildren[0].localFilename, null);
  });

  test('returns 404 for a sprint name that does not exist on the board', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/closed-epics?sprint=${encodeURIComponent('No Such Sprint')}`
    );
    assert.equal(status, 404);
    assert.equal(data.code, 'SPRINT_NOT_FOUND');
  });
});

// ── Fix version scope — happy path + date fallback (JIRA fetch mocked) ───────
describe('GET /api/jira/closed-epics?fixVersion=... — happy path (JIRA fetch mocked)', () => {
  const originalFetch = globalThis.fetch;
  let lastSearchJql = null;

  before(() => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';

    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);

      if (urlStr.includes('/project/EAMDM/versions')) {
        return jsonRes([
          { id: '1', name: 'PI 2026.3', startDate: '2026-07-01', releaseDate: '2026-07-31' },
          { id: '2', name: 'PI 2026.4 (undated)' },
        ]);
      }

      if (urlStr.includes('/rest/api/2/search')) {
        const jql = decodeURIComponent(new URL(urlStr).searchParams.get('jql') || '');
        lastSearchJql = jql;
        return jsonRes({ issues: [], total: 0 });
      }
      return originalFetch(url, opts);
    });
  });

  after(() => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
  });

  test('resolves start/release dates and includes the resolved-date window in JQL', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/closed-epics?fixVersion=${encodeURIComponent('PI 2026.3')}`
    );
    assert.equal(status, 200);
    assert.deepEqual(data.scope, {
      type: 'fixversion',
      value: 'PI 2026.3',
      windowResolved: true,
    });
    assert.ok(lastSearchJql.includes('statusCategory = Done'));
    assert.ok(lastSearchJql.includes('resolved >= "2026-07-01"'));
    assert.ok(lastSearchJql.includes('resolved <= "2026-07-31"'));
  });

  test('falls back to Done-only with windowResolved: false when the version has no dates', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/closed-epics?fixVersion=${encodeURIComponent('PI 2026.4 (undated)')}`
    );
    assert.equal(status, 200);
    assert.deepEqual(data.scope, {
      type: 'fixversion',
      value: 'PI 2026.4 (undated)',
      windowResolved: false,
    });
    assert.ok(lastSearchJql.includes('statusCategory = Done'));
    assert.ok(!lastSearchJql.includes('resolved'));
  });

  test('returns 404 for a fix version that does not exist', async () => {
    const { status, data } = await api(
      'GET',
      `/api/jira/closed-epics?fixVersion=${encodeURIComponent('No Such Version')}`
    );
    assert.equal(status, 404);
    assert.equal(data.code, 'VERSION_NOT_FOUND');
  });
});
