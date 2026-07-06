// ── Unit tests: src/utils/routeHelpers.js ─────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertFilename } from '../../src/utils/routeHelpers.js';

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
