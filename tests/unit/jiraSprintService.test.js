// ── Unit tests: src/services/jiraSprintService.js ─────────────────────────────
// Extracted from routes/jira-push-sprints.ts (#341).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSprintNameMap,
  fetchSprintIssuesOnBoard,
  fetchUnimportedSprintIssues,
  buildSprintPushPreview,
} from '../../src/services/jiraSprintService.js';

describe('buildSprintNameMap', () => {
  test('maps exact matches both ways', () => {
    const jiraMap = new Map([['Sprint 100', 1]]);
    const { localToJira, jiraToLocal } = buildSprintNameMap(['Sprint 100'], jiraMap);
    assert.equal(localToJira.get('Sprint 100'), 'Sprint 100');
    assert.equal(jiraToLocal.get('Sprint 100'), 'Sprint 100');
  });

  test('maps a local name to a JIRA name that has it as a suffix', () => {
    const jiraMap = new Map([['MIDAS Sprint 100', 1]]);
    const { localToJira, jiraToLocal } = buildSprintNameMap(['Sprint 100'], jiraMap);
    assert.equal(localToJira.get('Sprint 100'), 'MIDAS Sprint 100');
    assert.equal(jiraToLocal.get('MIDAS Sprint 100'), 'Sprint 100');
  });

  test('leaves unmatched local names unmapped', () => {
    const jiraMap = new Map([['Sprint 1', 1]]);
    const { localToJira } = buildSprintNameMap(['Sprint 999'], jiraMap);
    assert.equal(localToJira.has('Sprint 999'), false);
  });
});

describe('fetchSprintIssuesOnBoard', () => {
  test('follows pagination until a short page is returned', async () => {
    const calls = [];
    const jiraAgileRequest = async (_method, urlPath) => {
      calls.push(urlPath);
      const startAt = Number(new URL(`http://x${urlPath}`).searchParams.get('startAt'));
      if (startAt === 0) {
        return {
          issues: Array.from({ length: 100 }, (_, i) => ({
            key: `K-${i}`,
            fields: { summary: 's' },
          })),
        };
      }
      return { issues: [{ key: 'K-last', fields: { summary: 'last' } }] };
    };
    const issues = await fetchSprintIssuesOnBoard(jiraAgileRequest, 'BOARD1', 5);
    assert.equal(issues.length, 101);
    assert.equal(calls.length, 2);
    assert.equal(issues[100].key, 'K-last');
  });
});

describe('fetchUnimportedSprintIssues', () => {
  test('skips issues that already exist locally', async () => {
    const jiraAgileRequest = async () => ({
      issues: [
        { key: 'A-1', fields: { summary: 'One', issuetype: { name: 'Story' } } },
        { key: 'A-2', fields: { summary: 'Two', issuetype: { name: 'Bug' } } },
      ],
      total: 2,
    });
    const findByJiraId = (jiraId) =>
      jiraId === 'A-1' ? { docType: 'story', filename: 'x.md' } : null;
    const results = await fetchUnimportedSprintIssues(
      jiraAgileRequest,
      1,
      'Sprint 1',
      'customfield_10002',
      findByJiraId
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].key, 'A-2');
    assert.equal(results[0].sprintName, 'Sprint 1');
  });
});

describe('buildSprintPushPreview', () => {
  const sprintMap = new Map([['MIDAS Sprint 100', 10]]);
  const localToJira = new Map([['Sprint 100', 'MIDAS Sprint 100']]);
  const jiraToLocal = new Map([['MIDAS Sprint 100', 'Sprint 100']]);

  test('reports "add" when the local sprint has no JIRA sprint yet', () => {
    const result = buildSprintPushPreview({
      filteredItems: [
        { filename: 'a.md', sprint: 'Sprint 100', jiraId: 'A-1', title: 'A', docType: 'story' },
      ],
      jiraSprintMap: new Map(),
      sprintMap,
      localToJira,
      jiraToLocal,
      findByJiraId: () => null,
      getLocalEntry: () => null,
    });
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].changeType, 'add');
    assert.equal(result.stats.adds, 1);
  });

  test('reports "unchanged" when local and JIRA sprint already match', () => {
    const jiraSprintMap = new Map([
      ['A-1', { sprintName: 'MIDAS Sprint 100', sprintId: 10, summary: 'A' }],
    ]);
    const result = buildSprintPushPreview({
      filteredItems: [
        { filename: 'a.md', sprint: 'Sprint 100', jiraId: 'A-1', title: 'A', docType: 'story' },
      ],
      jiraSprintMap,
      sprintMap,
      localToJira,
      jiraToLocal,
      findByJiraId: () => null,
      getLocalEntry: () => null,
    });
    assert.equal(result.changes.length, 0);
    assert.equal(result.stats.unchanged, 1);
  });

  test('reports "pull" when JIRA has a sprint but local has none', () => {
    const jiraSprintMap = new Map([
      ['A-1', { sprintName: 'MIDAS Sprint 100', sprintId: 10, summary: 'A' }],
    ]);
    const result = buildSprintPushPreview({
      filteredItems: [
        { filename: 'a.md', sprint: null, jiraId: 'A-1', title: 'A', docType: 'story' },
      ],
      jiraSprintMap,
      sprintMap,
      localToJira,
      jiraToLocal,
      findByJiraId: () => null,
      getLocalEntry: () => null,
    });
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].changeType, 'pull');
    assert.equal(result.stats.pulls, 1);
  });

  test('reports an error when the local sprint name is not found on the board', () => {
    const result = buildSprintPushPreview({
      filteredItems: [
        { filename: 'a.md', sprint: 'Unknown Sprint', jiraId: 'A-1', title: 'A', docType: 'story' },
      ],
      jiraSprintMap: new Map(),
      sprintMap,
      localToJira,
      jiraToLocal,
      findByJiraId: () => null,
      getLocalEntry: () => null,
    });
    assert.equal(result.changes.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /not found on board/);
  });
});
