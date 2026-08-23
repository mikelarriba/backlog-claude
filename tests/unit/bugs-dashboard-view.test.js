// ── Unit tests: public/js/bugs-dashboard.js (pure status→CSS-class mapper) ──
// _statusClass maps a JIRA bug status string to the CSS class backing the
// status badge in renderBugsTable — exactly the kind of formatting helper
// that regresses silently on a status name with unexpected casing/spacing.
// Named -view.test.js (not bugs-dashboard.test.js) because that name is
// already taken by src/routes/bugs-dashboard.ts's changelog-replay tests —
// a different module that happens to share a base name (see #460).
// bugs-dashboard.js statically imports state.js, which wires several
// globals onto `window` via Object.defineProperty at module load time — so
// the domGlobals shim (aliasing window to globalThis) must be imported
// first, same as ai-savings.test.js and list-render.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

const { _statusClass } = await import('../../public/js/bugs-dashboard.js');

describe('_statusClass()', () => {
  test('lowercases a single-word status', () => {
    assert.equal(_statusClass('Open'), 'bugs-status-open');
  });

  test('replaces internal whitespace with a hyphen', () => {
    assert.equal(_statusClass('In Progress'), 'bugs-status-in-progress');
  });

  test('collapses multiple internal spaces to a single hyphen', () => {
    assert.equal(_statusClass('To   Do'), 'bugs-status-to-do');
  });

  test('handles already-lowercase, already-hyphenated input unchanged', () => {
    assert.equal(_statusClass('closed'), 'bugs-status-closed');
  });

  test('empty string yields the bare prefix', () => {
    assert.equal(_statusClass(''), 'bugs-status-');
  });

  test('null/undefined-like falsy status yields the bare prefix', () => {
    assert.equal(_statusClass(undefined), 'bugs-status-');
  });
});
