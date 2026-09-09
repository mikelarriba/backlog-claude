// ── Unit tests: public/js/detail.js's fallback-title extraction ────────────
// extractFallbackDocTitle derives the detail panel's title when the doc
// index has no `title` of its own (older docs, or ones the index hasn't
// caught up on yet): a "## <Type> Title" template heading's content wins
// first, else the first plain "## heading", else empty. Previously inlined
// in renderDocContent alongside DOM writes; extracted so the regex fallback
// chain is unit-testable without a DOM.
//
// detail.js statically imports store.js, jira-import.js, jira-push.js,
// stories.js, quickcreate.js, upgrade.js, main.js, roadmap.js,
// detail-fields.js, and detail-links.js — the rest of the DOM-entangled app
// graph (same chain mockRoadmapDeps.js's comment describes: dragdrop.js ->
// list-filters.js -> detail.js -> main.js -> ...). extractFallbackDocTitle
// never calls into any of them, so each is mocked out below with only the
// named exports detail.js actually imports (same mock-the-heavy-neighbor
// pattern as bugcreate.test.js/sse-client.test.js). state.js and actions.js
// are left real: both are foundational with no heavy imports of their own,
// and actions.js's registerKeydownActions/registerChangeActions calls at
// detail.js's module top level need to run for real to prove the module
// still loads cleanly.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

// detail.js also registers a `document.addEventListener('click', ...)`
// listener at its own module top level (closing open toolbar dropdowns on an
// outside click) — same pattern as bugcreate.test.js's comment describes for
// bugcreate.js's DOMContentLoaded listener. There's no real DOM in these
// tests, so `document` needs a minimal stub.
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { addEventListener: () => {} };
}

// state.js (left real, below) re-exports store.js's full surface, so the
// stub needs every export state.js re-exports, not just the one detail.js
// itself imports directly (upsertDoc).
mock.module('../../public/js/store.js', {
  namedExports: {
    getState: () => ({}),
    on: () => {},
    setDocs: () => {},
    upsertDoc: () => {},
    removeDoc: () => {},
    setPiSettings: () => {},
  },
});
mock.module('../../public/js/jira-import.js', {
  namedExports: { showJiraSelectModal: async () => [] },
});
mock.module('../../public/js/jira-push.js', {
  namedExports: { updateJiraPushBtn: () => {} },
});
mock.module('../../public/js/stories.js', {
  namedExports: { resetStoriesSection: () => {} },
});
mock.module('../../public/js/quickcreate.js', {
  namedExports: { closeQuickCreate: () => {} },
});
mock.module('../../public/js/upgrade.js', {
  namedExports: { resetUpgradePanel: () => {} },
});
mock.module('../../public/js/main.js', {
  namedExports: { isSplitMode: () => false, highlightSelectedItem: () => {} },
});
mock.module('../../public/js/roadmap.js', {
  namedExports: { isRoadmapOpen: () => false },
});
mock.module('../../public/js/detail-fields.js', {
  namedExports: {
    updateStoryPointsUI: () => {},
    updateSprintSelect: () => {},
    updateTeamWorkCatSelects: () => {},
    updateEstSizeSelect: () => {},
    _renderComments: () => {},
    _parseComments: () => [],
  },
});
mock.module('../../public/js/detail-links.js', {
  namedExports: { loadHierarchy: async () => {}, renderDetailDeps: () => {} },
});

const { extractFallbackDocTitle } = await import('../../public/js/detail.js');

describe('extractFallbackDocTitle()', () => {
  test('a "## <Type> Title" template heading returns its own content, trimmed', () => {
    const content = '## Feature Title\n\n  My Great Feature  \n\nSome body text.';
    assert.equal(extractFallbackDocTitle(content), 'My Great Feature');
  });

  test('falls back to the first plain "## heading" when there is no template Title heading', () => {
    const content = '## Something Else\n\nBody text here.';
    assert.equal(extractFallbackDocTitle(content), 'Something Else');
  });

  test('the template-Title match wins over a later plain heading', () => {
    const content = '## Story Title\n\nReal Title\n\n## Acceptance Criteria\n- one';
    assert.equal(extractFallbackDocTitle(content), 'Real Title');
  });

  test('returns empty string when there is no heading at all', () => {
    assert.equal(extractFallbackDocTitle('Just a paragraph, no headings.'), '');
  });

  test('returns empty string for empty content', () => {
    assert.equal(extractFallbackDocTitle(''), '');
  });

  test('the first plain heading wins when multiple plain headings exist', () => {
    const content = '## First Heading\nBody\n\n## Second Heading\nMore body';
    assert.equal(extractFallbackDocTitle(content), 'First Heading');
  });

  test('a template heading whose type name is multiple words still matches', () => {
    const content = '## New Feature Title\n\nBulk CSV Import\n\nBody.';
    assert.equal(extractFallbackDocTitle(content), 'Bulk CSV Import');
  });

  test('a heading containing the word "Title" mid-sentence (not as the heading itself) does not match the template pattern', () => {
    const content = '## About the Title field\n\nBody.';
    assert.equal(extractFallbackDocTitle(content), 'About the Title field');
  });
});
