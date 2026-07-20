// ── Integration tests: JIRA push route body validation (#420) ──────────────────
// The 4 JIRA push routes (push-preview, push-sprints-preview, push-sprints,
// push-rank) have Zod schemas in schemas/jira.ts that were defined for the
// published OpenAPI docs but never wired up with validateBody(), so malformed
// payloads previously fell through to ad-hoc handling (or a runtime crash)
// instead of a consistent 400. validateBody() runs before the route handler's
// own JIRA_API_TOKEN guard, so these assertions hold even without a token set.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers/testApp.js';

let api, stop;

before(async () => {
  ({ api, stop } = await startTestApp());
});

after(async () => {
  await stop();
});

function assertValidationError(status, data) {
  assert.equal(status, 400);
  assert.equal(data.code, 'VALIDATION_ERROR');
}

describe('POST /api/jira/push-preview — body validation', () => {
  test('rejects an item missing docType', async () => {
    const { status, data } = await api('POST', '/api/jira/push-preview', {
      items: [{ filename: 'a.md' }],
    });
    assertValidationError(status, data);
  });

  test('rejects a non-array items field', async () => {
    const { status, data } = await api('POST', '/api/jira/push-preview', { items: 'not-array' });
    assertValidationError(status, data);
  });

  test('accepts an empty body (items is optional)', async () => {
    const { status, data } = await api('POST', '/api/jira/push-preview', {});
    // Falls through to the JIRA_API_TOKEN guard, not a validation error.
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});

describe('POST /api/jira/push-sprints-preview — body validation', () => {
  test('rejects a missing items field', async () => {
    const { status, data } = await api('POST', '/api/jira/push-sprints-preview', {
      selectedSprints: [],
    });
    assertValidationError(status, data);
  });

  test('rejects an item missing required fields', async () => {
    const { status, data } = await api('POST', '/api/jira/push-sprints-preview', {
      items: [{ filename: 'a.md' }],
    });
    assertValidationError(status, data);
  });

  test('accepts a well-formed body', async () => {
    const { status, data } = await api('POST', '/api/jira/push-sprints-preview', {
      items: [{ filename: 'a.md', sprint: null, jiraId: '', title: 'A', docType: 'story' }],
      selectedSprints: [],
    });
    // Falls through to the JIRA_API_TOKEN guard, not a validation error.
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});

describe('POST /api/jira/push-sprints — body validation', () => {
  test('rejects a missing items field', async () => {
    const { status, data } = await api('POST', '/api/jira/push-sprints', {});
    assertValidationError(status, data);
  });

  test('rejects an item missing changeType', async () => {
    const { status, data } = await api('POST', '/api/jira/push-sprints', {
      items: [{ filename: 'a.md', sprint: 'Sprint 1' }],
    });
    assertValidationError(status, data);
  });

  test('accepts a well-formed body with optional fields omitted', async () => {
    const { status, data } = await api('POST', '/api/jira/push-sprints', {
      items: [{ filename: 'a.md', sprint: 'Sprint 1', changeType: 'push' }],
    });
    // Falls through to the JIRA_API_TOKEN guard, not a validation error.
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});

describe('POST /api/jira/push-rank — body validation', () => {
  test('rejects a missing key', async () => {
    const { status, data } = await api('POST', '/api/jira/push-rank', { beforeKey: 'X-1' });
    assertValidationError(status, data);
  });

  test('rejects a non-string key', async () => {
    const { status, data } = await api('POST', '/api/jira/push-rank', {
      key: 123,
      beforeKey: 'X-1',
    });
    assertValidationError(status, data);
  });

  test('accepts a well-formed body', async () => {
    const { status, data } = await api('POST', '/api/jira/push-rank', {
      key: 'X-1',
      beforeKey: 'X-2',
    });
    // Falls through to the JIRA_API_TOKEN guard, not a validation error.
    assert.equal(status, 503);
    assert.equal(data.code, 'JIRA_NOT_CONFIGURED');
  });
});
