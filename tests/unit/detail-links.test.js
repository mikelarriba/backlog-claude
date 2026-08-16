// ── Unit tests: public/js/detail-links.js ───────────────────────────────────
// Pure label helper backing the hierarchy panel's "Link existing X" button
// and its modal title (#460). detail-links.js only imports pure/DOM-inert
// modules transitively (state.js, store.js, jira-import.js, actions.js), so
// no mocking beyond the window shim is needed to reach childLabel().
import '../helpers/domGlobals.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { childLabel } = await import('../../public/js/detail-links.js');

describe('childLabel()', () => {
  test("an epic's children are story / spike / bug", () => {
    assert.equal(childLabel('epic'), 'story / spike / bug');
  });

  test("a feature's children are epics", () => {
    assert.equal(childLabel('feature'), 'epic');
  });

  test('any other doc type also falls back to epic (only "epic" is special-cased)', () => {
    assert.equal(childLabel('story'), 'epic');
    assert.equal(childLabel('spike'), 'epic');
    assert.equal(childLabel('bug'), 'epic');
    assert.equal(childLabel(''), 'epic');
  });
});
