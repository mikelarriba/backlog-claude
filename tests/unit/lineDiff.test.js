// ── Unit tests: public/js/lineDiff.js ─────────────────────────────────────────
// Pure LCS-based line diff + HTML rendering, extracted from documentation.ts
// (#458) so it's testable without DOM mocking.
import '../helpers/domGlobals.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeLineDiff, renderDiffLinesHtml } from '../../public/js/lineDiff.js';

describe('computeLineDiff()', () => {
  test('identical content produces only context lines', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nb\nc');
    assert.deepEqual(
      lines.map((l) => l.type),
      ['context', 'context', 'context']
    );
  });

  test('empty current and empty proposed produce no lines', () => {
    const lines = computeLineDiff('', '');
    assert.deepEqual(lines, [{ type: 'context', text: '' }]);
  });

  test('a pure addition (empty current) marks every line as add', () => {
    const lines = computeLineDiff('', 'x\ny');
    // splitting '' on '\n' yields [''], so the diff aligns that one empty
    // line against nothing and adds the two new lines.
    assert.ok(lines.some((l) => l.type === 'add' && l.text === 'x'));
    assert.ok(lines.some((l) => l.type === 'add' && l.text === 'y'));
  });

  test('a pure removal (empty proposed) marks every line as remove', () => {
    const lines = computeLineDiff('x\ny', '');
    assert.ok(lines.some((l) => l.type === 'remove' && l.text === 'x'));
    assert.ok(lines.some((l) => l.type === 'remove' && l.text === 'y'));
  });

  test('a single changed line in the middle produces remove+add around unchanged context', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nB\nc');
    assert.deepEqual(lines, [
      { type: 'context', text: 'a' },
      { type: 'remove', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'context', text: 'c' },
    ]);
  });

  test('an insertion in the middle keeps surrounding lines as context', () => {
    const lines = computeLineDiff('a\nc', 'a\nb\nc');
    assert.deepEqual(lines, [
      { type: 'context', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'context', text: 'c' },
    ]);
  });

  test('falls back to remove-all/add-all when the LCS table would be too large', () => {
    // LCS_CELL_LIMIT is 250_000 — 600 * 600 = 360_000 exceeds it.
    const a = Array.from({ length: 600 }, (_, i) => `line-${i}`).join('\n');
    const b = Array.from({ length: 600 }, (_, i) => `changed-${i}`).join('\n');
    const lines = computeLineDiff(a, b);
    assert.equal(lines.length, 1200);
    assert.ok(lines.slice(0, 600).every((l) => l.type === 'remove'));
    assert.ok(lines.slice(600).every((l) => l.type === 'add'));
  });
});

describe('renderDiffLinesHtml()', () => {
  test('an empty line list renders the "no content to compare" placeholder', () => {
    assert.equal(
      renderDiffLinesHtml([]),
      '<div class="doc-diff-empty">No content to compare.</div>'
    );
  });

  test('renders one .diff-line div per line, classed and marked by type', () => {
    const html = renderDiffLinesHtml([
      { type: 'context', text: 'same' },
      { type: 'remove', text: 'old' },
      { type: 'add', text: 'new' },
    ]);
    assert.match(html, /diff-context/);
    assert.match(html, /diff-remove/);
    assert.match(html, /diff-add/);
    assert.match(html, /<span class="diff-marker">\+<\/span><span class="diff-text">new<\/span>/);
    assert.match(html, /<span class="diff-marker"> <\/span><span class="diff-text">same<\/span>/);
  });

  test('escapes HTML-sensitive characters in line text', () => {
    const html = renderDiffLinesHtml([{ type: 'add', text: '<script>alert(1)</script>' }]);
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });
});
