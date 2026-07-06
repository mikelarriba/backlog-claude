// ── Unit tests: src/services/docIndex.js ──────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDocIndex } from '../../src/services/docIndex.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const FRONTMATTER = (extra = '') => `---\nStatus: Draft\nPriority: Medium\n${extra}---\n`;

function makeTypeConfig(docsRoot) {
  return {
    epic: { dir: () => path.join(docsRoot, 'epics') },
    story: { dir: () => path.join(docsRoot, 'stories') },
    feature: { dir: () => path.join(docsRoot, 'features') },
    spike: { dir: () => path.join(docsRoot, 'spikes') },
    bug: { dir: () => path.join(docsRoot, 'bugs') },
  };
}

function writeDoc(dir, filename, extra = '') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, filename),
    `${FRONTMATTER(extra)}\n## ${filename.replace('.md', '')}\n`
  );
}

// ── Large graph test ──────────────────────────────────────────────────────────

describe('docIndex — large graph', () => {
  let tmpRoot, docIndex;
  const COUNT = 100;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docindex-test-'));
    const TYPE_CONFIG = makeTypeConfig(tmpRoot);
    const epicDir = TYPE_CONFIG.epic.dir();
    fs.mkdirSync(epicDir, { recursive: true });

    // Write 100 epic markdown files
    for (let i = 1; i <= COUNT; i++) {
      const filename = `2026-01-${String(i).padStart(2, '0')}-epic-${i}.md`;
      writeDoc(epicDir, filename);
    }

    docIndex = createDocIndex({ TYPE_CONFIG });
    await docIndex.build();
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test(`getAll returns all ${COUNT} entries`, () => {
    assert.equal(docIndex.getAll().length, COUNT);
  });

  test('getAll returns entries sorted newest-first (by filename)', () => {
    const all = docIndex.getAll();
    for (let i = 0; i < all.length - 1; i++) {
      assert.ok(
        all[i].filename >= all[i + 1].filename,
        `Expected ${all[i].filename} >= ${all[i + 1].filename}`
      );
    }
  });

  test('get(filename) returns the correct entry', () => {
    const filename = '2026-01-05-epic-5.md';
    const entry = docIndex.get(filename);
    assert.ok(entry, 'entry should exist');
    assert.equal(entry.filename, filename);
    assert.equal(entry.docType, 'epic');
  });

  test('invalidate after file write updates the entry', async () => {
    const epicDir = path.join(tmpRoot, 'epics');
    const filename = '2026-01-10-epic-10.md';
    const filepath = path.join(epicDir, filename);

    // Patch the file to change status
    const original = fs.readFileSync(filepath, 'utf-8');
    fs.writeFileSync(filepath, original.replace('Status: Draft', 'Status: Archived'));

    await docIndex.invalidate('epic', filename);
    const updated = docIndex.get(filename);
    assert.equal(updated.status, 'Archived');
  });

  test('invalidate of a deleted file removes the entry', async () => {
    const epicDir = path.join(tmpRoot, 'epics');
    const filename = '2026-01-20-epic-20.md';
    fs.unlinkSync(path.join(epicDir, filename));

    await docIndex.invalidate('epic', filename);
    assert.equal(docIndex.get(filename), null);
  });

  test('getAll count decreases after invalidate of deleted file', () => {
    assert.equal(docIndex.getAll().length, COUNT - 1); // we deleted one above
  });

  test('invalidateAll rebuilds the index completely', async () => {
    await docIndex.invalidateAll();
    // one was deleted, so count should remain COUNT - 1
    assert.equal(docIndex.getAll().length, COUNT - 1);
  });

  test('build completes in < 500ms for 100 files', async () => {
    const start = Date.now();
    await docIndex.build();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `Build took ${elapsed}ms, expected < 500ms`);
  });
});

// ── Dependency fields ──────────────────────────────────────────────────────────

describe('docIndex — dependency fields', () => {
  let tmpRoot, docIndex;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docindex-dep-'));
    const TYPE_CONFIG = makeTypeConfig(tmpRoot);
    const storyDir = TYPE_CONFIG.story.dir();
    fs.mkdirSync(storyDir, { recursive: true });

    writeDoc(storyDir, 'story-a.md', 'Blocks: story-b.md, story-c.md\n');
    writeDoc(storyDir, 'story-b.md', 'Blocked_By: story-a.md\n');
    writeDoc(storyDir, 'story-c.md', 'Blocked_By: story-a.md\n');

    docIndex = createDocIndex({ TYPE_CONFIG });
    await docIndex.build();
  });

  after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  test('blocks field is parsed as array', () => {
    const entry = docIndex.get('story-a.md');
    assert.deepEqual(entry.blocks, ['story-b.md', 'story-c.md']);
  });

  test('blockedBy field is parsed as array', () => {
    const entry = docIndex.get('story-b.md');
    assert.deepEqual(entry.blockedBy, ['story-a.md']);
  });

  test('TBD values in dependency fields are excluded', async () => {
    const storyDir = path.join(tmpRoot, 'stories');
    fs.writeFileSync(
      path.join(storyDir, 'story-d.md'),
      `${FRONTMATTER('Blocks: TBD\nBlocked_By: TBD\n')}\n## story-d\n`
    );
    await docIndex.invalidate('story', 'story-d.md');
    const entry = docIndex.get('story-d.md');
    assert.deepEqual(entry.blocks, []);
    assert.deepEqual(entry.blockedBy, []);
  });
});

// ── findByJiraId edge cases ────────────────────────────────────────────────────

describe('docIndex — findByJiraId edge cases', () => {
  let tmpRoot, docIndex;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docindex-jiraid-'));
    const TYPE_CONFIG = makeTypeConfig(tmpRoot);
    const storyDir = TYPE_CONFIG.story.dir();
    const epicDir = TYPE_CONFIG.epic.dir();
    fs.mkdirSync(storyDir, { recursive: true });
    fs.mkdirSync(epicDir, { recursive: true });

    // Two docs that (incorrectly) share the same JIRA_ID — should not happen in
    // practice, but the index must not throw or silently merge them.
    writeDoc(storyDir, 'story-dup-1.md', 'JIRA_ID: EAMDM-1\n');
    writeDoc(storyDir, 'story-dup-2.md', 'JIRA_ID: EAMDM-1\n');
    // Three docs sharing a different JIRA_ID, to confirm the "return the first
    // match" behavior holds even with more than two duplicates.
    writeDoc(epicDir, 'epic-triple-1.md', 'JIRA_ID: EAMDM-3\n');
    writeDoc(epicDir, 'epic-triple-2.md', 'JIRA_ID: EAMDM-3\n');
    writeDoc(epicDir, 'epic-triple-3.md', 'JIRA_ID: EAMDM-3\n');
    // A doc with an explicit "TBD" JIRA_ID (not yet pushed to JIRA).
    writeDoc(storyDir, 'story-tbd.md', 'JIRA_ID: TBD\n');
    // A doc with no JIRA_ID field in frontmatter at all.
    writeDoc(epicDir, 'epic-no-jiraid.md');
    // A normal, uniquely-identified doc for a sanity-check lookup.
    writeDoc(epicDir, 'epic-unique.md', 'JIRA_ID: EAMDM-2\n');

    docIndex = createDocIndex({ TYPE_CONFIG });
    await docIndex.build();
  });

  after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  test('resolves a unique JIRA_ID to its doc', () => {
    const result = docIndex.findByJiraId('EAMDM-2');
    assert.deepEqual(result, { docType: 'epic', filename: 'epic-unique.md' });
  });

  test('returns exactly one match (not a throw or a merged result) when the JIRA_ID is duplicated across docs', () => {
    const result = docIndex.findByJiraId('EAMDM-1');
    assert.ok(result, 'expected a match');
    assert.equal(result.docType, 'story');
    assert.ok(
      ['story-dup-1.md', 'story-dup-2.md'].includes(result.filename),
      `expected one of the duplicate filenames, got ${result.filename}`
    );
  });

  test('returns null for a "TBD" JIRA_ID', () => {
    assert.equal(docIndex.findByJiraId('TBD'), null);
  });

  test('returns null when looked up id is empty', () => {
    assert.equal(docIndex.findByJiraId(''), null);
  });

  test('does not match a doc with no JIRA_ID field at all', () => {
    // The doc without a JIRA_ID should simply never be found by any lookup —
    // confirm the index didn't crash while indexing it, and that an unrelated
    // id doesn't accidentally match it.
    assert.equal(docIndex.findByJiraId('EAMDM-999'), null);
    assert.equal(docIndex.get('epic-no-jiraid.md').jiraId, null);
  });

  test('lookup is case-sensitive: a differently-cased id does not match', () => {
    assert.equal(docIndex.findByJiraId('eamdm-2'), null);
  });

  test('returns exactly one match when the JIRA_ID is duplicated across three docs', () => {
    const result = docIndex.findByJiraId('EAMDM-3');
    assert.ok(result, 'expected a match');
    assert.equal(result.docType, 'epic');
    assert.ok(
      ['epic-triple-1.md', 'epic-triple-2.md', 'epic-triple-3.md'].includes(result.filename),
      `expected one of the triplicate filenames, got ${result.filename}`
    );
  });
});
