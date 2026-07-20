// ── Integration tests: rate limiter coverage (#420) ─────────────────────────────
// Verifies aiLimiter actually covers the real AI-cost routes and jiraLimiter
// covers JIRA routes beyond just /api/jira/push*. Uses a low RATE_LIMIT_AI /
// RATE_LIMIT_JIRA threshold set before the first startTestApp() import in this
// process (config/env.ts parses these once at module load — see the same
// pattern documented in jira-push-sprints-mocked.test.js for JIRA_BOARD_ID).
//
// express-rate-limit's skip option reads process.env.MOCK_CLAUDE dynamically
// (see middleware/rateLimiter.ts), and startTestApp() always sets MOCK_CLAUDE=1
// so tests aren't rate-limited by default. Each burst below deletes it just for
// the burst — every request in the burst is crafted to fail validation/lookup
// before it would ever reach a real Claude/JIRA call, so this is safe.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers/testApp.js';

process.env.RATE_LIMIT_AI = '3';
process.env.RATE_LIMIT_JIRA = '3';

let api, stop;

before(async () => {
  ({ api, stop } = await startTestApp());
});

after(async () => {
  await stop();
  delete process.env.RATE_LIMIT_AI;
  delete process.env.RATE_LIMIT_JIRA;
});

async function burst(n, makeRequest) {
  const statuses = [];
  for (let i = 0; i < n; i++) {
    const { status } = await makeRequest();
    statuses.push(status);
  }
  return statuses;
}

describe('aiLimiter covers the real AI-cost routes', () => {
  test('POST /api/doc/:type/:filename/upgrade is rate limited after RATE_LIMIT_AI requests', async () => {
    delete process.env.MOCK_CLAUDE;
    try {
      // Invalid doc type → the handler 400s before ever calling Claude, so this
      // only exercises the rate limiter, not a real AI call.
      const statuses = await burst(4, () =>
        api('POST', '/api/doc/bogus-type/whatever.md/upgrade', { feedback: 'test' })
      );
      assert.ok(
        statuses.slice(0, 3).every((s) => s !== 429),
        `expected no 429s yet: ${statuses}`
      );
      assert.equal(statuses[3], 429, `expected the 4th request to be rate limited: ${statuses}`);
    } finally {
      process.env.MOCK_CLAUDE = '1';
    }
  });

  test('POST /api/docs/split-story is rate limited after RATE_LIMIT_AI requests', async () => {
    delete process.env.MOCK_CLAUDE;
    try {
      const statuses = await burst(4, () =>
        api('POST', '/api/docs/split-story', { filename: 'missing.md', docType: 'bogus-type' })
      );
      assert.equal(statuses[3], 429, `expected the 4th request to be rate limited: ${statuses}`);
    } finally {
      process.env.MOCK_CLAUDE = '1';
    }
  });

  test('POST /api/split-epic is rate limited after RATE_LIMIT_AI requests', async () => {
    delete process.env.MOCK_CLAUDE;
    try {
      const statuses = await burst(4, () =>
        api('POST', '/api/split-epic', { epicFilename: 'missing.md', description: 'x' })
      );
      assert.equal(statuses[3], 429, `expected the 4th request to be rate limited: ${statuses}`);
    } finally {
      process.env.MOCK_CLAUDE = '1';
    }
  });
});

describe('jiraLimiter covers JIRA routes beyond just push*', () => {
  test('POST /api/jira/pull-sprint-preview is rate limited after RATE_LIMIT_JIRA requests', async () => {
    delete process.env.MOCK_CLAUDE;
    try {
      // No JIRA_API_TOKEN in the test env → 503 before any network call, so this
      // only exercises the rate limiter.
      const statuses = await burst(4, () =>
        api('POST', '/api/jira/pull-sprint-preview', { selectedSprints: [] })
      );
      assert.equal(statuses[3], 429, `expected the 4th request to be rate limited: ${statuses}`);
    } finally {
      process.env.MOCK_CLAUDE = '1';
    }
  });
});
