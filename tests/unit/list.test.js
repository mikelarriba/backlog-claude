// ── Unit tests: public/js/list.js's rerank computation ─────────────────────
// computeRerankedOrder() is the pure reorder logic backing moveDocRank() (the
// list view's rank up/down buttons): swap `filename` with its neighbor
// `delta` positions away within its docType's rank-sorted group. Previously
// inlined directly in moveDocRank() reading the `allDocs` global; extracted
// to take `docs` as an explicit parameter instead, same signature-change
// extraction pattern already used for computeChildPoints() (detail-fields.ts)
// and matchesListFilters() (list-filters.ts).
//
// list.js statically imports detail.js (heavy DOM-entangled chain) and
// list-filters.js (which itself imports detail.js and list.js back — a
// circular import), plus store.js — all mocked out below since
// computeRerankedOrder() never calls into any of them, following the same
// mock-the-heavy-neighbor pattern used in list-filters.test.js/
// roadmap-jira-sync.test.js. list-render.js is left real so `_rankSortFn`
// (used internally by computeRerankedOrder) runs for real, and state.js is
// left real per detail.test.js's precedent (it just re-exports store.js plus
// foundational helpers with no heavy imports of its own).
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

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
mock.module('../../public/js/detail.js', {
  namedExports: { openDoc: () => {} },
});
mock.module('../../public/js/list-filters.js', {
  namedExports: { getSelectedDocs: () => [], closeContextMenu: () => {} },
});

const { computeRerankedOrder } = await import('../../public/js/list.js');

function makeDoc(overrides = {}) {
  return {
    filename: 'doc.md',
    docType: 'story',
    title: 'A Story',
    date: '2024-01-01',
    status: 'Draft',
    fixVersion: null,
    jiraId: null,
    jiraUrl: null,
    storyPoints: null,
    sprint: null,
    rank: null,
    priority: 'Medium',
    parentFilename: null,
    parentType: null,
    blocks: [],
    blockedBy: [],
    parallel: [],
    pi: null,
    team: null,
    workCategory: null,
    hasDescription: false,
    descriptionSnippet: null,
    ...overrides,
  };
}

describe('computeRerankedOrder()', () => {
  test('moves a doc down (delta +1) by swapping it with its next-ranked neighbor', () => {
    const docs = [
      makeDoc({ filename: 'a.md', rank: 1 }),
      makeDoc({ filename: 'b.md', rank: 2 }),
      makeDoc({ filename: 'c.md', rank: 3 }),
    ];
    const result = computeRerankedOrder(docs, 'story', 'a.md', 1);
    assert.deepEqual(
      result.map((d) => d.filename),
      ['b.md', 'a.md', 'c.md']
    );
  });

  test('moves a doc up (delta -1) by swapping it with its previous-ranked neighbor', () => {
    const docs = [
      makeDoc({ filename: 'a.md', rank: 1 }),
      makeDoc({ filename: 'b.md', rank: 2 }),
      makeDoc({ filename: 'c.md', rank: 3 }),
    ];
    const result = computeRerankedOrder(docs, 'story', 'c.md', -1);
    assert.deepEqual(
      result.map((d) => d.filename),
      ['a.md', 'c.md', 'b.md']
    );
  });

  test('only reorders within the same docType group, ignoring other types', () => {
    const docs = [
      makeDoc({ filename: 'a.md', docType: 'story', rank: 1 }),
      makeDoc({ filename: 'x.md', docType: 'bug', rank: 1 }),
      makeDoc({ filename: 'b.md', docType: 'story', rank: 2 }),
    ];
    const result = computeRerankedOrder(docs, 'story', 'a.md', 1);
    assert.deepEqual(
      result.map((d) => d.filename),
      ['b.md', 'a.md']
    );
  });

  test('returns null when the filename is not found in the docType group', () => {
    const docs = [makeDoc({ filename: 'a.md', rank: 1 })];
    assert.equal(computeRerankedOrder(docs, 'story', 'missing.md', 1), null);
  });

  test('returns null (no-op) when moving the first item up (out of bounds low)', () => {
    const docs = [makeDoc({ filename: 'a.md', rank: 1 }), makeDoc({ filename: 'b.md', rank: 2 })];
    assert.equal(computeRerankedOrder(docs, 'story', 'a.md', -1), null);
  });

  test('returns null (no-op) when moving the last item down (out of bounds high)', () => {
    const docs = [makeDoc({ filename: 'a.md', rank: 1 }), makeDoc({ filename: 'b.md', rank: 2 })];
    assert.equal(computeRerankedOrder(docs, 'story', 'b.md', 1), null);
  });

  test('unranked docs (rank: null) sort after ranked ones, filename-descending among themselves', () => {
    const docs = [
      makeDoc({ filename: 'unranked-old.md', rank: null }),
      makeDoc({ filename: 'ranked.md', rank: 1 }),
      makeDoc({ filename: 'unranked-new.md', rank: null }),
    ];
    // _rankSortFn's fallback (both unranked) sorts by filename descending
    // ("unranked-old.md" > "unranked-new.md" lexicographically).
    const result = computeRerankedOrder(docs, 'story', 'ranked.md', 1);
    assert.deepEqual(
      result.map((d) => d.filename),
      ['unranked-old.md', 'ranked.md', 'unranked-new.md']
    );
  });

  test('does not mutate the input docs array', () => {
    const docs = [makeDoc({ filename: 'a.md', rank: 1 }), makeDoc({ filename: 'b.md', rank: 2 })];
    const snapshot = docs.map((d) => d.filename);
    computeRerankedOrder(docs, 'story', 'a.md', 1);
    assert.deepEqual(
      docs.map((d) => d.filename),
      snapshot
    );
  });
});
