// ── Benchmark: docIndex rebuild performance ────────────────────────────────────
// Verifies that a full docIndex rebuild for 500 documents completes within
// an acceptable time bound. Run via: npm run test:bench
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDocIndex } from '../../src/services/docIndex.js';

const THRESHOLD_MS = 2000; // 2 seconds — generous to avoid flaky CI

function makeTypeConfig(root) {
  return {
    epic: { dir: () => path.join(root, 'epics') },
    story: { dir: () => path.join(root, 'stories') },
    feature: { dir: () => path.join(root, 'features') },
    spike: { dir: () => path.join(root, 'spikes') },
    bug: { dir: () => path.join(root, 'bugs') },
  };
}

function writeFrontmatter(dir, filename, extra = '') {
  fs.writeFileSync(
    path.join(dir, filename),
    `---\nStatus: Draft\nPriority: Medium\n${extra}---\n\n## ${filename.replace('.md', '')}\n`
  );
}

describe('docIndex benchmark — 500 docs', () => {
  let tmpRoot, TYPE_CONFIG, docIndex;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-docindex-'));
    TYPE_CONFIG = makeTypeConfig(tmpRoot);

    // Create directories
    for (const cfg of Object.values(TYPE_CONFIG)) {
      fs.mkdirSync(cfg.dir(), { recursive: true });
    }

    // Write 200 epics
    for (let i = 1; i <= 200; i++) {
      writeFrontmatter(
        TYPE_CONFIG.epic.dir(),
        `2026-01-${String(i).padStart(3, '0')}-epic.md`
      );
    }
    // Write 200 stories linked to epics
    for (let i = 1; i <= 200; i++) {
      const parent = `2026-01-${String(((i - 1) % 200) + 1).padStart(3, '0')}-epic.md`;
      writeFrontmatter(
        TYPE_CONFIG.story.dir(),
        `2026-01-${String(i).padStart(3, '0')}-story.md`,
        `ParentFilename: ${parent}\nStory_Points: 3\n`
      );
    }
    // Write 100 features
    for (let i = 1; i <= 100; i++) {
      writeFrontmatter(
        TYPE_CONFIG.feature.dir(),
        `2026-01-${String(i).padStart(3, '0')}-feature.md`
      );
    }

    docIndex = createDocIndex({ TYPE_CONFIG });
    await docIndex.build();
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test(`initial build of 500 docs completes in under ${THRESHOLD_MS}ms`, async () => {
    const freshIndex = createDocIndex({ TYPE_CONFIG });
    const start = performance.now();
    await freshIndex.build();
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed < THRESHOLD_MS,
      `Index build took ${elapsed.toFixed(1)}ms — expected < ${THRESHOLD_MS}ms`
    );
    console.log(`  Index build (500 docs): ${elapsed.toFixed(1)}ms`);
  });

  test(`invalidateAll() and rebuild of 500 docs completes in under ${THRESHOLD_MS}ms`, async () => {
    const start = performance.now();
    await docIndex.invalidateAll();
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed < THRESHOLD_MS,
      `invalidateAll() took ${elapsed.toFixed(1)}ms — expected < ${THRESHOLD_MS}ms`
    );
    console.log(`  invalidateAll() (500 docs): ${elapsed.toFixed(1)}ms`);
  });

  test('getAll() on a 500-doc index completes in under 10ms', () => {
    const start = performance.now();
    const all = docIndex.getAll();
    const elapsed = performance.now() - start;
    assert.ok(all.length >= 400, `Expected at least 400 docs, got ${all.length}`);
    assert.ok(elapsed < 10, `getAll() took ${elapsed.toFixed(2)}ms — expected < 10ms`);
    console.log(`  getAll() (${all.length} docs): ${elapsed.toFixed(2)}ms`);
  });

  test('lookup by filename completes in under 5ms', () => {
    const allDocs = docIndex.getAll();
    const target = allDocs[Math.floor(allDocs.length / 2)];

    const start = performance.now();
    const found = docIndex.getAll().find((d) => d.filename === target.filename);
    const elapsed = performance.now() - start;

    assert.ok(found, 'should find the target doc');
    assert.ok(elapsed < 5, `Lookup took ${elapsed.toFixed(2)}ms — expected < 5ms`);
    console.log(`  filename lookup (${allDocs.length} docs): ${elapsed.toFixed(2)}ms`);
  });
});
