// ── Unit tests: public/js/documentation.js ──────────────────────────────────
// buildSuggestionRowHtml() is the pure string builder split out of
// _renderSuggestionRow (#460) so it's testable without the module-private
// _selectedSuggestionIndexes/_expandedSuggestionIndexes Sets — callers pass
// the selected/expanded flags explicitly, same signature-change extraction
// roadmap-render.ts's buildRoadmapCardHtml(doc, parent) used (#508).
// buildEpicRowHtml() (#555) follows the identical pattern for the Sprint/Fix
// Version epic roll-up rows introduced alongside #554's
// GET /api/jira/closed-epics endpoint.
// documentation.js statically imports state.js, which wires several globals
// onto `window` via Object.defineProperty at module load time — so the
// domGlobals shim (aliasing window to globalThis) must be imported first,
// same as ai-savings.test.js and friends.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

const { buildSuggestionRowHtml, buildEpicRowHtml, DOC_ACTIONS } =
  await import('../../public/js/documentation.js');

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

// ── buildEpicRowHtml() (#555) ────────────────────────────────────────────────
function makeEpic(overrides = {}) {
  return {
    key: 'DOC-103',
    summary: 'Auth revamp epic',
    epicName: 'Auth',
    status: 'Done',
    epicClosedInScope: true,
    localExists: false,
    localFilename: null,
    closedChildren: [
      { key: 'DOC-101', summary: 'Add SSO login flow', issuetype: 'Story', status: 'Done' },
      { key: 'DOC-102', summary: 'Fix SSO redirect bug', issuetype: 'Bug', status: 'Done' },
    ],
    ...overrides,
  };
}

describe('buildEpicRowHtml()', () => {
  test('renders the epic key, epic name as the title, and a closed-count badge', () => {
    const html = buildEpicRowHtml(makeEpic(), false, false);
    assert.match(html, /doc-issue-key">DOC-103</);
    assert.match(html, /doc-issue-title" title="Auth">Auth</);
    assert.match(html, /doc-epic-closed-badge">2 closed</);
    assert.match(html, /doc-type-badge doc-type-epic">Epic</);
  });

  test('falls back to the epic summary as the title when epicName is blank', () => {
    const html = buildEpicRowHtml(makeEpic({ epicName: '' }), false, false);
    assert.match(html, /doc-issue-title" title="Auth revamp epic">Auth revamp epic</);
  });

  test('the selection unit is the epic key: data-key and the checkbox toggle both use epic.key, not a child key', () => {
    const html = buildEpicRowHtml(makeEpic(), false, false);
    assert.match(html, /class="doc-epic-item" data-key="DOC-103"/);
    assert.match(html, /class="doc-issue-row " data-key="DOC-103" data-action="docRowClick"/);
    assert.match(html, /docToggleKey\('DOC-103',this\.checked\)/);
    assert.doesNotMatch(html, /data-key="DOC-101"[^>]*data-action="docRowClick"/);
  });

  test('reuses the existing .doc-issue-row class for the epic row itself', () => {
    const html = buildEpicRowHtml(makeEpic(), false, false);
    assert.match(html, /<div class="doc-issue-row [^"]*" data-key="DOC-103"/);
  });

  test('selected: checkbox is checked and the inner row carries the "selected" class', () => {
    const html = buildEpicRowHtml(makeEpic(), true, false);
    assert.match(html, /<input type="checkbox" checked/);
    assert.match(html, /class="doc-issue-row selected" data-key="DOC-103"/);
  });

  test('not selected: no "checked" attribute on the checkbox', () => {
    const html = buildEpicRowHtml(makeEpic(), false, false);
    assert.doesNotMatch(html, /<input type="checkbox" checked/);
  });

  test('expanded: the outer item carries the "expanded" class and the toggle button reflects aria-expanded=true', () => {
    const html = buildEpicRowHtml(makeEpic(), false, true);
    assert.match(html, /class="doc-epic-item expanded" data-key="DOC-103"/);
    assert.match(
      html,
      /data-action="docToggleEpicChildren"[\s\S]*?data-key="DOC-103"[\s\S]*?aria-expanded="true"/
    );
  });

  test('collapsed: no "expanded" class, aria-expanded=false', () => {
    const html = buildEpicRowHtml(makeEpic(), false, false);
    assert.match(html, /class="doc-epic-item" data-key="DOC-103"/);
    assert.doesNotMatch(html, /doc-epic-item expanded/);
    assert.match(html, /aria-expanded="false"/);
  });

  test('the expand toggle uses DOC_ACTIONS.toggleEpic so it dispatches independently of the row click', () => {
    const html = buildEpicRowHtml(makeEpic(), false, false);
    assert.equal(DOC_ACTIONS.toggleEpic, 'docToggleEpicChildren');
    assert.match(html, /data-action="docToggleEpicChildren"/);
  });

  test('closed children render read-only (no checkbox) with key, type, status, and summary', () => {
    const html = buildEpicRowHtml(makeEpic(), false, true);
    assert.match(html, /doc-epic-child-row" data-key="DOC-101"/);
    assert.match(html, /doc-type-badge doc-type-story">Story</);
    assert.match(html, /doc-status-badge doc-status-done">Done</);
    assert.match(html, /doc-epic-child-title" title="Add SSO login flow">Add SSO login flow</);
    assert.match(html, /doc-epic-child-row" data-key="DOC-102"/);

    // Children are read-only — no per-child checkbox/selection wiring.
    const childrenSection = html.slice(html.indexOf('doc-epic-children-inner'));
    assert.doesNotMatch(childrenSection, /type="checkbox"/);
  });

  test('an epic with no closed children shows an empty-state message instead of a list', () => {
    const html = buildEpicRowHtml(makeEpic({ closedChildren: [] }), false, true);
    assert.match(html, /doc-epic-children-empty">No closed issues\.</);
    assert.match(html, /doc-epic-closed-badge">0 closed</);
  });

  test('shows the "Local" badge when the epic already exists locally', () => {
    const withLocal = buildEpicRowHtml(
      makeEpic({ localExists: true, localFilename: '2026-01-01-auth-revamp.md' }),
      false,
      false
    );
    assert.match(withLocal, /doc-local-badge/);

    const withoutLocal = buildEpicRowHtml(makeEpic({ localExists: false }), false, false);
    assert.doesNotMatch(withoutLocal, /doc-local-badge/);
  });

  test('escapes HTML-unsafe characters in epic and child summaries', () => {
    const html = buildEpicRowHtml(
      makeEpic({
        epicName: '',
        summary: '<script>alert(1)</script>',
        closedChildren: [
          { key: 'DOC-101', summary: 'A & B <bad>', issuetype: 'Story', status: 'Done' },
        ],
      }),
      false,
      true
    );
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /A & B <bad>/);
    assert.match(html, /A &amp; B &lt;bad&gt;/);
  });
});
