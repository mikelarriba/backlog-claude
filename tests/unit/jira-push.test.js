// ── Unit tests: public/js/jira-push.js ──────────────────────────────────────
// Pure payload/summary helpers extracted from the push-to-JIRA flow (#460) —
// counting, sorting, and progress/result-summary text, exercised without a
// DOM. jira-push.js statically imports detail.js (which pulls in main.js and
// its top-level DOM listeners), so detail.js is mocked out before the
// dynamic import below; the functions under test never call into it.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/detail.js', {
  namedExports: {
    openDoc: () => {},
    closeAllDropdowns: () => {},
  },
});

const {
  summarizePreviewCounts,
  computeProgressPercent,
  comparePushPreviewItems,
  summarizePushResults,
  collectPushedKeysByDocType,
} = await import('../../public/js/jira-push.js');

// ── summarizePreviewCounts ──────────────────────────────────────────────────
describe('summarizePreviewCounts()', () => {
  test('empty list produces an empty string', () => {
    assert.equal(summarizePreviewCounts([]), '');
  });

  test('counts creates, updates, and deletes separately', () => {
    const items = [
      { action: 'create' },
      { action: 'create' },
      { action: 'update' },
      { action: 'delete' },
    ];
    assert.equal(summarizePreviewCounts(items), '2 new · 1 update · 1 to delete');
  });

  test('omits zero-count segments', () => {
    const items = [{ action: 'update' }, { action: 'update' }];
    assert.equal(summarizePreviewCounts(items), '2 update');
  });

  test('items with an unrecognized/missing action are not counted anywhere', () => {
    const items = [{ action: 'noop' }, {}];
    assert.equal(summarizePreviewCounts(items), '');
  });
});

// ── computeProgressPercent ───────────────────────────────────────────────────
describe('computeProgressPercent()', () => {
  test('total 0 returns 0 (no divide-by-zero)', () => {
    assert.equal(computeProgressPercent(0, 0), 0);
  });

  test('current equal to total is 100%', () => {
    assert.equal(computeProgressPercent(5, 5), 100);
  });

  test('rounds to the nearest integer', () => {
    assert.equal(computeProgressPercent(1, 3), 33);
    assert.equal(computeProgressPercent(2, 3), 67);
  });

  test('current 0 of a positive total is 0%', () => {
    assert.equal(computeProgressPercent(0, 10), 0);
  });
});

// ── comparePushPreviewItems ──────────────────────────────────────────────────
describe('comparePushPreviewItems()', () => {
  function item(docType, action) {
    return { docType, action };
  }

  test('sorts creates before updates for the same type', () => {
    const items = [item('story', 'update'), item('story', 'create')];
    items.sort(comparePushPreviewItems);
    assert.deepEqual(
      items.map((i) => i.action),
      ['create', 'update']
    );
  });

  test('features sort before epics, both before other create types', () => {
    const items = [item('story', 'create'), item('epic', 'create'), item('feature', 'create')];
    items.sort(comparePushPreviewItems);
    assert.deepEqual(
      items.map((i) => i.docType),
      ['feature', 'epic', 'story']
    );
  });

  test('all creates come before all updates regardless of type', () => {
    const items = [item('feature', 'update'), item('story', 'create')];
    items.sort(comparePushPreviewItems);
    assert.deepEqual(
      items.map((i) => i.action),
      ['create', 'update']
    );
  });

  test('full ordering: create-feature, create-epic, create-other, update-feature, update-epic, update-other', () => {
    const items = [
      item('story', 'update'),
      item('epic', 'update'),
      item('feature', 'update'),
      item('story', 'create'),
      item('epic', 'create'),
      item('feature', 'create'),
    ];
    items.sort(comparePushPreviewItems);
    assert.deepEqual(
      items.map((i) => `${i.action}-${i.docType}`),
      [
        'create-feature',
        'create-epic',
        'create-story',
        'update-feature',
        'update-epic',
        'update-story',
      ]
    );
  });
});

// ── summarizePushResults ─────────────────────────────────────────────────────
describe('summarizePushResults()', () => {
  test('no results and no errors: "Nothing pushed"', () => {
    assert.equal(summarizePushResults([], 0), 'Nothing pushed');
  });

  test('counts created vs. everything else as "synced"', () => {
    const results = [{ action: 'created' }, { action: 'updated' }, { action: 'updated' }];
    assert.equal(summarizePushResults(results, 0), 'Pushed: 1 created, 2 synced');
  });

  test('results with no action at all still count toward "synced"', () => {
    const results = [{}, {}];
    assert.equal(summarizePushResults(results, 0), 'Pushed: 2 synced');
  });

  test('appends failed count when errors occurred', () => {
    const results = [{ action: 'created' }];
    assert.equal(summarizePushResults(results, 2), 'Pushed: 1 created, 2 failed');
  });

  test('all-failed with no results still reports the failure count', () => {
    assert.equal(summarizePushResults([], 3), 'Pushed: 3 failed');
  });
});

// ── collectPushedKeysByDocType ───────────────────────────────────────────────
describe('collectPushedKeysByDocType()', () => {
  test('filters by docType and requires a key', () => {
    const results = [
      { docType: 'story', key: 'PROJ-1' },
      { docType: 'story', key: undefined },
      { docType: 'spike', key: 'PROJ-2' },
    ];
    assert.deepEqual(collectPushedKeysByDocType(results, 'story'), ['PROJ-1']);
  });

  test('returns an empty array when nothing matches', () => {
    assert.deepEqual(collectPushedKeysByDocType([{ docType: 'bug', key: 'X-1' }], 'story'), []);
  });
});
