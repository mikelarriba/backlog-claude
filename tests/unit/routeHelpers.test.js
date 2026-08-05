// ── Unit tests: src/utils/routeHelpers.js ─────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFilename,
  assertSlug,
  assertAttachmentFilename,
} from '../../src/utils/routeHelpers.js';

// ── assertFilename — allow-list regex ─────────────────────────────────────────
describe('assertFilename', () => {
  test('accepts a valid lowercase filename', () => {
    assert.equal(assertFilename('2026-01-15-my-story.md'), '2026-01-15-my-story.md');
  });

  test('accepts filename with digits and hyphens', () => {
    assert.equal(assertFilename('feature-123-abc.md'), 'feature-123-abc.md');
  });

  test('rejects path traversal with double dots', () => {
    assert.throws(() => assertFilename('../../server.js'), { code: 'INVALID_FILENAME' });
  });

  test('rejects path traversal that looks like a valid basename after path.basename', () => {
    // path.basename('../../server.js') = 'server.js' — still must be rejected (no .md)
    assert.throws(() => assertFilename('../../server.js'), { code: 'INVALID_FILENAME' });
  });

  test('rejects uppercase letters', () => {
    assert.throws(() => assertFilename('MyStory.md'), { code: 'INVALID_FILENAME' });
  });

  test('rejects filenames with spaces', () => {
    assert.throws(() => assertFilename('my story.md'), { code: 'INVALID_FILENAME' });
  });

  test('rejects filenames without .md extension', () => {
    assert.throws(() => assertFilename('story.txt'), { code: 'INVALID_FILENAME' });
  });

  test('rejects empty string', () => {
    assert.throws(() => assertFilename(''), { code: 'INVALID_FILENAME' });
  });

  test('rejects filename starting with a hyphen', () => {
    assert.throws(() => assertFilename('-bad-start.md'), { code: 'INVALID_FILENAME' });
  });

  test('rejects filename with null bytes', () => {
    assert.throws(() => assertFilename('story\x00.md'), { code: 'INVALID_FILENAME' });
  });
});

// ── assertSlug — bug attachment slug allow-list ───────────────────────────────
describe('assertSlug', () => {
  test('accepts a slugify()-shaped value (no extension)', () => {
    assert.equal(assertSlug('my-bug-title'), 'my-bug-title');
  });

  test('accepts digits and hyphens', () => {
    assert.equal(assertSlug('bug-123-abc'), 'bug-123-abc');
  });

  test('rejects a value with a .md extension', () => {
    assert.throws(() => assertSlug('my-bug-title.md'), { code: 'INVALID_FILENAME' });
  });

  test('rejects uppercase letters', () => {
    assert.throws(() => assertSlug('My-Bug-Title'), { code: 'INVALID_FILENAME' });
  });

  test('accepts a leading hyphen (slugify() does not strip leading hyphens)', () => {
    assert.equal(assertSlug('--mock-title'), '--mock-title');
  });

  test('rejects a value containing dots (blocks ".." regardless of position)', () => {
    assert.throws(() => assertSlug('..server'), { code: 'INVALID_FILENAME' });
  });

  test('rejects empty string', () => {
    assert.throws(() => assertSlug(''), { code: 'INVALID_FILENAME' });
  });
});

// ── assertAttachmentFilename — bug attachment filename allow-list ────────────
describe('assertAttachmentFilename', () => {
  test('accepts a real attachment filename with its original extension', () => {
    assert.equal(assertAttachmentFilename('evidence.png'), 'evidence.png');
  });

  test('accepts mixed-case and multi-dot filenames', () => {
    assert.equal(assertAttachmentFilename('Report_v2.final.pdf'), 'Report_v2.final.pdf');
  });

  test('accepts .msg attachments', () => {
    assert.equal(assertAttachmentFilename('email-thread.msg'), 'email-thread.msg');
  });

  test('rejects path traversal with double dots', () => {
    assert.throws(() => assertAttachmentFilename('..'), { code: 'INVALID_FILENAME' });
  });

  test('rejects filenames with spaces', () => {
    assert.throws(() => assertAttachmentFilename('my file.png'), { code: 'INVALID_FILENAME' });
  });

  test('rejects filename starting with a dot', () => {
    assert.throws(() => assertAttachmentFilename('.hidden.png'), { code: 'INVALID_FILENAME' });
  });

  test('rejects empty string', () => {
    assert.throws(() => assertAttachmentFilename(''), { code: 'INVALID_FILENAME' });
  });
});
