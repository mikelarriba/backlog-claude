// ── Unit tests: public/js/roadmap.js ───────────────────────────────────────
// computeVisibleSprints() is the pure function split out of getAllSprints()
// (#460) so it's testable without the piSettings/_roadmapVisiblePis/
// sprintConfig ambient globals — callers pass the PI list, visibility set,
// and sprint config explicitly. Same signature-change extraction pattern as
// roadmap-render.ts's buildRoadmapCardHtml (#508), roadmap-context-menus.ts's
// buildSprintSubmenuHtml (#567), and list-filters.ts's matchesListFilters
// (#575).
//
// roadmap.js statically imports roadmap-render.js, roadmap-select.js, and
// refine.js, each of which transitively pulls in detail.js and main.js,
// which run DOM side effects at module-load time (e.g. bugcreate.js
// registers a DOMContentLoaded listener at the top level), throwing in a
// no-DOM test environment — same root cause documented in
// mockRoadmapDeps.js and roadmap-context-menus.test.js. The function under
// test never calls into any of those three, so it's safe to replace them
// with no-op stubs purely so the module graph can load without a real DOM.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/roadmap-render.js', {
  namedExports: { renderRoadmapBoard: () => {} },
});
mock.module('../../public/js/roadmap-select.js', {
  namedExports: { clearRoadmapSelection: () => {} },
});
mock.module('../../public/js/refine.js', {
  namedExports: { resetRefineViewState: () => {} },
});

const { computeVisibleSprints } = await import('../../public/js/roadmap.js');

function sprint(name, overrides = {}) {
  return { name, capacity: 10, ...overrides };
}

describe('computeVisibleSprints()', () => {
  test('returns an empty array when no PIs are visible', () => {
    const config = { 'PI-1': [sprint('Sprint 1')] };
    assert.deepEqual(computeVisibleSprints(['PI-1'], new Set(), config), []);
  });

  test('returns an empty array when the visible PI has no sprints configured', () => {
    assert.deepEqual(computeVisibleSprints(['PI-1'], new Set(['PI-1']), {}), []);
  });

  test('returns sprints for a single visible PI in config order', () => {
    const config = { 'PI-1': [sprint('Sprint 1'), sprint('Sprint 2')] };
    const result = computeVisibleSprints(['PI-1'], new Set(['PI-1']), config);
    assert.deepEqual(
      result.map((s) => s.name),
      ['Sprint 1', 'Sprint 2']
    );
  });

  test('skips PIs not in the visible set', () => {
    const config = {
      'PI-1': [sprint('Sprint 1')],
      'PI-2': [sprint('Sprint 2')],
    };
    const result = computeVisibleSprints(['PI-1', 'PI-2'], new Set(['PI-2']), config);
    assert.deepEqual(
      result.map((s) => s.name),
      ['Sprint 2']
    );
  });

  test('concatenates sprints across multiple visible PIs, current PI first', () => {
    const config = {
      'PI-1': [sprint('Sprint 1')],
      'PI-2': [sprint('Sprint 3')],
    };
    const result = computeVisibleSprints(['PI-1', 'PI-2'], new Set(['PI-1', 'PI-2']), config);
    assert.deepEqual(
      result.map((s) => s.name),
      ['Sprint 1', 'Sprint 3']
    );
  });

  test('de-dupes a sprint name shared across both PIs, keeping the first occurrence', () => {
    const config = {
      'PI-1': [sprint('Shared', { capacity: 5 })],
      'PI-2': [sprint('Shared', { capacity: 99 })],
    };
    const result = computeVisibleSprints(['PI-1', 'PI-2'], new Set(['PI-1', 'PI-2']), config);
    assert.equal(result.length, 1);
    assert.equal(result[0].capacity, 5);
  });

  test('returns an empty array when the PI list is empty', () => {
    assert.deepEqual(computeVisibleSprints([], new Set(['PI-1']), { 'PI-1': [sprint('x')] }), []);
  });
});
