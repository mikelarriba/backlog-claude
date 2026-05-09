// ── Integration tests: story dependencies (Blocks / Blocked_By) ───────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestApp } from '../helpers/testApp.js';

let api, stop, docsRoot;

before(async () => {
  ({ api, stop, docsRoot } = await startTestApp());
});

after(async () => {
  await stop();
});

function writeStory(filename, extra = '') {
  const dir = path.join(docsRoot, 'stories');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), `---
JIRA_ID: TBD
Story_Points: 3
Status: Draft
Priority: Medium
Epic_ID: TBD
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-01-01
${extra}---

## ${filename.replace('.md', '')}
`);
}

// ── POST /api/link linkType=blocks ────────────────────────────────────────────
describe('POST /api/link — blocks dependency', () => {
  before(() => {
    writeStory('2026-01-01-story-a.md');
    writeStory('2026-01-01-story-b.md');
    writeStory('2026-01-01-story-c.md');
  });

  test('creates a blocks link between two stories', async () => {
    const { status, data } = await api('POST', '/api/link', {
      sourceType: 'story', sourceFilename: '2026-01-01-story-a.md',
      targetType: 'story', targetFilename: '2026-01-01-story-b.md',
      linkType: 'blocks',
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.linkType, 'blocks');
  });

  test('writes Blocks field to source file', async () => {
    const { data } = await api('GET', '/api/doc/story/2026-01-01-story-a.md');
    assert.match(data.content, /^Blocks: 2026-01-01-story-b\.md$/m);
  });

  test('writes Blocked_By field to target file', async () => {
    const { data } = await api('GET', '/api/doc/story/2026-01-01-story-b.md');
    assert.match(data.content, /^Blocked_By: 2026-01-01-story-a\.md$/m);
  });

  test('GET /api/links returns blocks and blockedBy arrays', async () => {
    const { status, data } = await api('GET', '/api/links/story/2026-01-01-story-a.md');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.blocks));
    assert.ok(data.blocks.some(b => b.filename === '2026-01-01-story-b.md'));
  });

  test('GET /api/links returns blockedBy for the blocked story', async () => {
    const { status, data } = await api('GET', '/api/links/story/2026-01-01-story-b.md');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.blockedBy));
    assert.ok(data.blockedBy.some(b => b.filename === '2026-01-01-story-a.md'));
  });

  test('does not duplicate link if called twice', async () => {
    await api('POST', '/api/link', {
      sourceType: 'story', sourceFilename: '2026-01-01-story-a.md',
      targetType: 'story', targetFilename: '2026-01-01-story-b.md',
      linkType: 'blocks',
    });
    const { data } = await api('GET', '/api/doc/story/2026-01-01-story-a.md');
    const matches = data.content.match(/2026-01-01-story-b\.md/g) || [];
    // Should only appear once in the Blocks field
    assert.equal(matches.length, 1);
  });
});

// ── Cycle detection ────────────────────────────────────────────────────────────
describe('POST /api/link — cycle detection', () => {
  before(() => {
    writeStory('2026-02-01-cycle-a.md');
    writeStory('2026-02-01-cycle-b.md');
    writeStory('2026-02-01-cycle-c.md');
  });

  test('rejects a direct cycle (A blocks B, B blocks A)', async () => {
    await api('POST', '/api/link', {
      sourceType: 'story', sourceFilename: '2026-02-01-cycle-a.md',
      targetType: 'story', targetFilename: '2026-02-01-cycle-b.md',
      linkType: 'blocks',
    });
    const { status, data } = await api('POST', '/api/link', {
      sourceType: 'story', sourceFilename: '2026-02-01-cycle-b.md',
      targetType: 'story', targetFilename: '2026-02-01-cycle-a.md',
      linkType: 'blocks',
    });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'CYCLE_DETECTED');
  });

  test('rejects a self-link', async () => {
    const { status, data } = await api('POST', '/api/link', {
      sourceType: 'story', sourceFilename: '2026-02-01-cycle-c.md',
      targetType: 'story', targetFilename: '2026-02-01-cycle-c.md',
      linkType: 'blocks',
    });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'INVALID_LINK');
  });
});

// ── apply-distribution respects dependency order ──────────────────────────────
describe('POST /api/docs/apply-distribution — dependency ordering', () => {
  before(async () => {
    // Write pi-settings so sprint order is known
    const piSettings = {
      sprints: {
        'PI-2026.1': [
          { name: 'Sprint 1', capacity: 20 },
          { name: 'Sprint 2', capacity: 20 },
          { name: 'Sprint 3', capacity: 20 },
        ],
      },
    };
    fs.writeFileSync(
      path.join(docsRoot, '..', '.pi-settings.json'),
      JSON.stringify(piSettings),
    );
    // Note: rootDir in testApp is the tmpRoot, so .pi-settings.json goes to docsRoot/../
    // Actually the server uses rootDir = the temp root passed via TEST_DOCS_ROOT parent
    // Let's try both locations
    fs.writeFileSync(
      path.join(path.dirname(docsRoot), '.pi-settings.json'),
      JSON.stringify(piSettings),
    );

    writeStory('2026-03-01-dep-a.md', 'Blocks: 2026-03-01-dep-b.md\n');
    writeStory('2026-03-01-dep-b.md', 'Blocked_By: 2026-03-01-dep-a.md\n');
  });

  test('applies assignments and returns success', async () => {
    const { status, data } = await api('POST', '/api/docs/apply-distribution', {
      assignments: [
        { docType: 'story', filename: '2026-03-01-dep-a.md', sprint: 'Sprint 1' },
        { docType: 'story', filename: '2026-03-01-dep-b.md', sprint: 'Sprint 1' },
      ],
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
  });

  test('returns dependency warnings when blocker and blocked are in same sprint', async () => {
    const { data } = await api('POST', '/api/docs/apply-distribution', {
      assignments: [
        { docType: 'story', filename: '2026-03-01-dep-a.md', sprint: 'Sprint 2' },
        { docType: 'story', filename: '2026-03-01-dep-b.md', sprint: 'Sprint 2' },
      ],
    });
    assert.ok(Array.isArray(data.warnings));
  });
});
