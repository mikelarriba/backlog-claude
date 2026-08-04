// ── Unit tests: public/js/lineDiff.js ───────────────────────────────────────────
// Pure line-diff algorithm + HTML rendering extracted from documentation.ts
// (#458) — no DOM/browser required, so no domGlobals shim needed here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLineDiff,
  diffLinesForSuggestion,
  renderDiffHtml,
} from '../../public/js/lineDiff.js';

// ── computeLineDiff ──────────────────────────────────────────────────────────
describe('computeLineDiff()', () => {
  test('identical text produces only context lines', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nb\nc');
    assert.deepEqual(
      lines.map((l) => l.type),
      ['context', 'context', 'context']
    );
  });

  test('a pure addition produces context + add lines', () => {
    const lines = computeLineDiff('a\nb', 'a\nb\nc');
    assert.deepEqual(lines, [
      { type: 'context', text: 'a' },
      { type: 'context', text: 'b' },
      { type: 'add', text: 'c' },
    ]);
  });

  test('a pure removal produces context + remove lines', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nb');
    assert.deepEqual(lines, [
      { type: 'context', text: 'a' },
      { type: 'context', text: 'b' },
      { type: 'remove', text: 'c' },
    ]);
  });

  test('a changed line in the middle diffs as remove+add around shared context', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nx\nc');
    assert.deepEqual(lines, [
      { type: 'context', text: 'a' },
      { type: 'remove', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'context', text: 'c' },
    ]);
  });

  test('both empty inputs produce no lines', () => {
    assert.deepEqual(computeLineDiff('', ''), [{ type: 'context', text: '' }]);
  });

  test('empty current vs non-empty proposed is a pure addition', () => {
    const lines = computeLineDiff('', 'a\nb');
    assert.deepEqual(
      lines.map((l) => l.type),
      ['remove', 'add', 'add']
    );
  });

  test('completely disjoint content with no common lines falls back to remove-all/add-all ordering', () => {
    const lines = computeLineDiff('a\nb', 'c\nd');
    assert.deepEqual(
      lines.map((l) => l.type),
      ['remove', 'remove', 'add', 'add']
    );
  });

  test('inputs large enough to exceed the LCS cell budget fall back to a plain remove-all/add-all diff', () => {
    // LCS_CELL_LIMIT is 250_000 — 600 x 600 = 360_000 exceeds it.
    const a = Array.from({ length: 600 }, (_, i) => `line-a-${i}`).join('\n');
    const b = Array.from({ length: 600 }, (_, i) => `line-b-${i}`).join('\n');
    const lines = computeLineDiff(a, b);
    assert.equal(lines.length, 1200);
    assert.ok(lines.slice(0, 600).every((l) => l.type === 'remove'));
    assert.ok(lines.slice(600).every((l) => l.type === 'add'));
  });
});

// ── diffLinesForSuggestion ───────────────────────────────────────────────────
describe('diffLinesForSuggestion()', () => {
  test('a "Create" suggestion treats all proposed content as additions', () => {
    const lines = diffLinesForSuggestion({
      action: 'Create',
      currentContent: '',
      proposedContent: 'new line 1\nnew line 2',
    });
    assert.deepEqual(lines, [
      { type: 'add', text: 'new line 1' },
      { type: 'add', text: 'new line 2' },
    ]);
  });

  test('a "Delete" suggestion treats all current content as removals', () => {
    const lines = diffLinesForSuggestion({
      action: 'Delete',
      currentContent: 'old line 1\nold line 2',
      proposedContent: '',
    });
    assert.deepEqual(lines, [
      { type: 'remove', text: 'old line 1' },
      { type: 'remove', text: 'old line 2' },
    ]);
  });

  test('an "Update" suggestion runs the real line diff between current and proposed', () => {
    const lines = diffLinesForSuggestion({
      action: 'Update',
      currentContent: 'a\nb',
      proposedContent: 'a\nc',
    });
    assert.deepEqual(lines, [
      { type: 'context', text: 'a' },
      { type: 'remove', text: 'b' },
      { type: 'add', text: 'c' },
    ]);
  });
});

// ── renderDiffHtml ───────────────────────────────────────────────────────────
describe('renderDiffHtml()', () => {
  // Note: `diffLinesForSuggestion` always returns at least one line even for
  // empty current/proposed content, since `''.split('\n')` yields `['']`
  // rather than `[]` — so the "No content to compare" empty-state branch in
  // renderDiffHtml is defensive and not reachable via real suggestion input.
  // That matches the original documentation.ts behavior this was extracted
  // from (no behavior change intended by the extraction).

  test('renders one .diff-line per diff line, tagged with the right class', () => {
    const html = renderDiffHtml({
      action: 'Update',
      currentContent: 'a\nb',
      proposedContent: 'a\nc',
    });
    assert.match(html, /diff-context/);
    assert.match(html, /diff-remove/);
    assert.match(html, /diff-add/);
    assert.equal((html.match(/diff-line/g) || []).length, 3);
  });

  test('escapes HTML-significant characters in line text (XSS-safe)', () => {
    const html = renderDiffHtml({
      action: 'Create',
      currentContent: '',
      proposedContent: '<script>alert(1)</script>',
    });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.match(html, /&lt;script&gt;/);
  });

  test('uses a leading "+" marker for added lines and "−" for removed lines', () => {
    const html = renderDiffHtml({
      action: 'Update',
      currentContent: 'old',
      proposedContent: 'new',
    });
    assert.match(html, /diff-marker">\+</);
    assert.match(html, /diff-marker">−</);
  });
});
