// ── Unit tests: public/js/list-filters.js ───────────────────────────────────
// matchesListFilters() is the pure predicate backing the backlog list's
// type/status/team/work-category filters plus search — extracted from
// _matchesFilters() to take the active filters as an explicit `filters`
// parameter instead of reading the module's activeTypeFilter/
// activeStatusFilter/activeTeamFilter/activeWorkCatFilter globals directly
// (#460), following the same signature-change extraction pattern already
// used for computeChildPoints() (detail-fields.ts) and buildSprintSubmenuHtml
// (roadmap-context-menus.ts). list-filters.js statically imports detail.js,
// list.js, list-render.js, and dragdrop.js (heavy, DOM-entangled, and part of
// a circular import with list.js) — mocked out below since matchesListFilters
// never calls into them, following the same mock-the-heavy-neighbor pattern
// used in roadmap-drag.test.js.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/detail.js', {
  namedExports: { closeDeleteDialog: () => {}, executeDelete: async () => {} },
});
mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {}, contextSplitItem: () => {} },
});
mock.module('../../public/js/list-render.js', {
  namedExports: {
    renderSwimlanes: () => {},
    renderDocItem: () => '',
    attachDepHoverListenerFor: () => {},
    _invalidateDepElCache: () => {},
    LIST_ITEM_CTX_ACTIONS: { itemContextMenu: 'listItemContextMenu' },
  },
});
mock.module('../../public/js/dragdrop.js', {
  namedExports: { sectionToFixVersion: () => null },
});

const { matchesListFilters } = await import('../../public/js/list-filters.js');

// A representative doc — individual tests override just the field(s) under test.
const baseDoc = {
  filename: 'story-1.md',
  docType: 'story',
  title: 'Improve search relevance',
  status: 'In Progress',
  team: 'Platform',
  workCategory: 'Feature',
};

const allFilters = { type: 'all', status: 'all', team: 'all', workCat: 'all' };

describe('matchesListFilters()', () => {
  test('matches everything when every filter is "all" and the query is empty', () => {
    assert.equal(matchesListFilters(baseDoc, '', allFilters), true);
  });

  test('type filter excludes a non-matching docType', () => {
    const filters = { ...allFilters, type: 'epic' };
    assert.equal(matchesListFilters(baseDoc, '', filters), false);
  });

  test('type filter includes a matching docType', () => {
    const filters = { ...allFilters, type: 'story' };
    assert.equal(matchesListFilters(baseDoc, '', filters), true);
  });

  test('status filter excludes a non-matching status', () => {
    const filters = { ...allFilters, status: 'Resolved' };
    assert.equal(matchesListFilters(baseDoc, '', filters), false);
  });

  test('status filter treats a missing status as "Draft"', () => {
    const doc = { ...baseDoc, status: '' };
    const filters = { ...allFilters, status: 'Draft' };
    assert.equal(matchesListFilters(doc, '', filters), true);
  });

  test('team filter excludes a non-matching team', () => {
    const filters = { ...allFilters, team: 'Growth' };
    assert.equal(matchesListFilters(baseDoc, '', filters), false);
  });

  test('team filter excludes a doc with no team when a specific team is active', () => {
    const doc = { ...baseDoc, team: null };
    const filters = { ...allFilters, team: 'Platform' };
    assert.equal(matchesListFilters(doc, '', filters), false);
  });

  test('work category filter excludes a non-matching category', () => {
    const filters = { ...allFilters, workCat: 'Tech Debt' };
    assert.equal(matchesListFilters(baseDoc, '', filters), false);
  });

  test('search query matches against the title', () => {
    assert.equal(matchesListFilters(baseDoc, 'relevance', allFilters), true);
  });

  test('search query matches against the filename', () => {
    assert.equal(matchesListFilters(baseDoc, 'story-1', allFilters), true);
  });

  test('search query with no match in title or filename excludes the doc', () => {
    assert.equal(matchesListFilters(baseDoc, 'nonexistent', allFilters), false);
  });

  test('search query matching is case-insensitive against the title', () => {
    // Callers lowercase the query before passing it in (see
    // _currentSearchQuery()); the doc's own title/filename casing is
    // normalized by matchesListFilters() itself via toLowerCase().
    assert.equal(matchesListFilters(baseDoc, 'improve search', allFilters), true);
  });

  test('all filters must pass simultaneously — one mismatch excludes the doc', () => {
    const filters = { type: 'story', status: 'In Progress', team: 'Platform', workCat: 'Bug' };
    assert.equal(matchesListFilters(baseDoc, '', filters), false);
  });

  test('all filters and a matching query together include the doc', () => {
    const filters = { type: 'story', status: 'In Progress', team: 'Platform', workCat: 'Feature' };
    assert.equal(matchesListFilters(baseDoc, 'relevance', filters), true);
  });
});
