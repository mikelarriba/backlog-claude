// ── Unit tests: src/services/jiraService.js ───────────────────────────────────
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJiraService, LOCAL_TO_JIRA_TYPE, JIRA_TO_LOCAL_TYPE } from '../../src/services/jiraService.js';
import { isoDate, slugify } from '../../src/utils/transforms.js';

let jiraService, tmpRoot;

const TYPE_CONFIG = {
  feature: { command: 'create-features', dir: null, event: 'feature_created' },
  epic:    { command: 'create-epics',    dir: null, event: 'epic_created' },
  story:   { command: 'create-stories',  dir: null, event: 'story_created' },
  spike:   { command: 'create-spikes',   dir: null, event: 'spike_created' },
  bug:     { command: 'create-bugs',     dir: null, event: 'bug_created'   },
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
    fs.writeFileSync(path.join(TYPE_CONFIG.epic.dir(), 'test-epic.md'),
      '---\nJIRA_ID: EAMDM-100\nStatus: Draft\n---\n\n## Test Epic\n');
    fs.writeFileSync(path.join(TYPE_CONFIG.story.dir(), 'test-story.md'),
      '---\nJIRA_ID: EAMDM-200\nStatus: Draft\n---\n\n## Test Story\n');
  });

  test('finds epic by JIRA_ID', () => {
    const result = jiraService.findLocalFileByJiraId('EAMDM-100');
    assert.ok(result);
    assert.equal(result.docType, 'epic');
    assert.equal(result.filename, 'test-epic.md');
  });

  test('finds story by JIRA_ID', () => {
    const result = jiraService.findLocalFileByJiraId('EAMDM-200');
    assert.ok(result);
    assert.equal(result.docType, 'story');
    assert.equal(result.filename, 'test-story.md');
  });

  test('returns null for unknown JIRA_ID', () => {
    const result = jiraService.findLocalFileByJiraId('EAMDM-999');
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
    const result = jiraService.stripFrontmatter('---\nStatus: Draft\n---\n\n## Title\n');
    assert.equal(result, '## Title');
  });

  test('returns content unchanged when no frontmatter', () => {
    assert.equal(jiraService.stripFrontmatter('Just text'), 'Just text');
  });
});
