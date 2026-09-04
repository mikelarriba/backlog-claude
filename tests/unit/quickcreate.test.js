// ── Unit tests: public/js/quickcreate.js ────────────────────────────────────
// buildQuickProgressHtml() is the pure string builder split out of
// renderQuickProgress (#460) — the Quick Create panel's estimated,
// timer-based progress display (there's no real server progress event for
// /api/generate, so this is purely cosmetic step/percentage math). Same
// signature-change extraction pattern as buildRoadmapCardHtml (#508) and
// buildSuggestionRowHtml (#552).
// quickcreate.js statically imports list.js/detail.js/detail-links.js, which
// pull in the rest of the DOM-entangled app graph, so all three are mocked
// out below with only the named exports quickcreate.js actually calls;
// buildQuickProgressHtml never calls into any of them.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {} },
});
mock.module('../../public/js/detail.js', {
  namedExports: { openDoc: () => {} },
});
mock.module('../../public/js/detail-links.js', {
  namedExports: { loadHierarchy: () => {} },
});

const { buildQuickProgressHtml } = await import('../../public/js/quickcreate.js');

describe('buildQuickProgressHtml()', () => {
  test('renders a step row for each of the 4 fixed steps', () => {
    const html = buildQuickProgressHtml('story', 0);
    assert.match(html, /Analyzing your idea/);
    assert.match(html, /Drafting COVE sections/);
    assert.match(html, /Writing acceptance criteria/);
    assert.match(html, /Finalizing/);
  });

  test('the active step is marked "active" with the ▸ icon', () => {
    const html = buildQuickProgressHtml('story', 1);
    assert.match(
      html,
      /qc-step active"><span class="qc-step-icon">▸<\/span>Drafting COVE sections/
    );
  });

  test('steps before the active index are marked "done" with the ✔ icon', () => {
    const html = buildQuickProgressHtml('story', 2);
    assert.match(html, /qc-step done"><span class="qc-step-icon">✔<\/span>Analyzing your idea/);
    assert.match(html, /qc-step done"><span class="qc-step-icon">✔<\/span>Drafting COVE sections/);
  });

  test('steps after the active index are marked "pending" with the · icon', () => {
    const html = buildQuickProgressHtml('story', 0);
    assert.match(
      html,
      /qc-step pending"><span class="qc-step-icon">·<\/span>Writing acceptance criteria/
    );
    assert.match(html, /qc-step pending"><span class="qc-step-icon">·<\/span>Finalizing/);
  });

  test('percentage never exceeds 90% for the natural last step', () => {
    const html = buildQuickProgressHtml('story', 3);
    assert.match(html, /width:80%/);
    assert.match(html, /~80% · estimated/);
  });

  test('percentage is capped at 90% even when the raw math would exceed it', () => {
    const html = buildQuickProgressHtml('story', 10);
    assert.match(html, /width:90%/);
    assert.match(html, /~90% · estimated/);
  });

  test('percentage increases with the active index below the cap', () => {
    const first = buildQuickProgressHtml('story', 0);
    const second = buildQuickProgressHtml('story', 1);
    const pctOf = (html) => Number(html.match(/width:(\d+)%/)[1]);
    assert.ok(pctOf(second) > pctOf(first));
  });

  test('uses the TYPE_LABEL for a recognized type', () => {
    const html = buildQuickProgressHtml('story', 0);
    assert.match(html, /Generating Story…/);
  });

  test('falls back to the raw type string when unrecognized', () => {
    const html = buildQuickProgressHtml('not-a-real-type', 0);
    assert.match(html, /Generating not-a-real-type…/);
  });
});
