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
  buildSyncPreviewItemHtml,
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

// ── buildSyncPreviewItemHtml ─────────────────────────────────────────────────
describe('buildSyncPreviewItemHtml()', () => {
  test('create action renders the "+ Create" badge and the create CSS class', () => {
    const html = buildSyncPreviewItemHtml({ action: 'create', title: 'New Story' }, 0);
    assert.match(html, /sync-preview-action create/);
    assert.match(html, /\+ Create</);
    assert.doesNotMatch(html, /sync-preview-item--delete/);
  });

  test('auto-included create renders the "(auto)" suffix', () => {
    const html = buildSyncPreviewItemHtml(
      { action: 'create', title: 'Auto Story', autoIncluded: true },
      0
    );
    assert.match(html, /\+ Create \(auto\)/);
  });

  test('update action renders the "Update" badge and no field changes when the list is empty', () => {
    const html = buildSyncPreviewItemHtml({ action: 'update', title: 'Existing Story' }, 1);
    assert.match(html, /sync-preview-action update/);
    assert.match(html, /↺ Update/);
    assert.match(html, /No field changes detected/);
  });

  test('delete action renders the delete badge, the delete item class, and the reason', () => {
    const html = buildSyncPreviewItemHtml(
      { action: 'delete', title: 'Stale Story', reason: 'Removed in JIRA' },
      2
    );
    assert.match(html, /sync-preview-item--delete/);
    assert.match(html, /sync-preview-action delete/);
    assert.match(html, /✕ Delete/);
    assert.match(html, /Removed in JIRA/);
  });

  test('escapes the title, key, and reason to prevent HTML injection', () => {
    const html = buildSyncPreviewItemHtml(
      {
        action: 'delete',
        title: '<img src=x onerror=alert(1)>',
        jiraKey: '<b>PROJ-1</b>',
        reason: '<script>bad()</script>',
      },
      0
    );
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /<b>PROJ-1/);
    assert.doesNotMatch(html, /<script>/);
  });

  test('renders the data-idx attribute from the index argument', () => {
    const html = buildSyncPreviewItemHtml({ action: 'update' }, 7);
    assert.match(html, /data-idx="7"/);
  });

  test('a docType renders a type badge with the mapped label; missing docType renders none', () => {
    const withType = buildSyncPreviewItemHtml({ action: 'update', docType: 'story' }, 0);
    assert.match(withType, /type-badge story/);

    const withoutType = buildSyncPreviewItemHtml({ action: 'update' }, 0);
    assert.doesNotMatch(withoutType, /type-badge/);
  });

  test('an "error" change renders the error message instead of a from/to arrow', () => {
    const html = buildSyncPreviewItemHtml(
      { action: 'update', changes: [{ field: 'error', message: 'Conflict detected' }] },
      0
    );
    assert.match(html, /Conflict detected/);
    assert.doesNotMatch(html, /sync-preview-arrow/);
  });

  test('a "description" change renders "new" for creates and "will sync" for updates', () => {
    const created = buildSyncPreviewItemHtml(
      { action: 'create', changes: [{ field: 'description' }] },
      0
    );
    assert.match(created, />new</);

    const updated = buildSyncPreviewItemHtml(
      { action: 'update', changes: [{ field: 'description' }] },
      0
    );
    assert.match(updated, /will sync/);
  });

  test('a change with a defined "from" renders the from value and an arrow', () => {
    const html = buildSyncPreviewItemHtml(
      { action: 'update', changes: [{ field: 'status', from: 'To Do', to: 'Done' }] },
      0
    );
    assert.match(html, /sync-preview-from">To Do/);
    assert.match(html, /sync-preview-arrow/);
    assert.match(html, /sync-preview-to">Done/);
  });

  test('a change with no "from" omits the arrow entirely', () => {
    const html = buildSyncPreviewItemHtml(
      { action: 'update', changes: [{ field: 'status', to: 'Done' }] },
      0
    );
    assert.doesNotMatch(html, /sync-preview-arrow/);
  });

  test('pendingEpicTitle and pendingFeatureTitle both render a "[new]" prefix, epic taking priority', () => {
    const epic = buildSyncPreviewItemHtml(
      { action: 'update', changes: [{ field: 'parent', pendingEpicTitle: 'My Epic' }] },
      0
    );
    assert.match(epic, /\[new\] My Epic/);

    const feature = buildSyncPreviewItemHtml(
      { action: 'update', changes: [{ field: 'parent', pendingFeatureTitle: 'My Feature' }] },
      0
    );
    assert.match(feature, /\[new\] My Feature/);
  });

  test('a change with neither "to" nor pending titles renders an em dash placeholder', () => {
    const html = buildSyncPreviewItemHtml({ action: 'update', changes: [{ field: 'status' }] }, 0);
    assert.match(html, /sync-preview-to.*—/);
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
