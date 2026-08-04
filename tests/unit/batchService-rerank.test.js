// ── Unit tests: batchRerank / batchRerankCanvas (src/services/batchService.ts) ─
// Route-level behavior (validation, HTTP status codes) is covered in
// tests/integration/docs-batch-rerank.test.js; these exercise the service
// functions directly against a real temp filesystem, matching the pattern
// used by tests/unit/docIndex.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { batchRerank, batchRerankCanvas } from '../../src/services/batchService.js';
import { createTypeConfig } from '../../src/config/docTypes.js';

let tmpRoot, TYPE_CONFIG;
const warnings = [];
const logWarn = (...args) => warnings.push(args);

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batchservice-rerank-'));
  TYPE_CONFIG = createTypeConfig(tmpRoot);
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeDoc(dir, filename) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, filename),
    `---\nStatus: Draft\nPriority: Medium\n---\n\n## ${filename}\n`
  );
}

// applyDocPatch writes Rank via js-yaml, which quotes numeric-looking string
// values (e.g. `Rank: '3'`) to preserve their string type — read back with
// the quotes stripped so tests assert on the logical value, not YAML syntax.
function readRank(dir, filename) {
  const content = fs.readFileSync(path.join(dir, filename), 'utf-8');
  const m = content.match(/^Rank:\s*'?(.+?)'?$/m);
  return m ? m[1] : null;
}

describe('batchRerank', () => {
  test('sets Rank to 1..N in orderedFilenames order', async () => {
    const dir = TYPE_CONFIG.story.dir();
    writeDoc(dir, 'a.md');
    writeDoc(dir, 'b.md');
    writeDoc(dir, 'c.md');

    const { updated, skipped } = await batchRerank('story', ['c.md', 'a.md', 'b.md'], {
      TYPE_CONFIG,
      logWarn,
    });

    // batchRerank processes entries concurrently (pMap, BATCH_CONCURRENCY=5),
    // so `updated` reflects completion order, not input order — assert
    // membership, and assert the actual per-file Rank values separately.
    assert.deepEqual([...updated].sort(), ['a.md', 'b.md', 'c.md']);
    assert.equal(skipped.length, 0);

    assert.equal(readRank(dir, 'c.md'), '1');
    assert.equal(readRank(dir, 'a.md'), '2');
    assert.equal(readRank(dir, 'b.md'), '3');
  });

  test('skips filenames that do not exist on disk, with reason "not found"', async () => {
    const dir = TYPE_CONFIG.epic.dir();
    writeDoc(dir, 'exists.md');

    const { updated, skipped } = await batchRerank('epic', ['exists.md', 'ghost.md'], {
      TYPE_CONFIG,
      logWarn,
    });

    assert.deepEqual(updated, ['exists.md']);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].filename, 'ghost.md');
    assert.equal(skipped[0].reason, 'not found');
  });

  test('skips filenames that fail assertFilename (invalid characters) as "invalid"', async () => {
    const dir = TYPE_CONFIG.story.dir();
    writeDoc(dir, 'valid-again.md');

    const { updated, skipped } = await batchRerank(
      'story',
      ['valid-again.md', '../escape.md', 'UPPERCASE.md'],
      { TYPE_CONFIG, logWarn }
    );

    assert.ok(updated.includes('valid-again.md'));
    // '../escape.md' resolves via path.basename to 'escape.md' which IS a
    // valid filename pattern, so it will be treated as "not found" rather
    // than rejected outright — only genuinely malformed names are "invalid".
    const uppercaseSkip = skipped.find((s) => s.filename === 'UPPERCASE.md');
    assert.ok(uppercaseSkip, 'uppercase filename should be skipped');
    assert.equal(
      uppercaseSkip.reason,
      'Filename must match pattern: lowercase letters, digits, hyphens, ending in .md'
    );
  });
});

describe('batchRerankCanvas', () => {
  test('sets Rank per-item across mixed doc types', async () => {
    const storyDir = TYPE_CONFIG.story.dir();
    const spikeDir = TYPE_CONFIG.spike.dir();
    writeDoc(storyDir, 'canvas-story.md');
    writeDoc(spikeDir, 'canvas-spike.md');

    const { updated, skipped } = await batchRerankCanvas(
      [
        { filename: 'canvas-story.md', docType: 'story', rank: 3 },
        { filename: 'canvas-spike.md', docType: 'spike', rank: 9 },
      ],
      { TYPE_CONFIG, logWarn }
    );

    assert.deepEqual(updated.sort(), ['canvas-spike.md', 'canvas-story.md']);
    assert.equal(skipped.length, 0);
    assert.equal(readRank(storyDir, 'canvas-story.md'), '3');
    assert.equal(readRank(spikeDir, 'canvas-spike.md'), '9');
  });

  test('skips an item with an invalid docType', async () => {
    const { updated, skipped } = await batchRerankCanvas(
      [{ filename: 'whatever.md', docType: 'not-a-real-type', rank: 1 }],
      { TYPE_CONFIG, logWarn }
    );
    assert.equal(updated.length, 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].filename, 'whatever.md');
  });

  test('skips an item whose file does not exist on disk', async () => {
    const { updated, skipped } = await batchRerankCanvas(
      [{ filename: 'missing-canvas.md', docType: 'story', rank: 1 }],
      { TYPE_CONFIG, logWarn }
    );
    assert.equal(updated.length, 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].reason, 'not found');
  });
});
