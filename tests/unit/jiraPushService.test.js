// ── Unit tests: src/services/jiraPushService.js ───────────────────────────────
// Extracted from routes/jira-push-doc.ts (#341) — pushMultiStory/pushSingleIssue
// pulled out of the route so they're testable without an Express request.
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJiraPushService } from '../../src/services/jiraPushService.js';

let tmpRoot, EPICS_DIR, FEATURES_DIR, STORY_DIR, BUGS_DIR;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-push-test-'));
  EPICS_DIR = path.join(tmpRoot, 'epics');
  FEATURES_DIR = path.join(tmpRoot, 'features');
  STORY_DIR = path.join(tmpRoot, 'stories');
  BUGS_DIR = path.join(tmpRoot, 'bugs');
  for (const dir of [EPICS_DIR, FEATURES_DIR, STORY_DIR, BUGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function makeService(overrides = {}) {
  const calls = { jiraRequest: [], broadcast: [], invalidate: [] };
  const jiraRequest =
    overrides.jiraRequest ??
    (async () => {
      throw new Error('unmocked jiraRequest call');
    });
  const service = createJiraPushService({
    EPICS_DIR,
    FEATURES_DIR,
    BUGS_DIR,
    JIRA_PROJECT: 'ABC',
    JIRA_LABEL: 'midas',
    JIRA_BASE: 'https://jira.example.com',
    JIRA_BOARD_ID: '',
    FIELD_EPIC_NAME: 'customfield_epicname',
    FIELD_EPIC_LINK: 'customfield_epiclink',
    FIELD_STORY_POINTS: 'customfield_storypoints',
    jiraRequest: async (method, urlPath, body) => {
      calls.jiraRequest.push({ method, urlPath, body });
      return jiraRequest(method, urlPath, body);
    },
    jiraAgileRequest: async () => ({}),
    jiraUploadAttachment: async () => ({}),
    extractJiraSummary: () => 'Test Summary',
    broadcast: (evt) => calls.broadcast.push(evt),
    logInfo: () => {},
    logWarn: () => {},
    docIndex: {
      invalidate: async (docType, filename) => {
        calls.invalidate.push({ docType, filename });
      },
    },
    ...overrides.ctx,
  });
  return { service, calls };
}

describe('pushSingleIssue — create path (no existing JIRA_ID)', () => {
  let filepath;

  beforeEach(() => {
    filepath = path.join(STORY_DIR, 'new-story.md');
    fs.writeFileSync(
      filepath,
      '---\nJIRA_ID: TBD\nStatus: Draft\nStory_Points: TBD\nTeam: TBD\nFix_Version: TBD\n---\n\n## New Story\n\nSome body text.\n'
    );
  });

  test('creates a JIRA issue and patches the local file with JIRA_ID/JIRA_URL/Status', async () => {
    const { service, calls } = makeService({
      jiraRequest: async (method, urlPath) => {
        if (method === 'POST' && urlPath === '/issue') return { key: 'NEW-1' };
        throw new Error(`unexpected call ${method} ${urlPath}`);
      },
    });

    const result = await service.pushSingleIssue({
      filename: 'new-story.md',
      filepath,
      content: fs.readFileSync(filepath, 'utf-8'),
      type: 'story',
    });

    assert.equal(result.action, 'created');
    assert.equal(result.key, 'NEW-1');

    const updated = fs.readFileSync(filepath, 'utf-8');
    assert.match(updated, /JIRA_ID: NEW-1/);
    assert.match(updated, /JIRA_URL: https:\/\/jira\.example\.com\/browse\/NEW-1/);
    assert.match(updated, /Status: Created in JIRA/);

    assert.equal(calls.invalidate.length, 1);
    assert.deepEqual(calls.invalidate[0], { docType: 'story', filename: 'new-story.md' });
    assert.ok(calls.broadcast.some((e) => e.type === 'status_updated'));
  });
});

describe('pushSingleIssue — update path (existing JIRA_ID)', () => {
  let filepath;

  beforeEach(() => {
    filepath = path.join(STORY_DIR, 'existing-story.md');
    fs.writeFileSync(
      filepath,
      '---\nJIRA_ID: EXIST-1\nStatus: Created in JIRA\nStory_Points: TBD\nTeam: TBD\nFix_Version: TBD\n---\n\n## Existing Story\n\nBody.\n'
    );
  });

  test('updates the JIRA issue in place without touching the local file', async () => {
    const putCalls = [];
    const { service } = makeService({
      jiraRequest: async (method, urlPath, body) => {
        if (method === 'GET' && urlPath.startsWith('/issue/EXIST-1?fields=labels')) {
          return { fields: { labels: [] } };
        }
        if (method === 'PUT' && urlPath === '/issue/EXIST-1') {
          putCalls.push(body);
          return {};
        }
        throw new Error(`unexpected call ${method} ${urlPath}`);
      },
    });

    const result = await service.pushSingleIssue({
      filename: 'existing-story.md',
      filepath,
      content: fs.readFileSync(filepath, 'utf-8'),
      type: 'story',
    });

    assert.equal(result.action, 'updated');
    assert.equal(result.key, 'EXIST-1');
    assert.equal(putCalls.length, 1);
    // Local file is untouched on the update path (only JIRA is patched).
    const contentAfter = fs.readFileSync(filepath, 'utf-8');
    assert.match(contentAfter, /JIRA_ID: EXIST-1/);
  });
});

describe('pushMultiStory', () => {
  let filepath;

  beforeEach(() => {
    filepath = path.join(STORY_DIR, 'multi-stories.md');
    fs.writeFileSync(
      filepath,
      '---\nTeam: TBD\n---\n\n## Story 1: First Story\n\nBody A.\n\n## Story 2: Second Story <!-- JIRA:EXIST-2 -->\n\nBody B.\n'
    );
  });

  test('creates new stories and updates existing ones, tagging new stories with a JIRA marker', async () => {
    const { service, calls } = makeService({
      jiraRequest: async (method, urlPath) => {
        if (method === 'POST' && urlPath === '/issue') return { key: 'NEW-2' };
        if (method === 'PUT' && urlPath === '/issue/EXIST-2') return {};
        throw new Error(`unexpected call ${method} ${urlPath}`);
      },
    });

    const content = fs.readFileSync(filepath, 'utf-8');
    const { frontmatter, sections } = (
      await import('../../src/services/storyService.js')
    ).parseStorySections(content);

    const result = await service.pushMultiStory({
      filename: 'multi-stories.md',
      filepath,
      sections,
      frontmatter,
      type: 'story',
    });

    assert.equal(result.type, 'multi-story');
    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.results.map((r) => r.action).sort(), ['created', 'updated']);

    const updated = fs.readFileSync(filepath, 'utf-8');
    assert.match(updated, /## Story 1: First Story <!-- JIRA:NEW-2 -->/);
    assert.ok(calls.broadcast.some((e) => e.type === 'story_created'));
  });
});
