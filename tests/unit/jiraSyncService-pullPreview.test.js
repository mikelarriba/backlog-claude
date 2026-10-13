import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createJiraSyncService } from '../../src/services/jiraSyncService.ts';

describe('jiraSyncService.buildPullPreview', () => {
  const build = ({ issues, local = [] }) =>
    createJiraSyncService({
      INBOX_DIR: '/nonexistent',
      FIELD_STORY_POINTS: 'customfield_sp',
      FIELD_EPIC_NAME: 'customfield_en',
      FIELD_EPIC_LINK: '',
      JIRA_PROJECT: 'P',
      TYPE_CONFIG: { story: { dir: () => '/nonexistent' } },
      jiraRequest: async (_m, url) => {
        const key = url.split('/issue/')[1].split('?')[0];
        if (!issues[key]) throw new Error('not found');
        return issues[key];
      },
      jiraIssueToMarkdown: () => ({ docType: 'story', content: '' }),
      extractJiraSummary: () => '',
      findLocalFileByJiraId: async () => null,
      docIndex: {
        findByJiraId: (id) => local.find((e) => e.jiraId === id),
        getAll: () => local,
      },
      logWarn: () => {},
    });

  const issue = (key, extra = {}) => ({
    key,
    fields: { summary: key, issuetype: { name: 'Story' }, ...extra },
  });

  it('returns a single item when children are not requested', async () => {
    const svc = build({ issues: { 'A-1': issue('A-1') } });
    const items = await svc.buildPullPreview({ jiraKey: 'A-1' });
    assert.equal(items.length, 1);
    assert.equal(items[0].jiraKey, 'A-1');
  });

  it('includes inward-linked children and offers deletion for missing local children', async () => {
    const svc = build({
      issues: {
        'A-1': issue('A-1', { issuelinks: [{ inwardIssue: { key: 'A-2' } }] }),
        'A-2': issue('A-2'),
      },
      local: [
        { jiraId: 'A-1', filename: 'p.md', docType: 'story' },
        {
          jiraId: 'A-9',
          filename: 'gone.md',
          docType: 'story',
          parentFilename: 'p.md',
          title: 'G',
        },
      ],
    });
    const items = await svc.buildPullPreview({ jiraKey: 'A-1', includeChildren: true });
    assert.deepEqual(
      items.map((i) => i.jiraKey),
      ['A-1', 'A-2', 'A-9']
    );
    assert.equal(items[2].action, 'delete');
    assert.equal(items[2].reason, 'Not found in JIRA');
  });
});
