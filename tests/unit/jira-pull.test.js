// ── Unit tests: public/js/jira-pull.js ──────────────────────────────────────
// Pure selection/summary helpers extracted from the update-from-JIRA and
// "check all" flows (#460), exercised without a DOM. jira-pull.js statically
// imports detail.js and list.js (which both pull in main.js and its
// top-level DOM listeners), so those are mocked out before the dynamic
// import below; the functions under test never call into them.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/detail.js', {
  namedExports: {
    openDoc: () => {},
    updateJiraStatus: () => {},
    closeAllDropdowns: () => {},
  },
});
mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {} },
});

const {
  computeSyncSelectionPlan,
  summarizePullResult,
  mapCheckAllChangesToModalItems,
  summarizeCheckAllSyncResult,
} = await import('../../public/js/jira-pull.js');

function previewItem(overrides = {}) {
  return { jiraKey: 'PROJ-1', action: 'update', ...overrides };
}

// ── computeSyncSelectionPlan ─────────────────────────────────────────────────
describe('computeSyncSelectionPlan()', () => {
  test('parent (index 0) selected and unchanged action counts as parentSelected', () => {
    const previewItems = [previewItem({ jiraKey: 'PARENT' })];
    const selected = [previewItem({ jiraKey: 'PARENT' })];
    const plan = computeSyncSelectionPlan(previewItems, selected);
    assert.equal(plan.parentSelected, true);
    assert.equal(plan.selectedChildren.length, 0);
    assert.equal(plan.totalSteps, 1);
  });

  test('parent selected with action "delete" does NOT count as parentSelected', () => {
    const previewItems = [previewItem({ jiraKey: 'PARENT' })];
    const selected = [previewItem({ jiraKey: 'PARENT', action: 'delete' })];
    const plan = computeSyncSelectionPlan(previewItems, selected);
    assert.equal(plan.parentSelected, false);
    assert.equal(plan.selectedDeletes.length, 1);
  });

  test('children are every selected item whose key differs from the parent, excluding deletes', () => {
    const previewItems = [
      previewItem({ jiraKey: 'PARENT' }),
      previewItem({ jiraKey: 'CHILD-1' }),
      previewItem({ jiraKey: 'CHILD-2' }),
    ];
    const selected = [
      previewItem({ jiraKey: 'CHILD-1' }),
      previewItem({ jiraKey: 'CHILD-2', action: 'delete' }),
    ];
    const plan = computeSyncSelectionPlan(previewItems, selected);
    assert.deepEqual(
      plan.selectedChildren.map((c) => c.jiraKey),
      ['CHILD-1']
    );
    assert.deepEqual(
      plan.selectedDeletes.map((c) => c.jiraKey),
      ['CHILD-2']
    );
  });

  test('totalSteps counts each non-empty group once, regardless of item count', () => {
    const previewItems = [
      previewItem({ jiraKey: 'PARENT' }),
      previewItem({ jiraKey: 'C1' }),
      previewItem({ jiraKey: 'C2' }),
      previewItem({ jiraKey: 'C3' }),
    ];
    const selected = [
      previewItem({ jiraKey: 'PARENT' }),
      previewItem({ jiraKey: 'C1' }),
      previewItem({ jiraKey: 'C2' }),
      previewItem({ jiraKey: 'C3', action: 'delete' }),
    ];
    const plan = computeSyncSelectionPlan(previewItems, selected);
    // parent + children + deletes = 3 steps, even though children has 2 items
    assert.equal(plan.totalSteps, 3);
  });

  test('nothing selected produces an all-false/empty plan with 0 steps', () => {
    const previewItems = [previewItem({ jiraKey: 'PARENT' })];
    const plan = computeSyncSelectionPlan(previewItems, []);
    assert.equal(plan.parentSelected, false);
    assert.equal(plan.selectedChildren.length, 0);
    assert.equal(plan.selectedDeletes.length, 0);
    assert.equal(plan.totalSteps, 0);
  });
});

// ── summarizePullResult ──────────────────────────────────────────────────────
describe('summarizePullResult()', () => {
  test('all-zero outcome with no error: "No changes applied"', () => {
    const msg = summarizePullResult(
      { updatedKey: null, childrenSynced: 0, childrenDeleted: 0 },
      ''
    );
    assert.equal(msg, 'No changes applied');
  });

  test('joins the present parts with commas', () => {
    const msg = summarizePullResult(
      { updatedKey: 'PROJ-1', childrenSynced: 2, childrenDeleted: 1 },
      ''
    );
    assert.equal(msg, 'Updated PROJ-1, 2 child(ren) synced, 1 closed item(s) deleted');
  });

  test('appends the error message on a new line when present', () => {
    const msg = summarizePullResult(
      { updatedKey: 'PROJ-1', childrenSynced: 0, childrenDeleted: 0 },
      'network timeout'
    );
    assert.equal(msg, 'Updated PROJ-1\nnetwork timeout');
  });

  test('error alone (no parts) still prefixes "No changes applied"', () => {
    const msg = summarizePullResult(
      { updatedKey: null, childrenSynced: 0, childrenDeleted: 0 },
      'boom'
    );
    assert.equal(msg, 'No changes applied\nboom');
  });
});

// ── mapCheckAllChangesToModalItems ───────────────────────────────────────────
describe('mapCheckAllChangesToModalItems()', () => {
  test('remaps changesArray to changes without mutating the source', () => {
    const source = [{ jiraKey: 'PROJ-1', changesArray: [{ field: 'status' }] }];
    const mapped = mapCheckAllChangesToModalItems(source);
    assert.deepEqual(mapped[0].changes, [{ field: 'status' }]);
    assert.equal(source[0].changes, undefined);
  });

  test('missing changesArray maps to an empty array', () => {
    const mapped = mapCheckAllChangesToModalItems([{ jiraKey: 'PROJ-1' }]);
    assert.deepEqual(mapped[0].changes, []);
  });
});

// ── summarizeCheckAllSyncResult ──────────────────────────────────────────────
describe('summarizeCheckAllSyncResult()', () => {
  test('singular "issue" for a count of 1, no errors', () => {
    assert.equal(summarizeCheckAllSyncResult(1, []), 'Synced 1 issue');
  });

  test('plural "issues" for counts other than 1', () => {
    assert.equal(summarizeCheckAllSyncResult(0, []), 'Synced 0 issues');
    assert.equal(summarizeCheckAllSyncResult(3, []), 'Synced 3 issues');
  });

  test('appends error count and detail lines when present', () => {
    const msg = summarizeCheckAllSyncResult(2, ['PROJ-1: failed', 'PROJ-2: timeout']);
    assert.equal(msg, 'Synced 2 issues, 2 error(s)\nPROJ-1: failed\nPROJ-2: timeout');
  });
});
