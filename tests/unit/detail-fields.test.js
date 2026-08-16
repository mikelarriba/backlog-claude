// ── Unit tests: public/js/detail-fields.js ──────────────────────────────────
// Pure comment (de)serialization backing the detail view's "Comments"
// section (#460) — parses/writes the `## Comments` markdown block with its
// `<!-- comment:id -->...<!-- /comment:id -->` markers. detail-fields.js
// transitively imports piconfig.js, which pulls in the roadmap/refine module
// graph (heavy, DOM-entangled) — mocked out below since _parseComments and
// _serializeComments never call into it, following the same
// mock-the-heavy-neighbor pattern used in roadmap-drag.test.js.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/piconfig.js', {
  namedExports: { getSprintsForPi: () => [] },
});

const { _parseComments, _serializeComments } = await import('../../public/js/detail-fields.js');

// ── _parseComments ────────────────────────────────────────────────────────
describe('_parseComments()', () => {
  test('content with no Comments section returns an empty array', () => {
    assert.deepEqual(_parseComments('# Title\n\nSome body text.'), []);
  });

  test('a Comments section with no comment blocks returns an empty array', () => {
    assert.deepEqual(_parseComments('# Title\n\n## Comments\n'), []);
  });

  test('parses a single comment', () => {
    const content =
      '# Title\n\n## Comments\n\n<!-- comment:abc-1 -->\nHello there\n<!-- /comment:abc-1 -->';
    assert.deepEqual(_parseComments(content), [{ id: 'abc-1', text: 'Hello there' }]);
  });

  test('parses multiple comments in document order', () => {
    const content =
      '# Title\n\n## Comments\n\n' +
      '<!-- comment:c1 -->\nFirst\n<!-- /comment:c1 -->\n\n' +
      '<!-- comment:c2 -->\nSecond\n<!-- /comment:c2 -->';
    assert.deepEqual(_parseComments(content), [
      { id: 'c1', text: 'First' },
      { id: 'c2', text: 'Second' },
    ]);
  });

  test('trims surrounding whitespace from comment text but preserves internal newlines', () => {
    const content =
      '# Title\n\n## Comments\n\n<!-- comment:c1 -->\n\n  Line one\nLine two  \n\n<!-- /comment:c1 -->';
    assert.deepEqual(_parseComments(content), [{ id: 'c1', text: 'Line one\nLine two' }]);
  });

  test('requires matching open/close ids (backreference) — a mismatched close marker is not matched', () => {
    const content =
      '# Title\n\n## Comments\n\n<!-- comment:c1 -->\nOrphan\n<!-- /comment:c2 -->\n<!-- comment:c2 -->\nReal\n<!-- /comment:c2 -->';
    assert.deepEqual(_parseComments(content), [{ id: 'c2', text: 'Real' }]);
  });

  test('only scans content after the "## Comments" heading, ignoring similar text before it', () => {
    const content =
      '<!-- comment:before -->\nShould not count\n<!-- /comment:before -->\n\n' +
      '## Comments\n\n<!-- comment:after -->\nCounts\n<!-- /comment:after -->';
    assert.deepEqual(_parseComments(content), [{ id: 'after', text: 'Counts' }]);
  });
});

// ── _serializeComments ───────────────────────────────────────────────────
describe('_serializeComments()', () => {
  test('an empty array serializes to an empty string (no heading emitted)', () => {
    assert.equal(_serializeComments([]), '');
  });

  test('serializes a single comment with the heading and markers', () => {
    assert.equal(
      _serializeComments([{ id: 'abc-1', text: 'Hello there' }]),
      '## Comments\n\n<!-- comment:abc-1 -->\nHello there\n<!-- /comment:abc-1 -->'
    );
  });

  test('serializes multiple comments separated by a blank line, in array order', () => {
    const result = _serializeComments([
      { id: 'c1', text: 'First' },
      { id: 'c2', text: 'Second' },
    ]);
    assert.equal(
      result,
      '## Comments\n\n<!-- comment:c1 -->\nFirst\n<!-- /comment:c1 -->\n\n<!-- comment:c2 -->\nSecond\n<!-- /comment:c2 -->'
    );
  });
});

// ── Round-trip ────────────────────────────────────────────────────────────
describe('_parseComments() / _serializeComments() round-trip', () => {
  // _parseComments requires a newline before "## Comments" (it looks for
  // "\n## Comments"), matching how this block is always appended after
  // other document content in practice — so round-trip inputs here are
  // embedded in a minimal document rather than passed as a bare fragment.
  test('serializing then parsing reproduces the original comments', () => {
    const original = [
      { id: 'c1', text: 'First comment' },
      { id: 'c2', text: 'Second comment\nwith a second line' },
    ];
    const doc = '# Title\n\n' + _serializeComments(original);
    assert.deepEqual(_parseComments(doc), original);
  });

  test('parsing then serializing reproduces the original comments fragment', () => {
    const fragment =
      '## Comments\n\n<!-- comment:c1 -->\nHello\n<!-- /comment:c1 -->\n\n<!-- comment:c2 -->\nWorld\n<!-- /comment:c2 -->';
    const doc = '# Title\n\n' + fragment;
    assert.equal(_serializeComments(_parseComments(doc)), fragment);
  });
});
