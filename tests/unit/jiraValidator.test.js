// ── Unit tests: jiraValidator ──────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateJiraConfig } from '../../src/services/jiraValidator.js';

function makeLogger() {
  const infos = [];
  const warns = [];
  return {
    logInfo: (_ctx, msg) => infos.push(msg),
    logWarn: (_ctx, msg) => warns.push(msg),
    infos,
    warns,
  };
}

const VALID_FIELDS = [
  { id: 'customfield_10006', name: 'Story Points' },
  { id: 'customfield_10000', name: 'Epic Link' },
  { id: 'customfield_10002', name: 'Epic Name' },
];

function mockFetch(responses) {
  let callIndex = 0;
  global.fetch = async (_url) => {
    const resp = responses[callIndex++];
    if (resp instanceof Error) throw resp;
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body,
    };
  };
}

describe('validateJiraConfig', () => {
  test('skips validation silently when no JIRA token is set', async () => {
    const log = makeLogger();
    await validateJiraConfig({
      jiraBase: 'https://jira.example.com',
      jiraToken: '',
      fieldStoryPoints: 'customfield_10006',
      fieldEpicLink: 'customfield_10000',
      fieldEpicName: 'customfield_10002',
      ...log,
    });
    assert.ok(
      log.infos.some((m) => m.includes('skipping')),
      'should log skip message'
    );
    assert.equal(log.warns.length, 0);
  });

  test('warns about missing env vars when token present but base URL missing', async () => {
    const log = makeLogger();
    await validateJiraConfig({
      jiraBase: '',
      jiraToken: 'token123',
      fieldStoryPoints: 'customfield_10006',
      fieldEpicLink: 'customfield_10000',
      fieldEpicName: 'customfield_10002',
      ...log,
    });
    assert.ok(log.warns.some((m) => m.includes('JIRA_BASE_URL')));
  });

  test('warns when token is invalid (401)', async () => {
    mockFetch([{ status: 401, body: { message: 'Unauthorized' } }]);
    const log = makeLogger();
    await validateJiraConfig({
      jiraBase: 'https://jira.example.com',
      jiraToken: 'bad-token',
      fieldStoryPoints: 'customfield_10006',
      fieldEpicLink: 'customfield_10000',
      fieldEpicName: 'customfield_10002',
      ...log,
    });
    assert.ok(log.warns.some((m) => m.includes('invalid') || m.includes('401')));
  });

  test('warns when a custom field ID does not exist in JIRA', async () => {
    mockFetch([
      { status: 200, body: { name: 'testuser' } },
      { status: 200, body: [{ id: 'customfield_10006', name: 'Story Points' }] }, // missing epic fields
    ]);
    const log = makeLogger();
    await validateJiraConfig({
      jiraBase: 'https://jira.example.com',
      jiraToken: 'valid-token',
      fieldStoryPoints: 'customfield_10006',
      fieldEpicLink: 'customfield_99999', // unknown
      fieldEpicName: 'customfield_88888', // unknown
      ...log,
    });
    assert.ok(log.warns.some((m) => m.includes('JIRA_FIELD_EPIC_LINK')));
    assert.ok(log.warns.some((m) => m.includes('JIRA_FIELD_EPIC_NAME')));
  });

  test('logs success when all fields are valid', async () => {
    mockFetch([
      { status: 200, body: { name: 'testuser' } },
      { status: 200, body: VALID_FIELDS },
    ]);
    const log = makeLogger();
    await validateJiraConfig({
      jiraBase: 'https://jira.example.com',
      jiraToken: 'valid-token',
      fieldStoryPoints: 'customfield_10006',
      fieldEpicLink: 'customfield_10000',
      fieldEpicName: 'customfield_10002',
      ...log,
    });
    assert.ok(log.infos.some((m) => m.includes('valid')));
    assert.equal(log.warns.length, 0);
  });

  test('handles network errors gracefully', async () => {
    mockFetch([new Error('ECONNREFUSED')]);
    const log = makeLogger();
    await validateJiraConfig({
      jiraBase: 'https://jira.example.com',
      jiraToken: 'valid-token',
      fieldStoryPoints: 'customfield_10006',
      fieldEpicLink: 'customfield_10000',
      fieldEpicName: 'customfield_10002',
      ...log,
    });
    assert.ok(log.warns.some((m) => m.includes('ECONNREFUSED') || m.includes('failed')));
  });
});
