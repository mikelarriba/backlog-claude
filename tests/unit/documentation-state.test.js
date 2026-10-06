// ── Unit tests: public/js/documentation-state.js + documentation-render.js ──
// Pure pagination / result-matching helpers and HTML builders extracted from
// documentation.ts (#699). No DOM or module mocks needed beyond the state.js
// window shim that escHtml's module pulls in.
import '../helpers/domGlobals.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { paginate, matchExecuteResults, DOC_ACTIONS } =
  await import('../../public/js/documentation-state.js');
const { buildIssueRowHtml, buildPagerHtml } =
  await import('../../public/js/documentation-render.js');

describe('paginate', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);

  test('returns the requested page slice', () => {
    const r = paginate(items, 2, 20);
    assert.deepEqual(r.pageItems, items.slice(20, 40));
    assert.equal(r.page, 2);
    assert.equal(r.totalPages, 3);
  });

  test('clamps out-of-range pages', () => {
    assert.equal(paginate(items, 99, 20).page, 3);
    assert.equal(paginate(items, 0, 20).page, 1);
    assert.deepEqual(paginate(items, 3, 20).pageItems, items.slice(40));
  });

  test('empty list still reports one page', () => {
    assert.deepEqual(paginate([], 1, 20), { pageItems: [], page: 1, totalPages: 1 });
  });
});

describe('matchExecuteResults', () => {
  test('matches by position, not title', () => {
    const results = [
      { pageTitle: 'T', success: true },
      { pageTitle: 'T', success: false },
    ];
    const out = matchExecuteResults([4, 7], results);
    assert.deepEqual(
      out.map((o) => [o.index, o.result.success]),
      [
        [4, true],
        [7, false],
      ]
    );
  });

  test('missing results come back undefined', () => {
    assert.equal(matchExecuteResults([1], [])[0].result, undefined);
  });
});

describe('buildPagerHtml', () => {
  test('single page shows only a count with correct pluralisation', () => {
    assert.match(buildPagerHtml(1, 1, 1, 'issue'), />1 issue</);
    assert.match(buildPagerHtml(1, 1, 3, 'epic'), />3 epics</);
  });

  test('multi page shows prev/next with disabled edges', () => {
    const first = buildPagerHtml(1, 3, 45, 'issue');
    assert.match(first, /disabled[^>]*data-page="0"/);
    assert.match(first, /Page 1 of 3 \(45 issues\)/);
    assert.ok(first.includes(`data-action="${DOC_ACTIONS.setPage}"`));
    const last = buildPagerHtml(3, 3, 45, 'epic');
    assert.match(last, /disabled[^>]*data-page="4"/);
    assert.match(last, /\(45 epics\)/);
  });
});

describe('buildIssueRowHtml', () => {
  const issue = {
    key: 'A-1',
    summary: '<b>x</b>',
    issuetype: 'Story',
    status: 'In Progress',
    localExists: true,
  };

  test('escapes content and applies type/status classes', () => {
    const html = buildIssueRowHtml(issue, false);
    assert.ok(!html.includes('<b>x</b>'));
    assert.match(html, /doc-type-story/);
    assert.match(html, /doc-status-in-progress/);
    assert.match(html, /Local/);
    assert.doesNotMatch(html, /checked/);
  });

  test('selected rows are checked and flagged', () => {
    const html = buildIssueRowHtml({ ...issue, localExists: false }, true);
    assert.match(html, /checked/);
    assert.match(html, /doc-issue-row selected/);
    assert.doesNotMatch(html, /Local/);
  });
});
