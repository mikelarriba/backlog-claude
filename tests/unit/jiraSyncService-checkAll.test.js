import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createJiraSyncService } from '../../src/services/jiraSyncService.ts';

describe('jiraSyncService.checkAll', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-all-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const build = (issues) =>
    createJiraSyncService({
      INBOX_DIR: dir,
      FIELD_STORY_POINTS: 'customfield_sp',
      TYPE_CONFIG: { story: { dir: () => dir } },
      jiraRequest: async (_m, url) => {
        const key = url.split('/issue/')[1].split('?')[0];
        if (!issues[key]) throw new Error('not found');
        return issues[key];
      },
      jiraIssueToMarkdown: () => ({ docType: 'story', content: '' }),
      logWarn: () => {},
    });

  const doc = (jiraId, filename = `${jiraId}.md`) => ({ filename, docType: 'story', jiraId });

  it('reports unchanged, changed and errored docs', async () => {
    fs.writeFileSync(path.join(dir, 'A-1.md'), '---\nStory_Points: 3\n---\n\n## Same\n\nbody\n');
    fs.writeFileSync(path.join(dir, 'A-2.md'), '---\nStory_Points: 3\n---\n\n## Old\n\nbody\n');
    const svc = build({
      'A-1': { fields: { summary: 'Same', description: 'body', customfield_sp: 3 } },
      'A-2': { fields: { summary: 'New', description: 'body', customfield_sp: 5 } },
    });
    const res = await svc.checkAll([doc('A-1'), doc('A-2'), doc('A-3')]);
    assert.deepEqual(res.skipped, ['A-1']);
    assert.equal(res.changed.length, 1);
    assert.equal(res.changed[0].jiraId, 'A-2');
    assert.deepEqual(res.changed[0].changes.summary, { local: 'Old', jira: 'New' });
    assert.deepEqual(res.changed[0].changes.storyPoints, { local: 3, jira: 5 });
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0].jiraId, 'A-3');
  });

  it('falls back to empty local values when the file is unreadable', async () => {
    const svc = build({ 'B-1': { fields: { summary: 'Title', description: '' } } });
    const res = await svc.checkAll([doc('B-1')]);
    assert.equal(res.changed.length, 1);
    assert.equal(res.changed[0].title, '');
  });
});
