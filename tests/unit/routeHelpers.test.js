// ── Unit tests: src/utils/routeHelpers.js ─────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertFilename, assertBody } from '../../src/utils/routeHelpers.js';

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

// ── assertBody ────────────────────────────────────────────────────────────────
describe('assertBody', () => {
  test('does not throw when all required fields are present', () => {
    assert.doesNotThrow(() => assertBody({ title: 'Hello', type: 'epic' }, ['title', 'type']));
  });

  test('throws MISSING_FIELDS when a required field is absent', () => {
    assert.throws(
      () => assertBody({ title: 'Hello' }, ['title', 'type']),
      { code: 'MISSING_FIELDS' },
    );
  });

  test('reports all missing fields at once', () => {
    let thrown;
    try { assertBody({}, ['title', 'type', 'idea']); } catch (e) { thrown = e; }
    assert.deepEqual(thrown.details.missing, ['title', 'type', 'idea']);
  });

  test('treats null as missing', () => {
    assert.throws(
      () => assertBody({ title: null }, ['title']),
      { code: 'MISSING_FIELDS' },
    );
  });

  test('treats empty string as missing', () => {
    assert.throws(
      () => assertBody({ title: '' }, ['title']),
      { code: 'MISSING_FIELDS' },
    );
  });

  test('accepts zero and false as valid values', () => {
    assert.doesNotThrow(() => assertBody({ count: 0, enabled: false }, ['count', 'enabled']));
  });
});
