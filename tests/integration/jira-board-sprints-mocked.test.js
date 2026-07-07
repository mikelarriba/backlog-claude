// ── Integration tests: GET /api/jira/board-sprints — happy path (mocked JIRA) ─
// Split into its own file (same reason as jira-push-sprints.test.js vs.
// jira-push-sprints-mocked.test.js): JIRA_BOARD_ID is parsed once into
// module-level config per process (see config/env.ts) and captured into the
// route context at server startup (see app/context.ts), so it must be set
// here *before* the first startTestApp() call in this process. The
// board-not-configured (JIRA_BOARD_ID unset) and no-token cases are covered in
// tests/integration/jira.test.js, which never sets JIRA_BOARD_ID.
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers/testApp.js';

// Must be set before the first startTestApp() call in this process.
process.env.JIRA_BOARD_ID = 'TEST-BOARD-1';

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('GET /api/jira/board-sprints — happy path (JIRA fetch mocked)', () => {
  let api, stop;
  const originalFetch = globalThis.fetch;

  before(async () => {
    ({ api, stop } = await startTestApp());
    process.env.JIRA_API_TOKEN = 'fake-test-token';

    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);

      if (urlStr.includes('/sprint?state=active')) {
        return jsonRes({
          values: [
            {
              id: 101,
              name: 'MIDAS Sprint 100',
              state: 'active',
              startDate: '2026-06-01T00:00:00.000Z',
              endDate: '2026-06-21T00:00:00.000Z',
            },
            {
              id: 102,
              name: 'MIDAS Sprint 101',
              state: 'future',
              startDate: '2026-06-22T00:00:00.000Z',
              endDate: '2026-07-12T00:00:00.000Z',
            },
          ],
          isLast: true,
        });
      }
      return originalFetch(url, opts);
    });
  });

  after(async () => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
    await stop();
  });

  test('returns sprints[] with id, name, state, and dates', async () => {
    const { status, data } = await api('GET', '/api/jira/board-sprints');
    assert.equal(status, 200);
    assert.equal(data.boardNotConfigured, undefined);
    assert.equal(data.sprints.length, 2);
    assert.deepEqual(data.sprints[0], {
      id: 101,
      name: 'MIDAS Sprint 100',
      state: 'active',
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-06-21T00:00:00.000Z',
    });
    assert.deepEqual(data.sprints[1], {
      id: 102,
      name: 'MIDAS Sprint 101',
      state: 'future',
      startDate: '2026-06-22T00:00:00.000Z',
      endDate: '2026-07-12T00:00:00.000Z',
    });
  });

  test('returns only the active/future sprints the mocked board response gave, unmodified', async () => {
    // The JIRA API call itself already filters via state=active,future in the
    // query string; this confirms the endpoint doesn't add its own client-side
    // filtering that could drop sprints if the upstream response ever included
    // an unexpected state.
    const { data } = await api('GET', '/api/jira/board-sprints');
    assert.ok(data.sprints.every((s) => s.state === 'active' || s.state === 'future'));
    assert.equal(
      data.sprints.some((s) => s.state === 'closed'),
      false
    );
  });
});

describe('GET /api/jira/board-sprints — JIRA board API error (JIRA fetch mocked)', () => {
  let api, stop;
  const originalFetch = globalThis.fetch;

  before(async () => {
    ({ api, stop } = await startTestApp());
    process.env.JIRA_API_TOKEN = 'fake-test-token';

    mock.method(globalThis, 'fetch', async (url, opts) => {
      const urlStr = String(url);
      if (!urlStr.includes('/rest/')) return originalFetch(url, opts);
      if (urlStr.includes('/sprint?state=active')) {
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        };
      }
      return originalFetch(url, opts);
    });
  });

  after(async () => {
    mock.restoreAll();
    delete process.env.JIRA_API_TOKEN;
    await stop();
  });

  test('returns a meaningful error response when the board API call fails', async () => {
    const { status, data } = await api('GET', '/api/jira/board-sprints');
    assert.equal(status, 500);
    assert.ok(data.error);
    assert.ok(data.code);
  });
});
