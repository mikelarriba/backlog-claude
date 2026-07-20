// ── Unit tests: src/services/linksService.js (#421) ─────────────────────────────
// linksService.ts was previously only reached transitively through route-level
// integration tests, so cycle detection and dedup edge cases weren't directly
// asserted. This file exercises it directly against a real tmp-dir docIndex.
import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDocIndex } from '../../src/services/docIndex.js';
import {
  applyHierarchyLink,
  applyBlocksLink,
  applyParallelLink,
  removeBlocksLink,
  removeParallelLink,
} from '../../src/services/linksService.js';
import { extractFrontmatterField } from '../../src/utils/transforms.js';

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
    `---\nStatus: Draft\nPriority: Medium\n${extra}---\n\n## ${filename.replace('.md', '')}\n`
  );
}

function readDoc(dir, filename) {
  return fs.readFileSync(path.join(dir, filename), 'utf-8');
}

describe('linksService', () => {
  let tmpRoot, TYPE_CONFIG, docIndex, ctx, broadcasts;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linksservice-test-'));
    TYPE_CONFIG = makeTypeConfig(tmpRoot);
    docIndex = createDocIndex({ TYPE_CONFIG });
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    broadcasts = [];
    ctx = {
      TYPE_CONFIG,
      FEATURES_DIR: TYPE_CONFIG.feature.dir(),
      EPICS_DIR: TYPE_CONFIG.epic.dir(),
      STORIES_DIR: TYPE_CONFIG.story.dir(),
      SPIKES_DIR: TYPE_CONFIG.spike.dir(),
      BUGS_DIR: TYPE_CONFIG.bug.dir(),
      broadcast: (evt) => broadcasts.push(evt),
      logInfo: () => {},
      docIndex,
    };
  });

  // ── applyHierarchyLink ──────────────────────────────────────────────────────
  describe('applyHierarchyLink', () => {
    test('links a story to an epic by setting Epic_ID and invalidating the index', async () => {
      writeDoc(ctx.EPICS_DIR, 'epic-h1.md');
      writeDoc(ctx.STORIES_DIR, 'story-h1.md');
      await docIndex.build();

      const result = await applyHierarchyLink('story', 'story-h1.md', 'epic', 'epic-h1.md', ctx);
      assert.equal(result.success, true);
      assert.equal(result.field, 'Epic_ID');

      const content = readDoc(ctx.STORIES_DIR, 'story-h1.md');
      assert.equal(extractFrontmatterField(content, 'Epic_ID'), 'epic-h1.md');
      assert.equal(docIndex.get('story-h1.md').parentFilename, 'epic-h1.md');
      assert.ok(broadcasts.some((b) => b.type === 'link_updated'));
    });

    test('rejects an unsupported source/target type combination', async () => {
      const result = await applyHierarchyLink('epic', 'a.md', 'story', 'b.md', ctx);
      assert.equal(result.code, 'INVALID_LINK');
      assert.equal(result.status, 400);
    });

    test('returns NOT_FOUND when the source document does not exist', async () => {
      writeDoc(ctx.EPICS_DIR, 'epic-h2.md');
      const result = await applyHierarchyLink(
        'story',
        'missing-story.md',
        'epic',
        'epic-h2.md',
        ctx
      );
      assert.equal(result.code, 'NOT_FOUND');
      assert.equal(result.status, 404);
    });

    test('returns NOT_FOUND when the target document does not exist', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-h3.md');
      const result = await applyHierarchyLink(
        'story',
        'story-h3.md',
        'epic',
        'missing-epic.md',
        ctx
      );
      assert.equal(result.code, 'NOT_FOUND');
      assert.equal(result.status, 404);
    });
  });

  // ── applyBlocksLink ─────────────────────────────────────────────────────────
  describe('applyBlocksLink', () => {
    test('sets Blocks on the source and Blocked_By on the target (both directions)', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-b1.md');
      writeDoc(ctx.STORIES_DIR, 'story-b2.md');
      await docIndex.build();

      const result = await applyBlocksLink('story', 'story-b1.md', 'story', 'story-b2.md', ctx);
      assert.equal(result.success, true);
      assert.equal(result.linkType, 'blocks');

      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-b1.md'), 'Blocks'),
        'story-b2.md'
      );
      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-b2.md'), 'Blocked_By'),
        'story-b1.md'
      );
    });

    test('rejects a story blocking itself', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-b3.md');
      await docIndex.build();
      const result = await applyBlocksLink('story', 'story-b3.md', 'story', 'story-b3.md', ctx);
      assert.equal(result.code, 'INVALID_LINK');
    });

    test('rejects creating a cycle (A blocks B, then B blocks A)', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-cycle-a.md');
      writeDoc(ctx.STORIES_DIR, 'story-cycle-b.md');
      await docIndex.build();

      const first = await applyBlocksLink(
        'story',
        'story-cycle-a.md',
        'story',
        'story-cycle-b.md',
        ctx
      );
      assert.equal(first.success, true);

      const second = await applyBlocksLink(
        'story',
        'story-cycle-b.md',
        'story',
        'story-cycle-a.md',
        ctx
      );
      assert.equal(second.code, 'CYCLE_DETECTED');
      assert.equal(second.status, 400);
    });

    test('rejects a transitive cycle (A blocks B blocks C, then C blocks A)', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-chain-a.md');
      writeDoc(ctx.STORIES_DIR, 'story-chain-b.md');
      writeDoc(ctx.STORIES_DIR, 'story-chain-c.md');
      await docIndex.build();

      await applyBlocksLink('story', 'story-chain-a.md', 'story', 'story-chain-b.md', ctx);
      await applyBlocksLink('story', 'story-chain-b.md', 'story', 'story-chain-c.md', ctx);
      const result = await applyBlocksLink(
        'story',
        'story-chain-c.md',
        'story',
        'story-chain-a.md',
        ctx
      );
      assert.equal(result.code, 'CYCLE_DETECTED');
    });

    test('does not duplicate an entry when the same blocks link is applied twice', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-dedup-a.md');
      writeDoc(ctx.STORIES_DIR, 'story-dedup-b.md');
      await docIndex.build();

      await applyBlocksLink('story', 'story-dedup-a.md', 'story', 'story-dedup-b.md', ctx);
      await applyBlocksLink('story', 'story-dedup-a.md', 'story', 'story-dedup-b.md', ctx);

      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-dedup-a.md'), 'Blocks'),
        'story-dedup-b.md'
      );
    });
  });

  // ── applyParallelLink ───────────────────────────────────────────────────────
  describe('applyParallelLink', () => {
    test('sets a symmetric Parallel field on both leaf docs', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-p1.md');
      writeDoc(ctx.SPIKES_DIR, 'spike-p1.md');
      await docIndex.build();

      const result = await applyParallelLink('story', 'story-p1.md', 'spike', 'spike-p1.md', ctx);
      assert.equal(result.success, true);
      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-p1.md'), 'Parallel'),
        'spike-p1.md'
      );
      assert.equal(
        extractFrontmatterField(readDoc(ctx.SPIKES_DIR, 'spike-p1.md'), 'Parallel'),
        'story-p1.md'
      );
    });

    test('rejects a non-leaf type (epic)', async () => {
      writeDoc(ctx.EPICS_DIR, 'epic-p2.md');
      writeDoc(ctx.STORIES_DIR, 'story-p2.md');
      await docIndex.build();
      const result = await applyParallelLink('epic', 'epic-p2.md', 'story', 'story-p2.md', ctx);
      assert.equal(result.code, 'INVALID_LINK');
    });

    test('rejects a story being parallel with itself', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-p3.md');
      await docIndex.build();
      const result = await applyParallelLink('story', 'story-p3.md', 'story', 'story-p3.md', ctx);
      assert.equal(result.code, 'INVALID_LINK');
    });

    test('does not duplicate an entry when applied twice', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-p4.md');
      writeDoc(ctx.STORIES_DIR, 'story-p5.md');
      await docIndex.build();

      await applyParallelLink('story', 'story-p4.md', 'story', 'story-p5.md', ctx);
      await applyParallelLink('story', 'story-p4.md', 'story', 'story-p5.md', ctx);

      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-p4.md'), 'Parallel'),
        'story-p5.md'
      );
    });
  });

  // ── removeBlocksLink / removeParallelLink ──────────────────────────────────
  describe('removeBlocksLink and removeParallelLink', () => {
    test('removeBlocksLink clears the field entirely when it was the only entry', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-rm1.md');
      writeDoc(ctx.STORIES_DIR, 'story-rm2.md');
      await docIndex.build();
      await applyBlocksLink('story', 'story-rm1.md', 'story', 'story-rm2.md', ctx);

      await removeBlocksLink('story', 'story-rm1.md', 'story', 'story-rm2.md', ctx);

      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-rm1.md'), 'Blocks'),
        null
      );
      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-rm2.md'), 'Blocked_By'),
        null
      );
    });

    test('removeBlocksLink leaves other entries intact', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-rm3.md');
      writeDoc(ctx.STORIES_DIR, 'story-rm4.md');
      writeDoc(ctx.STORIES_DIR, 'story-rm5.md');
      await docIndex.build();
      await applyBlocksLink('story', 'story-rm3.md', 'story', 'story-rm4.md', ctx);
      await applyBlocksLink('story', 'story-rm3.md', 'story', 'story-rm5.md', ctx);

      await removeBlocksLink('story', 'story-rm3.md', 'story', 'story-rm4.md', ctx);

      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-rm3.md'), 'Blocks'),
        'story-rm5.md'
      );
    });

    test('removeParallelLink clears the symmetric field on both sides', async () => {
      writeDoc(ctx.STORIES_DIR, 'story-rm6.md');
      writeDoc(ctx.STORIES_DIR, 'story-rm7.md');
      await docIndex.build();
      await applyParallelLink('story', 'story-rm6.md', 'story', 'story-rm7.md', ctx);

      await removeParallelLink('story', 'story-rm6.md', 'story', 'story-rm7.md', ctx);

      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-rm6.md'), 'Parallel'),
        null
      );
      assert.equal(
        extractFrontmatterField(readDoc(ctx.STORIES_DIR, 'story-rm7.md'), 'Parallel'),
        null
      );
    });
  });
});
