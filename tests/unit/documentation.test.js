// ── Unit tests: public/js/documentation.js ──────────────────────────────────
// buildSuggestionRowHtml() is the pure string builder split out of
// _renderSuggestionRow (#460) so it's testable without the module-private
// _selectedSuggestionIndexes/_expandedSuggestionIndexes Sets — callers pass
// the selected/expanded flags explicitly, same signature-change extraction
// roadmap-render.ts's buildRoadmapCardHtml(doc, parent) used (#508).
// documentation.js statically imports state.js, which wires several globals
// onto `window` via Object.defineProperty at module load time — so the
// domGlobals shim (aliasing window to globalThis) must be imported first,
// same as ai-savings.test.js and friends.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

const { buildSuggestionRowHtml } = await import('../../public/js/documentation.js');

function makeSuggestion(overrides = {}) {
  return {
    pageTitle: 'Onboarding Guide',
    hierarchyPath: 'Docs / Onboarding',
    action: 'Update',
    currentContent: 'old text',
    proposedContent: 'new text',
    ...overrides,
  };
}

describe('buildSuggestionRowHtml()', () => {
  test('renders the page title, hierarchy path, and action badge', () => {
    const html = buildSuggestionRowHtml(makeSuggestion(), 0, false, false);
    assert.match(html, /doc-suggestion-title">Onboarding Guide</);
    assert.match(html, /doc-suggestion-path">Docs \/ Onboarding/);
    assert.match(html, /doc-action-update">Update</);
  });

  test('neither selected nor expanded: no "checked" attribute, base row classes only', () => {
    const html = buildSuggestionRowHtml(makeSuggestion(), 2, false, false);
    assert.doesNotMatch(html, /<input type="checkbox" checked/);
    assert.match(html, /class="doc-suggestion-row" data-index="2"/);
  });

  test('selected: checkbox is checked and the row carries the "selected" class', () => {
    const html = buildSuggestionRowHtml(makeSuggestion(), 0, true, false);
    assert.match(html, /<input type="checkbox" checked/);
    assert.match(html, /class="doc-suggestion-row selected" data-index="0"/);
  });

  test('expanded: the row carries the "expanded" class', () => {
    const html = buildSuggestionRowHtml(makeSuggestion(), 0, false, true);
    assert.match(html, /class="doc-suggestion-row expanded" data-index="0"/);
  });

  test('selected and expanded together: both classes present, in that order', () => {
    const html = buildSuggestionRowHtml(makeSuggestion(), 0, true, true);
    assert.match(html, /class="doc-suggestion-row selected expanded" data-index="0"/);
  });

  test('action class is derived from the lowercased action', () => {
    const create = buildSuggestionRowHtml(makeSuggestion({ action: 'Create' }), 0, false, false);
    assert.match(create, /doc-action-create/);
    const del = buildSuggestionRowHtml(makeSuggestion({ action: 'Delete' }), 0, false, false);
    assert.match(del, /doc-action-delete/);
  });

  test('the toggle header carries the index and the DOC_ACTIONS.toggleSuggestion data-action', () => {
    const html = buildSuggestionRowHtml(makeSuggestion(), 7, false, false);
    assert.match(html, /data-action="toggleSuggestionRow" data-index="7"/);
  });

  test('escapes HTML-unsafe characters in pageTitle and hierarchyPath', () => {
    const html = buildSuggestionRowHtml(
      makeSuggestion({ pageTitle: '<b>Bold</b>', hierarchyPath: 'A & B' }),
      0,
      false,
      false
    );
    assert.doesNotMatch(html, /<b>Bold<\/b>/);
    assert.match(html, /&lt;b&gt;Bold&lt;\/b&gt;/);
    assert.match(html, /A &amp; B/);
  });

  test('renders diff content for the suggestion via renderDiffHtml', () => {
    const html = buildSuggestionRowHtml(
      makeSuggestion({ currentContent: 'old', proposedContent: 'new' }),
      0,
      false,
      false
    );
    assert.match(html, /doc-diff-content"/);
  });
});
