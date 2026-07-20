// ── Integration tests: JIRA push/pull sprints — guard clauses ────────────────
// Covers the guard-clause behavior (missing token / missing board) of the 4
// HTTP endpoints in routes/jira-push-sprints.ts:
//   POST /api/jira/push-sprints-preview (SSE)
//   POST /api/jira/push-sprints
//   POST /api/jira/pull-sprint-preview (SSE)
//   POST /api/jira/pull-sprint
// The happy-path (mocked JIRA fetch) coverage for these same endpoints lives in
// tests/integration/jira-push-sprints-mocked.test.js — split into its own file
// because JIRA_BOARD_ID is parsed into module-level config once per process
// (see config/env.ts), so a file that needs the board *unset* (this one) and a
// file that needs it *configured* (the other one) cannot share a process.
// Unit tests for the extracted pure logic (buildSprintNameMap, fetchSprintIssuesOnBoard,
// fetchUnimportedSprintIssues, buildSprintPushPreview) already live in
// tests/unit/jiraSprintService.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers/testApp.js';

// ── Guard clauses (no JIRA token / no JIRA board configured) ─────────────────
// Uses the default test app: JIRA_BOARD_ID defaults to '' (unset) since it is
// never set in this file, and JIRA_API_TOKEN defaults to '' per
// startTestApp(). The token check is read live from process.env so we can flip
// it per-test; JIRA_BOARD_ID is captured into the route context at server
// startup, so it stays unset for the lifetime of this app instance.
describe('JIRA push-sprints — guard clauses', () => {
  let api, stop;

  before(async () => {
    ({ api, stop } = await startTestApp());
  });

  after(async () => {
    await stop();
  });

  // Items schemas require a non-empty array (matches the existing convention
  // elsewhere, e.g. /api/docs/batch-delete), so these guard-clause probes send
  // a well-formed single item — validateBody runs before the guard clause (see
  // the existing /api/jira/pull route for the same ordering), so an empty or
  // malformed body would 400 before ever reaching the token/board checks.
  const sprintPreviewItem = {
    filename: 'guard-clause-probe.md',
    sprint: null,
    jiraId: '',
    title: 'Probe',
    docType: 'story',
  };
  const sprintPushItem = {
    filename: 'guard-clause-probe.md',
    sprint: 'Sprint 1',
    changeType: 'push',
  };

  test('POST /api/jira/push-sprints-preview returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api('POST', '/api/jira/push-sprints-preview', {
      items: [sprintPreviewItem],
      selectedSprints: [],
    });
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });

  test('POST /api/jira/push-sprints-preview returns 400 when JIRA_BOARD_ID is not configured', async () => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    try {
      const { status, data } = await api('POST', '/api/jira/push-sprints-preview', {
        items: [sprintPreviewItem],
        selectedSprints: [],
      });
      assert.equal(status, 400);
      assert.equal(data.code, 'NO_BOARD');
    } finally {
      delete process.env.JIRA_API_TOKEN;
    }
  });

  test('POST /api/jira/push-sprints returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api('POST', '/api/jira/push-sprints', {
      items: [sprintPushItem],
    });
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });

  test('POST /api/jira/push-sprints returns 400 when JIRA_BOARD_ID is not configured', async () => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    try {
      const { status, data } = await api('POST', '/api/jira/push-sprints', {
        items: [sprintPushItem],
      });
      assert.equal(status, 400);
      assert.equal(data.code, 'NO_BOARD');
    } finally {
      delete process.env.JIRA_API_TOKEN;
    }
  });

  test('POST /api/jira/pull-sprint-preview returns 503 when JIRA_API_TOKEN is not set', async () => {
    const { status, data } = await api('POST', '/api/jira/pull-sprint-preview', {
      selectedSprints: [],
    });
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });

  test('POST /api/jira/pull-sprint-preview returns 400 when JIRA_BOARD_ID is not configured', async () => {
    process.env.JIRA_API_TOKEN = 'fake-test-token';
    try {
      const { status, data } = await api('POST', '/api/jira/pull-sprint-preview', {
        selectedSprints: [],
      });
      assert.equal(status, 400);
      assert.equal(data.code, 'NO_BOARD');
    } finally {
      delete process.env.JIRA_API_TOKEN;
    }
  });

  test('POST /api/jira/pull-sprint returns 503 when JIRA_API_TOKEN is not set (no board check)', async () => {
    const { status, data } = await api('POST', '/api/jira/pull-sprint', { issues: [] });
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});
