import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  closedEpicsForScope,
  groupClosedIssues,
  childrenOf,
  pullIssues,
} from '../../src/services/jiraSearchService.ts';

const issue = (key, type, extra = {}) => ({
  key,
  fields: { summary: `S ${key}`, issuetype: { name: type }, status: { name: 'Done' }, ...extra },
});

function deps(over = {}) {
  const calls = [];
  return {
    calls,
    d: {
      JIRA_PROJECT: 'P',
      JIRA_LABEL: 'L',
      JIRA_BOARD_ID: undefined,
      FIELD_EPIC_NAME: 'cf_name',
      FIELD_EPIC_LINK: 'cf_link',
      jiraAgileRequest: async () => ({ values: [] }),
      jiraRequest: async () => [{ name: 'v1', startDate: '2026-01-01', releaseDate: '2026-02-01' }],
      jiraPagedRequest: async (jql) => {
        calls.push(jql);
        if (jql.startsWith('key in')) return [issue('E-1', 'Epic', { cf_name: 'Epic One' })];
        return [issue('S-1', 'Story', { cf_link: 'E-1' }), issue('S-2', 'Story')];
      },
      findExisting: async (k) => (k === 'S-1' ? { filename: 'a.md', docType: 'story' } : null),
      ...over,
    },
  };
}

describe('groupClosedIssues', () => {
  it('groups children under epic link and uses synthetic bucket', () => {
    const m = groupClosedIssues(
      [issue('S-1', 'Story', { cf_link: 'E-1' }), issue('S-2', 'Story')],
      'cf_name',
      'cf_link'
    );
    assert.equal(m.get('E-1').closedChildren.length, 1);
    assert.equal(m.get('(no epic)').isSynthetic, true);
  });
  it('marks closed epics as closed in scope', () => {
    const m = groupClosedIssues([issue('E-9', 'Epic', { cf_name: 'N' })], 'cf_name', 'cf_link');
    assert.equal(m.get('E-9').epicClosedInScope, true);
    assert.equal(m.get('E-9').epicName, 'N');
  });
});

describe('closedEpicsForScope', () => {
  it('resolves a fix version window, fetches epic summaries and local badges', async () => {
    const { d, calls } = deps();
    const r = await closedEpicsForScope('fixversion', 'v1', d);
    assert.equal(r.ok, true);
    assert.equal(r.scope.windowResolved, true);
    assert.match(calls[0], /resolved >= "2026-01-01" AND resolved <= "2026-02-01"/);
    const e1 = r.epics.find((e) => e.key === 'E-1');
    assert.equal(e1.epicName, 'Epic One');
    assert.equal(e1.closedChildren[0].localFilename, 'a.md');
  });
  it('returns 404 for unknown version', async () => {
    const { d } = deps();
    const r = await closedEpicsForScope('fixversion', 'nope', d);
    assert.deepEqual([r.ok, r.status, r.code], [false, 404, 'VERSION_NOT_FOUND']);
  });
  it('returns 400 for sprint scope without board', async () => {
    const { d } = deps();
    const r = await closedEpicsForScope('sprint', 'x', d);
    assert.deepEqual([r.ok, r.status, r.code], [false, 400, 'BOARD_NOT_CONFIGURED']);
  });
  it('omits resolved clause when version has no dates', async () => {
    const { d, calls } = deps({ jiraRequest: async () => [{ name: 'v1' }] });
    const r = await closedEpicsForScope('fixversion', 'v1', d);
    assert.equal(r.scope.windowResolved, false);
    assert.doesNotMatch(calls[0], /resolved/);
  });
});

describe('childrenOf', () => {
  const base = (over = {}) => ({
    JIRA_PROJECT: 'P',
    FIELD_EPIC_LINK: 'customfield_10014',
    findExisting: async (k) => (k === 'S-1' ? { filename: 'a.md', docType: 'story' } : null),
    jiraPagedRequest: async () => [],
    jiraRequest: async () => ({ fields: { issuetype: { name: 'Story' } } }),
    ...over,
  });

  it('collects epic-link children, links and subtasks without duplicates', async () => {
    let jql = '';
    const r = await childrenOf(
      'E-1',
      base({
        jiraRequest: async () => ({
          fields: {
            issuetype: { name: 'Epic' },
            issuelinks: [{ inwardIssue: issue('S-1', 'Story') }, {}],
            subtasks: [issue('T-1', 'Sub-task')],
          },
        }),
        jiraPagedRequest: async (q) => {
          jql = q;
          return [issue('S-1', 'Story'), issue('S-2', 'Story')];
        },
      })
    );
    assert.match(jql, /cf\[10014\] = E-1 AND project = P/);
    assert.equal(r.parentType, 'Epic');
    assert.deepEqual(
      r.children.map((c) => c.key),
      ['S-1', 'S-2', 'T-1']
    );
    assert.equal(r.children[0].localFilename, 'a.md');
    assert.equal(r.children[1].localExists, false);
  });

  it('does not run the epic query for non-epics', async () => {
    let called = false;
    const r = await childrenOf(
      'S-9',
      base({ jiraPagedRequest: async () => ((called = true), []) })
    );
    assert.equal(called, false);
    assert.deepEqual(r.children, []);
  });
});

describe('pullIssues', () => {
  function pullDeps(dir, over = {}) {
    const events = [];
    const invalidated = [];
    return {
      events,
      invalidated,
      d: {
        jiraRequest: async (_m, p) => ({
          fields: { summary: p.includes('NEW-1') ? 'New Thing' : 'Other', labels: [] },
        }),
        findExisting: async () => null,
        jiraIssueToMarkdown: () => ({ docType: 'story', content: '# T\n' }),
        docIndex: {
          get: () => undefined,
          getAll: () => [
            { docType: 'story', rank: 3 },
            { docType: 'story', rank: 7 },
            { docType: 'epic', rank: 99 },
          ],
          invalidate: async (...a) => invalidated.push(a),
        },
        TYPE_CONFIG: { story: { dir: () => dir } },
        broadcast: (e) => events.push(e),
        FIELD_EPIC_NAME: 'cf_name',
        FIELD_STORY_POINTS: 'cf_sp',
        ...over,
      },
    };
  }

  it('writes a new doc at the bottom of the backlog and broadcasts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-'));
    const { d, events, invalidated } = pullDeps(dir);
    const r = await pullIssues({ keys: ['NEW-1'] }, d);
    assert.equal(r.conflicts.length, 0);
    assert.equal(r.pulled.length, 1);
    assert.equal(r.pulled[0].key, 'NEW-1');
    assert.match(r.pulled[0].filename, /new-thing\.md$/);
    const written = fs.readFileSync(path.join(dir, r.pulled[0].filename), 'utf8');
    assert.match(written, /Rank: '8'/);
    assert.match(written, /Fix_Version: TBD/);
    assert.equal(events[0].type, 'story_created');
    assert.equal(invalidated.length, 1);
  });

  it('reports a conflict without fetching or writing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-'));
    let fetched = false;
    const { d } = pullDeps(dir, {
      findExisting: async () => ({ filename: 'old.md', docType: 'story' }),
      jiraRequest: async () => ((fetched = true), {}),
    });
    const r = await pullIssues({ keys: ['X-1'] }, d);
    assert.deepEqual(r.conflicts, [
      { key: 'X-1', existingFilename: 'old.md', existingDocType: 'story' },
    ]);
    assert.equal(r.pulled.length, 0);
    assert.equal(fetched, false);
    assert.equal(fs.readdirSync(dir).length, 0);
  });
});
