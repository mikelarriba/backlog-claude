// ── Unit tests: src/services/jiraService.js ───────────────────────────────────
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createJiraService,
  LOCAL_TO_JIRA_TYPE,
  JIRA_TO_LOCAL_TYPE,
  resolveEpicLink,
  syncContainsLink,
} from '../../src/services/jiraService.js';
import { isoDate, slugify, stripFrontmatter } from '../../src/utils/transforms.js';

let jiraService, tmpRoot;

const TYPE_CONFIG = {
  feature: { command: 'create-features', dir: null, event: 'feature_created' },
  epic: { command: 'create-epics', dir: null, event: 'epic_created' },
  story: { command: 'create-stories', dir: null, event: 'story_created' },
  spike: { command: 'create-spikes', dir: null, event: 'spike_created' },
  bug: { command: 'create-bugs', dir: null, event: 'bug_created' },
};

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-test-'));
  for (const type of Object.keys(TYPE_CONFIG)) {
    const dir = path.join(tmpRoot, type);
    fs.mkdirSync(dir, { recursive: true });
    TYPE_CONFIG[type].dir = () => dir;
  }

  jiraService = createJiraService({
    JIRA_BASE: 'https://jira.example.com',
    JIRA_TOKEN: 'test-token',
    FIELD_EPIC_NAME: 'customfield_10002',
    TYPE_CONFIG,
    isoDate,
    slugify,
  });
});

// ── Type mappings ────────────────────────────────────────────────────────────
describe('JIRA type mappings', () => {
  test('LOCAL_TO_JIRA_TYPE maps all local types', () => {
    assert.equal(LOCAL_TO_JIRA_TYPE.feature, 'New Feature');
    assert.equal(LOCAL_TO_JIRA_TYPE.epic, 'Epic');
    assert.equal(LOCAL_TO_JIRA_TYPE.story, 'Story');
    assert.equal(LOCAL_TO_JIRA_TYPE.spike, 'Task');
  });

  test('JIRA_TO_LOCAL_TYPE is the reverse mapping', () => {
    for (const [local, jira] of Object.entries(LOCAL_TO_JIRA_TYPE)) {
      assert.equal(JIRA_TO_LOCAL_TYPE[jira], local);
    }
  });
});

// ── findLocalFileByJiraId ────────────────────────────────────────────────────
describe('findLocalFileByJiraId', () => {
  before(() => {
    // Write a test doc with a known JIRA_ID
    fs.writeFileSync(
      path.join(TYPE_CONFIG.epic.dir(), 'test-epic.md'),
      '---\nJIRA_ID: EAMDM-100\nStatus: Draft\n---\n\n## Test Epic\n'
    );
    fs.writeFileSync(
      path.join(TYPE_CONFIG.story.dir(), 'test-story.md'),
      '---\nJIRA_ID: EAMDM-200\nStatus: Draft\n---\n\n## Test Story\n'
    );
  });

  test('finds epic by JIRA_ID', async () => {
    const result = await jiraService.findLocalFileByJiraId('EAMDM-100');
    assert.ok(result);
    assert.equal(result.docType, 'epic');
    assert.equal(result.filename, 'test-epic.md');
  });

  test('finds story by JIRA_ID', async () => {
    const result = await jiraService.findLocalFileByJiraId('EAMDM-200');
    assert.ok(result);
    assert.equal(result.docType, 'story');
    assert.equal(result.filename, 'test-story.md');
  });

  test('returns null for unknown JIRA_ID', async () => {
    const result = await jiraService.findLocalFileByJiraId('EAMDM-999');
    assert.equal(result, null);
  });
});

// ── jiraIssueToMarkdown ─────────────────────────────────────────────────────
describe('jiraIssueToMarkdown', () => {
  test('converts a JIRA issue to markdown with correct frontmatter', () => {
    const issue = {
      key: 'EAMDM-42',
      fields: {
        summary: 'Test Summary',
        description: 'Some description text.',
        issuetype: { name: 'Epic' },
        priority: { name: 'High' },
        fixVersions: [{ name: 'PI-2026.1' }],
      },
    };
    const { docType, content } = jiraService.jiraIssueToMarkdown(issue);
    assert.equal(docType, 'epic');
    assert.match(content, /^JIRA_ID: EAMDM-42$/m);
    assert.match(content, /^Status: Created in JIRA$/m);
    assert.match(content, /^Priority: High$/m);
    assert.match(content, /^Fix_Version: PI-2026\.1$/m);
    assert.match(content, /## Test Summary/);
    assert.match(content, /Some description text\./);
  });

  test('handles missing fields gracefully', () => {
    const issue = {
      key: 'EAMDM-1',
      fields: { summary: 'Minimal', issuetype: {}, fixVersions: [] },
    };
    const { docType, content } = jiraService.jiraIssueToMarkdown(issue);
    assert.equal(docType, 'epic');
    assert.match(content, /^Fix_Version: TBD$/m);
    assert.match(content, /^Priority: Medium$/m);
    assert.match(content, /_No description in JIRA\._/);
  });

  test('maps Story issue type to story docType', () => {
    const issue = {
      key: 'EAMDM-3',
      fields: { summary: 'A Story', issuetype: { name: 'Story' }, fixVersions: [] },
    };
    const { docType } = jiraService.jiraIssueToMarkdown(issue);
    assert.equal(docType, 'story');
  });
});

// ── extractJiraSummary ──────────────────────────────────────────────────────
describe('extractJiraSummary', () => {
  test('extracts from ## Story N: Title format', () => {
    assert.equal(jiraService.extractJiraSummary('## Story 1: Login flow'), 'Login flow');
  });

  test('extracts from ## Story N: Title with JIRA comment', () => {
    assert.equal(
      jiraService.extractJiraSummary('## Story 1: Login flow <!-- JIRA:EAMDM-10 -->'),
      'Login flow'
    );
  });

  test('extracts from ## Epic Title template pattern', () => {
    assert.equal(
      jiraService.extractJiraSummary('## Epic Title\n\nMy Real Title\n'),
      'My Real Title'
    );
  });

  test('extracts from ## heading', () => {
    assert.equal(jiraService.extractJiraSummary('## My Feature\n\nBody'), 'My Feature');
  });

  test('extracts from # heading as fallback', () => {
    assert.equal(jiraService.extractJiraSummary('# Top Level\n\nBody'), 'Top Level');
  });

  test('returns Untitled for content with no headings', () => {
    assert.equal(jiraService.extractJiraSummary('Just some text'), 'Untitled');
  });
});

// ── stripFrontmatter ────────────────────────────────────────────────────────
describe('stripFrontmatter', () => {
  test('removes YAML frontmatter', () => {
    const result = stripFrontmatter('---\nStatus: Draft\n---\n\n## Title\n');
    assert.equal(result, '## Title');
  });

  test('returns content unchanged when no frontmatter', () => {
    assert.equal(stripFrontmatter('Just text'), 'Just text');
  });
});

// ── resolveEpicLink (#422 dedup) ───────────────────────────────────────────────
// Shared by jira-push-doc.ts's push-preview and jiraPushService.ts's create/update
// paths, which previously each reimplemented this resolution independently.
describe('resolveEpicLink', () => {
  let epicsDir;

  before(() => {
    epicsDir = path.join(tmpRoot, 'resolve-epic-link-epics');
    fs.mkdirSync(epicsDir, { recursive: true });
    fs.writeFileSync(
      path.join(epicsDir, 'linked-epic.md'),
      '---\nJIRA_ID: EAMDM-100\n---\n\n## Linked Epic\n'
    );
    fs.writeFileSync(
      path.join(epicsDir, 'unpushed-epic.md'),
      '---\nJIRA_ID: TBD\n---\n\n## Unpushed Epic\n'
    );
  });

  test('returns nulls when Epic_ID is absent', async () => {
    const result = await resolveEpicLink('---\nStatus: Draft\n---\n', epicsDir);
    assert.deepEqual(result, { epicFilename: null, epicJiraId: null });
  });

  test('returns nulls when Epic_ID is the TBD placeholder', async () => {
    const result = await resolveEpicLink('---\nEpic_ID: TBD\n---\n', epicsDir);
    assert.deepEqual(result, { epicFilename: null, epicJiraId: null });
  });

  test('resolves the epic filename and its JIRA key when the epic is already in JIRA', async () => {
    const result = await resolveEpicLink('---\nEpic_ID: linked-epic.md\n---\n', epicsDir);
    assert.deepEqual(result, { epicFilename: 'linked-epic.md', epicJiraId: 'EAMDM-100' });
  });

  test('returns the epic filename but a null JIRA key when the epic has not been pushed yet', async () => {
    const result = await resolveEpicLink('---\nEpic_ID: unpushed-epic.md\n---\n', epicsDir);
    assert.deepEqual(result, { epicFilename: 'unpushed-epic.md', epicJiraId: null });
  });

  test('returns the epic filename but a null JIRA key when the epic file does not exist', async () => {
    const result = await resolveEpicLink('---\nEpic_ID: missing-epic.md\n---\n', epicsDir);
    assert.deepEqual(result, { epicFilename: 'missing-epic.md', epicJiraId: null });
  });
});

// ── syncContainsLink (#422 dedup) ──────────────────────────────────────────────
// Shared by jiraPushService.ts's create and update paths, which previously each
// had a verbatim copy of this "epic contains feature" link-creation block.
describe('syncContainsLink', () => {
  let epicsDir, featuresDir;
  const noopLogWarn = () => {};

  before(() => {
    epicsDir = path.join(tmpRoot, 'sync-contains-epics');
    featuresDir = path.join(tmpRoot, 'sync-contains-features');
    fs.mkdirSync(epicsDir, { recursive: true });
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.writeFileSync(
      path.join(featuresDir, 'linked-feature.md'),
      '---\nJIRA_ID: EAMDM-200\n---\n\n## Linked Feature\n'
    );
    fs.writeFileSync(
      path.join(featuresDir, 'unpushed-feature.md'),
      '---\nJIRA_ID: TBD\n---\n\n## Unpushed Feature\n'
    );
  });

  test('is a no-op for non-epic types', async () => {
    const calls = [];
    await syncContainsLink(
      '---\nFeature_ID: linked-feature.md\n---\n',
      'story',
      'EAMDM-1',
      featuresDir,
      async (...args) => calls.push(args),
      noopLogWarn
    );
    assert.equal(calls.length, 0);
  });

  test('is a no-op when Feature_ID is absent or TBD', async () => {
    const calls = [];
    const jiraRequest = async (...args) => calls.push(args);
    await syncContainsLink(
      '---\nStatus: Draft\n---\n',
      'epic',
      'EAMDM-1',
      featuresDir,
      jiraRequest,
      noopLogWarn
    );
    await syncContainsLink(
      '---\nFeature_ID: TBD\n---\n',
      'epic',
      'EAMDM-1',
      featuresDir,
      jiraRequest,
      noopLogWarn
    );
    assert.equal(calls.length, 0);
  });

  test('is a no-op when the linked feature has not been pushed to JIRA yet', async () => {
    const calls = [];
    await syncContainsLink(
      '---\nFeature_ID: unpushed-feature.md\n---\n',
      'epic',
      'EAMDM-1',
      featuresDir,
      async (...args) => calls.push(args),
      noopLogWarn
    );
    assert.equal(calls.length, 0);
  });

  test('creates the "contains" issue link when the epic has a pushed feature', async () => {
    const calls = [];
    const jiraRequest = async (method, urlPath, body) => {
      calls.push({ method, urlPath, body });
      if (urlPath === '/issueLinkType') {
        return {
          issueLinkTypes: [{ name: 'Contains', inward: 'is part of', outward: 'contains' }],
        };
      }
      return {};
    };
    await syncContainsLink(
      '---\nFeature_ID: linked-feature.md\n---\n',
      'epic',
      'EAMDM-1',
      featuresDir,
      jiraRequest,
      noopLogWarn
    );
    const linkCall = calls.find((c) => c.urlPath === '/issueLink');
    assert.ok(linkCall, 'expected an /issueLink call');
    assert.equal(linkCall.method, 'POST');
    assert.deepEqual(linkCall.body, {
      type: { name: 'Contains' },
      inwardIssue: { key: 'EAMDM-1' },
      outwardIssue: { key: 'EAMDM-200' },
    });
  });

  test('logs a warning instead of throwing when the JIRA link call fails', async () => {
    const warnings = [];
    const jiraRequest = async (method, urlPath) => {
      if (urlPath === '/issueLinkType')
        return { issueLinkTypes: [{ name: 'Contains', inward: '', outward: 'contains' }] };
      if (urlPath === '/issueLink') throw new Error('link already exists');
      return {};
    };
    await syncContainsLink(
      '---\nFeature_ID: linked-feature.md\n---\n',
      'epic',
      'EAMDM-1',
      featuresDir,
      jiraRequest,
      (_ctx, msg) => warnings.push(msg)
    );
    assert.ok(warnings.some((w) => w.includes('link already exists')));
  });
});
