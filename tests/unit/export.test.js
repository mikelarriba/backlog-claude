// ── Unit tests: public/js/export.js's roadmap export query builder ────────
// buildRoadmapExportQuery() is the pure query-string builder backing
// executeRoadmapExport() (the roadmap export dialog's "Export" button):
// turns the dialog's checkbox selections into the `/api/export/roadmap`
// query string, or null when nothing was selected (the caller shows the
// "select at least one section" toast in that case). Previously inlined
// directly in executeRoadmapExport() reading DOM checkboxes; extracted to
// take an explicit selections object instead, same signature-change
// extraction pattern already used for computeSprintSelectorGroups()
// (roadmap-jira-sync.ts) and computeRerankedOrder() (list.ts).
//
// export.js imports roadmap.js for getAllSprints(), which itself pulls in
// refine.js's heavy DOM-entangled chain — mocked out below since
// buildRoadmapExportQuery() never calls into it. state.js is left real per
// detail.test.js's precedent (foundational helpers, no heavy imports).
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/roadmap.js', {
  namedExports: { getAllSprints: () => [] },
});

const { buildRoadmapExportQuery } = await import('../../public/js/export.js');

function baseSelections(overrides = {}) {
  return {
    includeRoadmap: false,
    includeTitles: false,
    includeDescs: false,
    includeCharts: false,
    hideEmptyEpics: false,
    visiblePis: [],
    sprints: [],
    teams: [],
    ...overrides,
  };
}

describe('buildRoadmapExportQuery()', () => {
  test('nothing selected: returns null', () => {
    assert.equal(buildRoadmapExportQuery(baseSelections()), null);
  });

  test('a single section selected: includes just that section', () => {
    const query = buildRoadmapExportQuery(baseSelections({ includeRoadmap: true }));
    const params = new URLSearchParams(query);
    assert.equal(params.get('includes'), 'roadmap');
    assert.equal(params.has('pi'), false);
    assert.equal(params.has('hideEmpty'), false);
    assert.equal(params.has('sprints'), false);
    assert.equal(params.has('teams'), false);
  });

  test('all four sections selected: includes lists all in fixed order', () => {
    const query = buildRoadmapExportQuery(
      baseSelections({
        includeRoadmap: true,
        includeTitles: true,
        includeDescs: true,
        includeCharts: true,
      })
    );
    const params = new URLSearchParams(query);
    assert.equal(params.get('includes'), 'roadmap,titles,descriptions,charts');
  });

  test('a non-first section selected alone: only that one is included', () => {
    const query = buildRoadmapExportQuery(baseSelections({ includeCharts: true }));
    const params = new URLSearchParams(query);
    assert.equal(params.get('includes'), 'charts');
  });

  test('hideEmptyEpics true: sets hideEmpty=1', () => {
    const query = buildRoadmapExportQuery(
      baseSelections({ includeRoadmap: true, hideEmptyEpics: true })
    );
    assert.equal(new URLSearchParams(query).get('hideEmpty'), '1');
  });

  test('hideEmptyEpics false: omits hideEmpty entirely', () => {
    const query = buildRoadmapExportQuery(
      baseSelections({ includeRoadmap: true, hideEmptyEpics: false })
    );
    assert.equal(new URLSearchParams(query).has('hideEmpty'), false);
  });

  test('visible PIs present: joined into a comma-separated pi param', () => {
    const query = buildRoadmapExportQuery(
      baseSelections({ includeRoadmap: true, visiblePis: ['PI-1', 'PI-2'] })
    );
    assert.equal(new URLSearchParams(query).get('pi'), 'PI-1,PI-2');
  });

  test('visible PIs empty: omits the pi param', () => {
    const query = buildRoadmapExportQuery(baseSelections({ includeRoadmap: true, visiblePis: [] }));
    assert.equal(new URLSearchParams(query).has('pi'), false);
  });

  test('sprints selected: joined into a comma-separated sprints param', () => {
    const query = buildRoadmapExportQuery(
      baseSelections({ includeRoadmap: true, sprints: ['Sprint 1', 'Sprint 2'] })
    );
    assert.equal(new URLSearchParams(query).get('sprints'), 'Sprint 1,Sprint 2');
  });

  test('teams selected: joined into a comma-separated teams param', () => {
    const query = buildRoadmapExportQuery(
      baseSelections({ includeRoadmap: true, teams: ['Team A'] })
    );
    assert.equal(new URLSearchParams(query).get('teams'), 'Team A');
  });

  test('no sprints and no teams selected: both params omitted', () => {
    const query = buildRoadmapExportQuery(baseSelections({ includeRoadmap: true }));
    const params = new URLSearchParams(query);
    assert.equal(params.has('sprints'), false);
    assert.equal(params.has('teams'), false);
  });

  test('all optional fields combined: every param present and correct', () => {
    const query = buildRoadmapExportQuery({
      includeRoadmap: true,
      includeTitles: false,
      includeDescs: true,
      includeCharts: false,
      hideEmptyEpics: true,
      visiblePis: ['PI-3'],
      sprints: ['Sprint 9'],
      teams: ['Team B', 'Team C'],
    });
    const params = new URLSearchParams(query);
    assert.equal(params.get('includes'), 'roadmap,descriptions');
    assert.equal(params.get('pi'), 'PI-3');
    assert.equal(params.get('hideEmpty'), '1');
    assert.equal(params.get('sprints'), 'Sprint 9');
    assert.equal(params.get('teams'), 'Team B,Team C');
  });
});
